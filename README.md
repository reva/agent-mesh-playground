# agent-mesh-playground

A persistent agent playground running the solo.io Agent Mesh components on a
hosted Kubernetes cluster:

- **kagent** - agent runtime and UI, Agent/ModelConfig/RemoteMCPServer CRDs
- **agentgateway** - Gateway API data plane for MCP and model traffic
- **agentregistry** - catalog for Skills and MCP servers

Unlike the local workshop setup this is built around managed, mostly free
infrastructure:

| Concern | Choice |
|---|---|
| Kubernetes | Infomaniak Public Cloud, shared (free) control plane |
| Database | Supabase Postgres, shared pooler in session mode |
| Model access | OpenRouter, brokered through agentgateway |
| Deployment | Run locally from this repo against the remote cluster |

Status: planning. Nothing is deployed yet. See [docs/PLAN.md](docs/PLAN.md) for
the implementation plan and [docs/PREREQUISITES.md](docs/PREREQUISITES.md) for
the accounts and credentials to prepare.

## Repository layout (target)

```
docs/          plan, prerequisites, pinned versions, decisions
scripts/       node entrypoints, run through npm scripts
helm/          values files per component
manifests/     namespaces, Gateway, routes, sample agents
examples/      sample agent, sample MCP server
```

Everything runs through `package.json` scripts. There is no build step and no
npm dependencies; Node is the task runner and the scripts shell out to
`kubectl`, `helm` and `psql`.

```bash
npm run db:spike          # probe the Supabase database (docs/PLAN.md phase 3)
npm run db:spike -- --keep  # ...and leave the spike objects behind
```

## Credentials

All secrets live in a local, git-ignored `.env` and are pushed into the cluster
as Kubernetes Secrets by `scripts/secrets.mjs`. Nothing secret is committed.
Copy `.env.example` to `.env` to start.
