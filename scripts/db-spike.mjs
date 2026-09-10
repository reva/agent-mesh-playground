#!/usr/bin/env node
/**
 * Probe a Supabase Postgres for the properties the agent mesh stack needs.
 *
 * Answers the phase 3 questions in docs/PLAN.md:
 *   - does the shared pooler reach us, over what, and with TLS
 *   - can the login role create databases, and does the pooler route to them
 *   - does the pooler forward a startup `options=-csearch_path=...`
 *   - is pgvector available and installable
 *   - do server-side prepared statements survive (session vs transaction mode)
 *   - how much connection budget is there
 *
 * No npm dependencies: it shells out to psql. Everything it creates uses the
 * `spike_` prefix and is dropped again unless --keep is given.
 *
 * Usage: node scripts/db-spike.mjs [--keep]
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPIKE_DB = "spike_agentmesh";
const SPIKE_SCHEMA = "spike_schema";

const C = {
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  dim: "\x1b[2m", reset: "\x1b[0m",
};

const results = [];

function loadEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function redact(url) {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

function withDatabase(url, dbname) {
  const u = new URL(url);
  u.pathname = "/" + dbname;
  return u.toString();
}

function withQuery(url, key, value) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/** Run SQL. Resolves to { ok, out } where out is stdout on success, stderr on failure. */
async function psql(url, sql, timeoutMs = 30000) {
  const args = ["-X", "-q", "-A", "-t", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", sql];
  try {
    const { stdout } = await execFileAsync("psql", [url, ...args], {
      timeout: timeoutMs,
      env: { ...process.env, PGCONNECT_TIMEOUT: "15" },
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error("psql is not on PATH. Install the postgresql client and retry.");
      process.exit(1);
    }
    const detail = (err.stderr || err.stdout || err.message || "").trim();
    return { ok: false, out: detail || `psql exited with ${err.code}` };
  }
}

function record(name, ok, detail, verdict = "") {
  results.push({ name, ok });
  const mark = ok ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`  [${mark}] ${name}`);
  for (const line of String(detail).split("\n")) {
    console.log(`         ${C.dim}${line}${C.reset}`);
  }
  if (verdict) console.log(`         ${C.yellow}=> ${verdict}${C.reset}`);
  console.log();
}

function section(title) {
  console.log(`${title}\n${"-".repeat(title.length)}`);
}

async function checkConnectivity(url) {
  section("1. Connectivity and identity");
  const { ok, out } = await psql(url, `
    select 'version=' || substring(version() from 'PostgreSQL [0-9.]+')
        || E'\\ndatabase=' || current_database()
        || E'\\nuser=' || current_user
        || E'\\nserver_addr=' || coalesce(host(inet_server_addr())::text, 'unset (pooler)')
        || E'\\nclient_addr=' || coalesce(host(inet_client_addr())::text, 'unset')
        || E'\\nssl=' || coalesce((select ssl::text from pg_stat_ssl where pid = pg_backend_pid()), 'unknown')
  `);
  record("connect through the given URL", ok, out);
  return ok;
}

async function checkPoolerMode(url) {
  section("2. Pooler mode");
  const u = new URL(url);
  const port = u.port || "5432";
  const isPooler = u.hostname.includes("pooler.supabase.com");

  if (!isPooler) {
    record("host is the shared pooler", false, `host=${u.hostname}`,
      "Direct connections are IPv6-only on the free plan. Cluster pods will very " +
      "likely fail to reach this. Use the session pooler host instead.");
  } else {
    const mode = port === "5432" ? "session" : port === "6543" ? "transaction" : `unknown (port ${port})`;
    record("host is the shared pooler", true, `host=${u.hostname} port=${port} mode=${mode}`,
      mode === "session" ? "" :
      "Transaction mode breaks server-side prepared statements. kagent's pgx pool wants session mode on 5432.");
  }

  const { ok, out } = await psql(url,
    "prepare spike_ps as select 1; execute spike_ps; deallocate spike_ps;");
  record("server-side prepared statements", ok, out,
    ok ? "" : "pgx would need prepared statements disabled, or switch to session mode.");
}

async function checkLimits(url) {
  section("3. Connection budget");
  const { ok, out } = await psql(url, `
    select 'max_connections=' || current_setting('max_connections')
        || E'\\nin_use=' || (select count(*) from pg_stat_activity)::text
        || E'\\nreserved_superuser=' || current_setting('superuser_reserved_connections')
  `);
  record("connection limits", ok, out,
    ok ? "Cap database.postgres.pool.maxConns in the kagent values so the controller " +
         "plus agent pods stay well under this." : "");
}

async function checkPgvector(url) {
  section("4. pgvector");
  const { ok, out } = await psql(url, `
    select coalesce(
        (select 'installed, version ' || extversion from pg_extension where extname = 'vector'),
        (select 'available, not installed (default ' || default_version || ')'
           from pg_available_extensions where name = 'vector'),
        'not available')
  `);
  const present = ok && !out.includes("not available");
  record("vector extension", present, out,
    ok && out.includes("not installed")
      ? "Set database.postgres.vectorEnabled=true only once this reports installed." : "");
}

async function checkSeparateDatabase(url, keep) {
  section("5. Option 1 - separate database per component");

  const exists = await psql(url, `select 1 from pg_database where datname = '${SPIKE_DB}'`);
  let created = exists.ok && exists.out.trim() === "1";
  if (created) {
    console.log(`  ${C.dim}${SPIKE_DB} already exists, reusing${C.reset}\n`);
  } else {
    const res = await psql(url, `create database "${SPIKE_DB}"`);
    created = res.ok;
    record("login role can CREATE DATABASE", created, res.out || "created",
      created ? "" : "Fall back to option 2 (schemas) or a second Supabase project.");
  }
  if (!created) return false;

  const spikeUrl = withDatabase(url, SPIKE_DB);
  const routed = await psql(spikeUrl, "select current_database()");
  record("pooler routes to the non-default database", routed.ok, routed.out,
    routed.ok
      ? "Option 1 works: give kagent and agentregistry one database each."
      : "Supavisor did not route there. This is the expected failure mode; fall back to option 2.");

  if (routed.ok) {
    const ddl = await psql(spikeUrl, `
      create table if not exists spike_t (id serial primary key, v text);
      insert into spike_t (v) values ('x');
      select count(*) from spike_t;
      drop table spike_t;
    `);
    record("DDL round-trip in that database", ddl.ok, ddl.out);
  }

  if (!keep) {
    const drop = await psql(url, `drop database if exists "${SPIKE_DB}"`);
    if (!drop.ok) console.log(`  ${C.yellow}cleanup: could not drop ${SPIKE_DB}: ${drop.out}${C.reset}\n`);
  }
  return routed.ok;
}

async function checkSearchPath(url, keep) {
  section("6. Option 2 - one database, schema per component");

  const schema = await psql(url, `create schema if not exists "${SPIKE_SCHEMA}"`);
  record("can create a schema", schema.ok, schema.out || "created");
  if (!schema.ok) return false;

  const spUrl = withQuery(url, "options", `-csearch_path=${SPIKE_SCHEMA}`);
  const sp = await psql(spUrl, "show search_path");
  const forwarded = sp.ok && sp.out.includes(SPIKE_SCHEMA);
  record("pooler forwards startup options=-csearch_path", forwarded, sp.out,
    forwarded
      ? "Option 2 works: one role and schema per component, search_path in the URL."
      : "The pooler dropped the startup option. Only per-role " +
        "'alter role ... set search_path' or separate projects remain.");

  const role = await psql(url, `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'spike_role') then
        create role spike_role login password 'spike_only_${process.pid}';
      end if;
    end $$;
    alter role spike_role set search_path to "${SPIKE_SCHEMA}";
  `);
  record("can set a per-role search_path", role.ok, role.out || "set",
    role.ok ? "Per-role search_path is settable, which is the more robust variant of option 2." : "");

  if (!keep) {
    await psql(url, "drop role if exists spike_role");
    await psql(url, `drop schema if exists "${SPIKE_SCHEMA}" cascade`);
  }
  return forwarded;
}

function summarise(sepDbOk, schemaOk) {
  section("Recommendation");
  if (sepDbOk) {
    console.log("  Separate databases in one Supabase project. Cleanest separation,");
    console.log("  no search_path trickery, both components keep their own migrations.\n");
  } else if (schemaOk) {
    console.log("  One database, one role and schema per component, search_path passed");
    console.log("  in the connection URL and pinned on the role as a backstop.\n");
  } else {
    console.log("  Neither in-project option worked. Use a second Supabase project for");
    console.log("  agentregistry, or run agentregistry's bundled Postgres in-cluster.\n");
  }

  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length) {
    console.log(`  ${C.yellow}Checks that failed:${C.reset}`);
    for (const name of failed) console.log(`    - ${name}`);
    console.log();
  }
}

async function main() {
  const keep = process.argv.includes("--keep");
  loadEnv();

  const url = (process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    console.error("SUPABASE_DB_URL is not set. Put the Supabase pooler connection " +
      "string in .env (see .env.example) and re-run.");
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error(`SUPABASE_DB_URL does not look like a connection string: ${url.slice(0, 20)}...`);
    process.exit(1);
  }

  console.log(`\nProbing ${redact(url)}\n`);
  if (!(await checkConnectivity(url))) {
    console.error("Cannot connect. Nothing else can be tested.");
    process.exit(1);
  }
  await checkPoolerMode(url);
  await checkLimits(url);
  await checkPgvector(url);
  const sepDbOk = await checkSeparateDatabase(url, keep);
  const schemaOk = await checkSearchPath(url, keep);
  summarise(sepDbOk, schemaOk);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
