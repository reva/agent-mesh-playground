# Prerequisites

Things to set up before the first deploy. Everything here is manual account
work; the repo automates only what happens after these exist.

## 1. Infomaniak Public Cloud Kubernetes

1. Create an Organisation and a Public Cloud project in the Infomaniak Manager.
2. Under *Kubernetes services*, create a cluster:
   - **Control plane:** shared/development format. Free, single API server
     replica, shared datastore up to 256 MB, no SLA, up to 10 nodes.
   - **Kubernetes version:** 1.31 or newer.
   - **Region:** pick one and keep it; the Supabase region should be near it.
3. Add a node pool. Sizing target for the full stack with an external database:
   2 nodes of 2 vCPU / 4 GB (`a2-ram4-*` class) or 3 nodes of 1 vCPU / 2 GB.
   Nodes are billed per hour and are **not** free. The 300 EUR / three month
   trial credit covers this comfortably.
4. Download the kubeconfig from the cluster page. Save it outside this repo,
   for example `~/.kube/infomaniak-agent-mesh.yaml`, and point `KUBECONFIG`
   at it in `.env`.

Notes carried into the plan:

- A `Service` of type `LoadBalancer` provisions an Octavia load balancer with a
  floating IP. It is billed separately. The floating IP survives pod restarts;
  it is released when the Service is deleted. `loadbalancer.openstack.org/keep-floatingip: "true"`
  together with an explicit `loadBalancerIP` preserves it across recreation.
- Block storage PVCs are available through the Cinder CSI driver. Verify the
  actual `StorageClass` name on the cluster before relying on it. With an
  external database the stack should need no PVCs at all.

## 2. Supabase Postgres

1. Create a free-plan project. One project is enough for both components.
2. Note the **shared pooler** connection string, not the direct one. On the
   free plan the direct `db.<ref>.supabase.co` host is IPv6 only, and
   Infomaniak worker nodes are expected to be IPv4 only. The shared pooler is
   IPv4 on every plan.
3. Use **session mode**, port `5432` on the pooler host, username
   `postgres.<project-ref>`. Session mode keeps prepared statements working,
   which the kagent controller's pgx pool relies on. Transaction mode on 6543
   would require disabling prepared statements and is not the default here.
4. Enable the `vector` extension if kagent long term memory is wanted
   (`database.postgres.vectorEnabled`).
5. Free plan projects pause after about a week of inactivity. A paused project
   will make every controller crash-loop until it is resumed.

Database separation between kagent and agentregistry is an open question
tracked as a spike in the plan (phase 3).

## 3. OpenRouter

1. Create an API key with a spend limit set.
2. Pick a model. The workshop setup used `z-ai/glm-5.3`; any
   OpenAI-chat-completions-compatible model on OpenRouter works.
3. The key goes into `.env` as `OPENROUTER_API_KEY` and is written only into
   the agentgateway namespace. kagent is configured with a placeholder key and
   reaches the model through the gateway.

## 4. Local tooling

`kubectl`, `helm` (4.x), `node` 18+, the `psql` client, `git`, `curl`, `jq`.
No Docker or kind is needed unless a custom MCP image has to be built, which
also requires a container registry the cluster can pull from.

Also add the kubeconfig path to `.env`. `KUBECONFIG` is a plain filesystem
path to the YAML file downloaded from the Infomaniak dashboard, not the file's
contents and not base64. `KUBE_CONTEXT` is the context name inside it, from
`kubectl --kubeconfig <path> config get-contexts`. The scripts pass `--context`
on every call so they never act on the ambient current-context.
