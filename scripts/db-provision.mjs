#!/usr/bin/env node
/**
 * Create the per-component databases decided in docs/DECISIONS.md and write
 * their connection strings into .env.
 *
 * Idempotent: existing databases are left alone. Reads SUPABASE_DB_URL, which
 * must be the session pooler URL. Passwords are written to .env, never printed:
 * terminal scrollback and shell history are worse places for them.
 *
 * Usage:
 *   node scripts/db-provision.mjs [--vector] [--drop]
 *
 *   --vector  also install the pgvector extension in the kagent database,
 *             required before database.postgres.vectorEnabled can be true
 *   --drop    remove the databases again (destroys all agent and catalog state)
 */

import { execFile } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DATABASES = [
  { name: "kagent", envVar: "KAGENT_DATABASE_URL", owner: "kagent controller" },
  { name: "agentregistry", envVar: "AGENTREGISTRY_DATABASE_URL", owner: "agentregistry server" },
];

const C = {
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m",
};

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

async function psql(url, sql) {
  const args = ["-X", "-q", "-A", "-t", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", sql];
  try {
    const { stdout } = await execFileAsync("psql", [url, ...args], {
      timeout: 60000,
      env: { ...process.env, PGCONNECT_TIMEOUT: "15" },
    });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error("psql is not on PATH. Install the postgresql client and retry.");
      process.exit(1);
    }
    return { ok: false, out: (err.stderr || err.message || "").trim() };
  }
}

/** Connection string for `dbname`, with sslmode=require pinned, password masked. */
function urlFor(base, dbname, { mask = false } = {}) {
  const u = new URL(base);
  u.pathname = "/" + dbname;
  u.searchParams.set("sslmode", "require");
  if (mask && u.password) u.password = "***";
  return u.toString();
}

/** Set keys in .env, preserving comments and order. Returns false if there is no .env. */
function updateEnv(updates) {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return false;

  const lines = readFileSync(file, "utf8").split("\n");
  const remaining = new Map(Object.entries(updates));

  const rewritten = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;
    const key = match[2];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${match[1]}${key}=${value}`;
  });

  for (const [key, value] of remaining) rewritten.push(`${key}=${value}`);
  writeFileSync(file, rewritten.join("\n"));
  chmodSync(file, 0o600); // mode on writeFileSync is ignored for an existing file
  return true;
}

async function exists(url, dbname) {
  const { ok, out } = await psql(url, `select 1 from pg_database where datname = '${dbname}'`);
  return ok && out.trim() === "1";
}

async function provision(url, vector) {
  for (const db of DATABASES) {
    if (await exists(url, db.name)) {
      console.log(`  ${C.dim}${db.name} already exists${C.reset}`);
    } else {
      const res = await psql(url, `create database "${db.name}"`);
      if (!res.ok) {
        console.error(`  ${C.red}failed to create ${db.name}${C.reset}\n    ${res.out}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`  ${C.green}created${C.reset} ${db.name}  ${C.dim}(${db.owner})${C.reset}`);
    }

    if (vector && db.name === "kagent") {
      const res = await psql(urlFor(url, db.name), "create extension if not exists vector");
      console.log(res.ok
        ? `  ${C.green}installed${C.reset} pgvector in ${db.name}`
        : `  ${C.red}pgvector failed${C.reset}\n    ${res.out}`);
    }
  }

  // Written straight into .env rather than printed: these carry the password,
  // and a terminal is a worse place for it than a git-ignored file.
  const updates = Object.fromEntries(DATABASES.map((db) => [db.envVar, urlFor(url, db.name)]));
  const written = updateEnv(updates);
  console.log(`\n${C.bold}Wrote to .env:${C.reset}\n`);
  for (const db of DATABASES) {
    console.log(`  ${db.envVar}=${urlFor(url, db.name, { mask: true })}`);
  }
  if (!written) {
    console.log(`\n${C.yellow}No .env found. Copy .env.example to .env and re-run.${C.reset}`);
  }

  if (!vector) {
    console.log(`${C.dim}pgvector was not installed. Re-run with --vector before setting`);
    console.log(`database.postgres.vectorEnabled=true on kagent.${C.reset}`);
  }
}

async function drop(url) {
  const present = [];
  for (const db of DATABASES) {
    if (await exists(url, db.name)) present.push(db.name);
  }
  if (present.length === 0) {
    console.log("  Nothing to drop.");
    return;
  }

  console.log(`\n${C.yellow}This permanently destroys:${C.reset}`);
  for (const name of present) console.log(`  - ${name}`);
  console.log(`${C.yellow}All agents, sessions, chat history and catalog records go with them.${C.reset}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type the word drop to confirm: ");
  rl.close();
  if (answer.trim() !== "drop") {
    console.log("Aborted.");
    return;
  }

  for (const name of present) {
    // Supavisor holds a pooled backend open, so a plain DROP loses the race.
    const res = await psql(url, `drop database if exists "${name}" with (force)`);
    console.log(res.ok
      ? `  ${C.green}dropped${C.reset} ${name}`
      : `  ${C.red}failed to drop ${name}${C.reset}\n    ${res.out}`);
  }
}

async function main() {
  loadEnv();
  const url = (process.env.SUPABASE_DB_URL || "").trim();
  if (!url) {
    console.error("SUPABASE_DB_URL is not set. See .env.example.");
    process.exit(1);
  }

  const u = new URL(url);
  if (!u.hostname.includes("pooler.supabase.com")) {
    console.error(`${C.red}SUPABASE_DB_URL is not the session pooler (${u.hostname}).${C.reset}`);
    console.error("The direct host is IPv6-only and unreachable from the cluster, so the");
    console.error("connection strings this would print would not work there. See");
    console.error("docs/DECISIONS.md.");
    process.exit(1);
  }

  console.log(`\nAgainst ${urlFor(url, u.pathname.slice(1) || "postgres", { mask: true })}\n`);

  if (process.argv.includes("--drop")) {
    await drop(url);
  } else {
    await provision(url, process.argv.includes("--vector"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
