# agent-mesh-playground

[kagent](https://kagent.dev) on Infomaniak Kubernetes, with Supabase Postgres
and OpenRouter. Deployed from a laptop.

## Use

```bash
./scripts/up.sh                        # deploy, then port-forward the UI
./scripts/ask.sh "what is kubernetes?" # one message, one answer
./scripts/down.sh                      # remove it again, databases kept
```

UI: http://127.0.0.1:8082 once `up.sh` has run.

`ask.sh` takes an optional second argument to pick an agent, default `hello`.

## Setup

```bash
cp .env.example .env               # then fill it in
npm run db:spike                   # check the Supabase database is usable
npm run db:provision -- --vector   # create the databases, write their URLs to .env
./scripts/up.sh
```

[docs/PREREQUISITES.md](docs/PREREQUISITES.md) covers the cluster, the Supabase
project and the OpenRouter key. `.env` holds every secret and is git-ignored.

## Layout

```
scripts/      up, down, ask, plus the database helpers
helm/         kagent values
manifests/    gateway config, not deployed yet
examples/     the hello agent
docs/         plan, decisions, pinned versions
```

## State

kagent only. agentgateway and agentregistry are configured but not deployed:
the node pool is one 1 vCPU / 2 GB node and cannot fit them. While the gateway
is absent, kagent calls OpenRouter directly and holds the key itself.

[docs/PLAN.md](docs/PLAN.md) has the remaining phases,
[docs/DECISIONS.md](docs/DECISIONS.md) why things are the way they are.
