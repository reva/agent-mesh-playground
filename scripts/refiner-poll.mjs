#!/usr/bin/env node
/**
 * Find open issues nobody has refined yet and hand each one to the refiner
 * agent. Runs from a laptop through scripts/refine.sh, and in the cluster from
 * the CronJob in manifests/refiner-cron.yaml. Same file either way.
 *
 * Which issues are pending is decided here rather than by the agent, so the
 * loop is deterministic: an issue is pending when the token's own account has
 * not commented on it. That holds no matter what the model writes, which is
 * what stops an unattended loop from commenting twice.
 *
 * Reads only process.env; refine.sh loads .env, the CronJob supplies the same
 * names from a Secret and a ConfigMap.
 *
 *   GITHUB_REPO             owner/name of the repository to watch
 *   GITHUB_TOKEN            fine-grained PAT, issues read and write, that repo
 *   REFINER_AGENT_URL       kagent controller base URL
 *   REFINER_AGENT           agent name, default refiner
 *   REFINER_MAX_ISSUES      issues per run, default 3
 *   REFINER_MAX_AGE_DAYS    ignore issues older than this, default 7
 *   REFINER_SKIP_LABEL      opt out one issue, default no-refine
 *
 * Usage:
 *   node scripts/refiner-poll.mjs [--issue N] [--dry-run]
 *
 *   --issue N   refine exactly this issue, ignoring the filters above
 *   --dry-run   list what would be refined and call no agent
 */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const AGENT_URL = process.env.REFINER_AGENT_URL || "http://kagent-controller.kagent.svc.cluster.local:8083";
const AGENT = process.env.REFINER_AGENT || "refiner";
const MAX_ISSUES = Number(process.env.REFINER_MAX_ISSUES || 3);
const MAX_AGE_DAYS = Number(process.env.REFINER_MAX_AGE_DAYS || 7);
const SKIP_LABEL = process.env.REFINER_SKIP_LABEL || "no-refine";

const only = value("--issue");
const dryRun = has("--dry-run");

function die(message) {
  console.error(message);
  process.exit(1);
}

if (!REPO || !/^[^/\s]+\/[^/\s]+$/.test(REPO)) die("GITHUB_REPO must be set to owner/name.");
if (!TOKEN) die("GITHUB_TOKEN is not set.");
if (has("--issue") && (only === undefined || !/^\d+$/.test(only))) die("--issue takes an issue number.");

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "agent-mesh-playground-refiner",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`GET ${path} returned ${res.status} ${res.statusText}`);
  return res.json();
}

/** Ask the agent to refine one issue. The agent posts the comment itself. */
async function refine(number) {
  const body = {
    jsonrpc: "2.0",
    id: String(number),
    method: "message/send",
    params: {
      message: {
        role: "user",
        messageId: `refine-${number}-${Date.now()}`,
        parts: [{ kind: "text", text: `Refine issue ${number} in repository ${REPO}.` }],
      },
    },
  };
  const res = await fetch(`${AGENT_URL}/api/a2a/kagent/${AGENT}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`agent returned ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "agent reported an error");
}

/**
 * Issues the agent's own account has not commented on yet. The listing carries
 * a comment count, so issues nobody has touched cost no extra request.
 */
async function pending(login) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const listed = await gh(`/repos/${REPO}/issues?state=open&sort=created&direction=desc&per_page=50`);
  const candidates = listed
    .filter((issue) => !issue.pull_request)
    .filter((issue) => !issue.labels.some((label) => label.name === SKIP_LABEL))
    .filter((issue) => Date.parse(issue.created_at) >= cutoff)
    .reverse();

  const out = [];
  for (const issue of candidates) {
    if (out.length >= MAX_ISSUES) break;
    if (issue.comments > 0) {
      const comments = await gh(`/repos/${REPO}/issues/${issue.number}/comments?per_page=100`);
      if (comments.some((comment) => comment.user?.login === login)) continue;
    }
    out.push(issue);
  }
  return out;
}

let issues;
if (only !== undefined) {
  const issue = await gh(`/repos/${REPO}/issues/${only}`);
  if (issue.pull_request) die(`#${only} is a pull request, not an issue.`);
  issues = [issue];
} else {
  const me = await gh("/user");
  issues = await pending(me.login);
}

if (issues.length === 0) {
  console.log(`Nothing pending in ${REPO}.`);
  process.exit(0);
}

let failed = 0;
for (const issue of issues) {
  const label = `#${issue.number} ${issue.title}`;
  if (dryRun) {
    console.log(`would refine ${label}`);
    continue;
  }
  try {
    await refine(issue.number);
    console.log(`refined ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`failed ${label}: ${err.message}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
