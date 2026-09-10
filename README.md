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

Status: kagent is deployed and working. agentgateway and agentregistry are not,
because the current node pool is one 1 vCPU / 2 GB node and would not fit them.
While the gateway is absent kagent calls OpenRouter directly, so the provider
key sits in the kagent namespace rather than being brokered.

```bash
kubectl --context $KUBE_CONTEXT -n kagent port-forward svc/kagent-ui 8082:8080
```

then http://127.0.0.1:8082. The `hello` agent in `examples/hello-agent.yaml` is
a smoke test for the model path.

See [docs/PLAN.md](docs/PLAN.md) for the remaining phases and
[docs/PREREQUISITES.md](docs/PREREQUISITES.md) for the accounts involved.

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
npm run db:spike              # probe the Supabase database, prove its properties
npm run db:provision          # create the kagent and agentregistry databases
npm run db:provision -- --vector   # ...and install pgvector in the kagent one
npm run db:provision -- --drop     # remove them again, with a typed confirmation
```

## Credentials

All secrets live in a local, git-ignored `.env` and are pushed into the cluster
as Kubernetes Secrets by `scripts/secrets.mjs`. Nothing secret is committed.
Copy `.env.example` to `.env` to start.
