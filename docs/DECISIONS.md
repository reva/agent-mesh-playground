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
