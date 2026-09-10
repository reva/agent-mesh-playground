# Decisions

Short records of choices that are not obvious from the manifests. One entry per
decision, newest last.

## 2026-09-10 - external state only

Both kagent and agentregistry use Supabase rather than their bundled Postgres
charts. Keeps nodes disposable, lets the node pool scale to zero, and avoids
depending on the Cinder storage class.

## 2026-09-10 - OpenRouter key only in agentgateway

kagent gets a placeholder API key and a base URL pointing at the in-cluster
gateway. The real key lives in one secret in `agentgateway-system`. Agents
cannot read it and every model call passes one policy point.

## 2026-09-10 - no public exposure by default

kagent's controller auth mode is `unsecure` out of the box. Access is via
port-forward until oauth2-proxy and TLS are in place. Also avoids the cost of
an Octavia load balancer.

## 2026-09-10 - separate Supabase database per component

Decided by the phase 3 spike (`npm run db:spike`), run against the session
pooler. kagent gets one database, agentregistry another, both in the same free
Supabase project.

What the spike established:

- Supavisor **does** route to a database other than `postgres` when it is named
  in the connection string, and DDL works there.
- Supavisor **drops** a startup `options=-csearch_path=...`. The schema-per-
  component variant would have to rely on `alter role ... set search_path`
  instead, which works but is invisible from the connection string. Separate
  databases need no such trick.

## 2026-09-10 - connect through the session pooler, never directly

`db.<ref>.supabase.co` publishes no A record, only AAAA. An IPv4-only cluster
node cannot reach it at all. `aws-0-eu-central-1.pooler.supabase.com` has three
A records. Port 5432 on the pooler is session mode, which keeps server-side
prepared statements working for the controller's pgx pool. TLS 1.3 is
negotiated either way; add `sslmode=require` so it is not left to libpq's
default.

Note that `pg_stat_ssl` is useless for checking this: through a pooler it
describes Supavisor's own link to Postgres, not the client's.

## 2026-09-10 - the real connection ceiling is 15, not 60

The database reports `max_connections=60`, but Supavisor rejects the 16th
concurrent session-mode client with
`(EMAXCONNSESSION) max clients reached in session mode - max clients are
limited to pool_size: 15`. That pool size, not `max_connections`, is the budget
the whole stack shares.

It fits, because only one process per component connects. In kagent 0.10.0
`POSTGRES_DATABASE_URL` is read by the controller (`go/core/pkg/app/app.go`)
and the migrate CLI, and by nothing else; agent pods reach the controller over
its API and hold no pool of their own. So the steady state is one controller
pool plus one agentregistry pool.

Still worth constraining, because pgx defaults to `max(4, NumCPU)` connections
per pool and the pool size is shared with any `psql` session, migration job or
second controller replica:

- set `database.postgres.pool.maxConns` explicitly on kagent
- keep `controller.replicas` at 1
- raising the pool size in the Supabase dashboard is the escape hatch if agent
  count grows; transaction mode on 6543 is the other, at the cost of needing
  pgx's simple protocol

## 2026-09-10 - kagent only, for now

The node pool is one node with 940m CPU and 1130Mi memory allocatable, of which
system pods take roughly 200m / 138Mi. Requests are 210m/384Mi for kagent,
100m/128Mi for agentgateway, 100m/192Mi for agentregistry. All three fit only
with nothing left for agent pods, so only kagent is installed.

Consequence: no gateway to broker the model call, so kagent holds the OpenRouter
key itself and its ModelConfig points at `https://openrouter.ai/api/v1`.
`manifests/gateway.yaml` still holds the brokered configuration. Restoring it
means a bigger node pool, applying that manifest, and pointing the ModelConfig
back at the in-cluster gateway.

## 2026-09-10 - the refiner polls, and is not triggered

A tracker would push a webhook, which is the right shape and needs an inbound
path this cluster does not have. Adding one means ingress-nginx, an Octavia load
balancer, a DNS record and a certificate, against the "no public exposure"
decision above.

So a CronJob polls from inside the cluster, outbound only. A minute of latency
does not matter for issue refinement. A `cloudflared` pod would give real
webhooks without a load balancer and is the upgrade path if the latency ever
does matter, at the cost of a live inbound tunnel.

Rejected: a `needs-refinement` label as the trigger. An agent that waits to be
poked is a CLI with extra steps, and the point of running it in the cluster is
that it reacts on its own. The label survives inverted, as `no-refine`, so one
issue can opt out.

## 2026-09-10 - the poll picks the issues, the agent refines one

`scripts/refiner-poll.mjs` decides what is pending and calls the agent once per
issue. It would have been fewer moving parts to tell the agent "find issues that
need refining and refine them" in one turn.

An unattended loop needs an idempotency rule that does not depend on the model.
The rule is that an issue is pending when the token's own account has not
commented on it, which is true regardless of what the model wrote. A marker line
in the comment body would have worked too, and would have failed silently the
first time the model omitted it.

It also bounds the work: one issue in, one comment out, and a run touches at
most `REFINER_MAX_ISSUES` issues.

## 2026-09-10 - two MCP servers so the tool list is the permission model

The refiner reads repository content through
`api.githubcopilot.com/mcp/x/repos/readonly` and writes comments through
`api.githubcopilot.com/mcp/x/issues`. Splitting them means repository access has
no write tool at the transport, not merely an unlisted one.

Within the issues server, `toolNames` grants `add_issue_comment` and withholds
`issue_write`, so the agent cannot edit a body, title or label. Underneath both,
the PAT is fine-grained to the one repository. Three layers, each of which can
be read off a single file.
