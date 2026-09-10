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
