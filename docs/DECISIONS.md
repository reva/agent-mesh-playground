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

## (open) database separation on Supabase

Whether kagent and agentregistry get separate databases, separate schemas in
one database, or separate projects. Decided by the phase 3 spike.

First spike run, 2026-09-10, against the **direct** connection. Established
facts about the database itself:

- PostgreSQL 17.6, TLS enforced.
- `max_connections` is 60, with 12 already in use and 3 reserved for
  superusers. Roughly 45 are available to the stack, so `pool.maxConns` has to
  be capped well below the pgx default of `max(4, NumCPU)` per pod.
- `vector` 0.8.2 is available but not installed. `vectorEnabled` stays false
  until someone runs `create extension vector`.
- The `postgres` role can `CREATE DATABASE`, and server-side prepared
  statements work.
- `db.<ref>.supabase.co` publishes **no A record**, only AAAA. Not a docs
  claim, a resolver result. An IPv4-only cluster node cannot reach it, so the
  direct connection is unusable from Infomaniak regardless of anything else.

The separation question is still open: the direct connection bypasses
Supavisor, so it cannot show whether the pooler routes to a second database or
forwards a startup `search_path`. Needs a second run against the session
pooler URL.

## 2026-09-10 - npm scripts as the task runner, Node for the scripts

`package.json` scripts instead of a Makefile, and `.mjs` instead of bash or
Python for the entrypoints. No dependencies and no build step: Node is only
the runner, and the scripts shell out to `kubectl`, `helm` and `psql`. Make
solves incremental rebuilds, which this repo does not have.
