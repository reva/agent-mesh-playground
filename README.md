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
scripts/       bash entrypoints driven by the Makefile
helm/          values files per component
manifests/     namespaces, Gateway, routes, sample agents
examples/      sample agent, sample MCP server
```

## Credentials

All secrets live in a local, git-ignored `.env` and are pushed into the cluster
as Kubernetes Secrets by `scripts/secrets.sh`. Nothing secret is committed.
Copy `.env.example` to `.env` to start.
