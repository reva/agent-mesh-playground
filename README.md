# agent-mesh-playground

[kagent](https://kagent.dev) on Infomaniak Kubernetes, with Supabase Postgres
and OpenRouter. Deployed from a laptop.

## Use

```bash
./scripts/up.sh                        # deploy, then port-forward the UI
./scripts/ask.sh "what is kubernetes?" # one message, one answer
npm run refine -- --dry-run            # what the issue refiner would pick up
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
scripts/      up, down, ask, refine, plus the database helpers
helm/         kagent values
agents/       the issue refiner
manifests/    the refiner CronJob, and gateway config that is not deployed yet
examples/     the hello agent, and issues to open during a demo
docs/         plan, decisions, demo script, pinned versions
```

## The issue refiner

The one agent here that does a job rather than proving the wiring. Someone opens
a thin bug report; a minute later it has a comment with the duplicates checked
and the named file actually read. A CronJob polls the tracker, so nothing
triggers it by hand.

Set `GITHUB_REPO` and `GITHUB_TOKEN` in `.env` and `up.sh` deploys it. Leave
them empty and it does not. [docs/DEMO.md](docs/DEMO.md) has the run-through and
what the token needs.

## State

kagent only. agentgateway and agentregistry are configured but not deployed:
the node pool is one 1 vCPU / 2 GB node and cannot fit them. While the gateway
is absent, kagent calls OpenRouter directly and holds the key itself.

[docs/PLAN.md](docs/PLAN.md) has the remaining phases,
[docs/DECISIONS.md](docs/DECISIONS.md) why things are the way they are.

The refiner runs on this footprint because it adds one agent pod and one
short-lived CronJob pod. Its MCP servers are GitHub's hosted ones, so no MCP
server runs in the cluster.
