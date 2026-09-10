# Implementation plan

Goal: a long-lived agent playground on a remote cluster, deployable and
re-deployable from a laptop with `make setup`, using free or near-free managed
services. The local workshop repo `ch-open/agent-mesh-setup` is the functional
reference; this repo differs in that the cluster, the database and the ingress
path are real rather than local.

## Architecture

```
laptop ──kubectl/helm──▶ Infomaniak Kubernetes (shared control plane)
                          │
                          ├─ ns kagent            controller + UI + agent pods
                          ├─ ns agentgateway-system  gateway proxy + controller
                          ├─ ns agentregistry      registry server
                          └─ ns playground         sample agents, MCP servers
                          │
                          ├──▶ Supabase Postgres (pooler, session mode, TLS)
                          └──▶ OpenRouter  (only from the gateway proxy)
```

Two invariants:

1. **The OpenRouter key exists in exactly one namespace.** kagent's ModelConfig
   points at `http://agentgateway-proxy.agentgateway-system.svc.cluster.local/v1`
   with a placeholder key. The gateway holds the real key and adds it upstream.
   This is what the workshop setup does and it is worth keeping: agents and
   agent-authored config never see the credential, and every model call is
   observable and policy-controllable in one place.
2. **No cluster-local state.** Both databases are external, so nodes stay
   disposable and a node pool can be scaled to zero to stop billing without
   losing the playground.

## Component versions

Pinned to the set already verified in the reference repo on 2026-09-07, so the
first deploy debugs infrastructure rather than version drift. Recorded in
`docs/VERSIONS.md`, bumped deliberately.

| Component | Version |
|---|---|
| Gateway API | 1.6.0 standard |
| kagent + kagent-crds | 0.10.0 |
| agentgateway + agentgateway-crds | 1.5.0 |
| agentregistry | 0.4.0 |

## Phases

### Phase 0 - prerequisites (manual)

Per [PREREQUISITES.md](PREREQUISITES.md): cluster, kubeconfig, Supabase
project, OpenRouter key, `.env` filled in.

Exit: `kubectl --context $KUBE_CONTEXT get nodes` lists Ready nodes and
`psql "$KAGENT_DATABASE_URL" -c 'select 1'` succeeds from the laptop.

### Phase 1 - repo scaffolding and preflight

- `Makefile` with `preflight`, `secrets`, `setup`, `status`, `open`, `teardown`.
- `scripts/lib.sh`: `.env` loading, context pinning (every kubectl call carries
  `--context`, never the ambient current-context), `die`/`need` helpers.
- `scripts/preflight.sh`: required binaries, cluster reachability, node
  capacity, presence of a default StorageClass, whether the Gateway API CRDs
  are already installed, and a reachability probe against both database URLs.

Exit: `make preflight` passes against the real cluster.

### Phase 2 - cluster baseline

- Install Gateway API 1.6.0 standard CRDs (server-side apply).
- `manifests/namespaces.yaml`: `playground` plus labels; the component charts
  create their own namespaces.
- `scripts/secrets.sh` creates, from `.env`:
  - `agentgateway-system/openrouter-api-key` with the real key
  - `kagent/kagent-gateway-client` and `playground/kagent-gateway-client` with
    a placeholder value
  - `kagent/kagent-database` and `agentregistry/agentregistry-database` with
    the Supabase URLs
  The script is idempotent (`create --dry-run=client | apply`) and is the only
  place secrets enter the cluster.

Exit: `make secrets` re-runnable, `kubectl get secret` shows the five secrets,
no secret material in git.

### Phase 3 - data layer (spike, then implement)

**Spike:** how do two components share one Supabase project without colliding?
kagent and agentregistry both create their own tables. Options in order of
preference:

1. Separate databases in the same project, selected via the database name in
   the pooler connection string. Needs verification that Supavisor routes to a
   non-`postgres` database.
2. One database, one role and one schema per component, with
   `?options=-csearch_path%3Dkagent` in the URL. Needs verification that
   Supavisor forwards startup `options`.
3. Separate Supabase projects. Always works, uses the second free project slot.

Decide from the spike, record the outcome in `docs/DECISIONS.md`.

**Implementation:**

- `sql/` with the role, schema and grant statements actually used.
- Enable the `vector` extension if kagent memory features are wanted, and set
  `database.postgres.vectorEnabled: true` to match.
- Tune `database.postgres.pool.maxConns` down. The free plan has a small
  connection budget and every agent pod plus the controller opens a pool.
- Decide on `sessionRetentionDays` so the playground does not grow unbounded.

Exit: both components can create their tables against Supabase, verified by
running the kagent migration alone before installing the rest.

### Phase 4 - agentgateway and the OpenRouter path

- Install `agentgateway-crds` and `agentgateway` 1.5.0.
- `manifests/gateway.yaml`: `Gateway` on gatewayClass `agentgateway`,
  `AgentgatewayBackend` for OpenRouter (host `openrouter.ai`, path
  `/api/v1/chat/completions`, TLS SNI, auth from the secret), and an
  `HTTPRoute` for `/v1`.
- Verify by port-forwarding the proxy and issuing a plain
  `POST /v1/chat/completions`.

Exit: a chat completion returns through the gateway with no key on the client
side.

### Phase 5 - kagent

- Install `kagent-crds` then `kagent` 0.10.0 with `helm/kagent-values.yaml`:
  - `database.postgres.bundled.enabled: false`, URL supplied through
    `urlFile` with the secret mounted via `controller.volumes` /
    `controller.volumeMounts`, so the connection string is never a Helm value
    and never lands in the release manifest.
  - `providers.default: openAI` pointing at the in-cluster gateway, as in the
    reference values.
  - Built-in agents (`k8s-agent`, `istio-agent`, and the rest) disabled to keep
    the footprint small; enable individually later.
  - `kmcp.enabled: true` so MCP servers can be declared as CRDs.
  - Resource requests sized for the chosen node pool.
- Confirm the controller applied its migrations against Supabase rather than
  failing over to something local.

Exit: kagent UI reachable via port-forward, default ModelConfig healthy, a chat
with a trivial agent completes.

### Phase 6 - agentregistry

- Install 0.4.0 with `database.postgres.type: external` and
  `external.secretRef` pointing at the secret from phase 2 (key
  `AGENT_REGISTRY_DATABASE_URL`).
- Fetch `arctl` into `bin/` with checksum verification, same approach as the
  reference repo.

Exit: `arctl get mcps` works through a port-forward.

### Phase 7 - a working example end to end

Port one small example from the reference repo rather than all four exercises:
a Skill plus an MCP server plus an Agent that calls it through the gateway.

Open question: the reference builds its MCP image locally and pushes to a kind
local registry. That does not exist here. Either use an already-published MCP
image, or add GHCR as the image source and a pull secret. Prefer a public image
first; a private GHCR package plus `imagePullSecrets` is the fallback.

Exit: an agent in the `playground` namespace answers a prompt using an MCP
tool, with the call visible in the gateway.

### Phase 8 - access

Default: **no public exposure.** `make open` starts port-forwards for the
kagent UI, the registry UI, the gateway UI and the gateway MCP endpoint, the
same as the workshop repo. This costs nothing and avoids putting an
unauthenticated UI on the internet.

kagent's controller runs `auth.mode: unsecure` by default, which means anyone
who reaches the UI can drive agents that hold an OpenRouter budget. Public
exposure therefore comes as one optional, explicitly enabled step:

- ingress-nginx as a `LoadBalancer` Service (one Octavia LB, billed)
- cert-manager with a Let's Encrypt HTTP-01 issuer
- a DNS record pointing at the floating IP
- the chart's bundled `oauth2-proxy` subchart with
  `controller.auth.mode: trusted-proxy`, or the Gateway API `ui.httpRoute`
  path if the ingress should be agentgateway itself

Long-lived streaming matters here: the UI defaults to 1800 s stream timeouts
and any proxy in front needs matching `proxy-read-timeout`, otherwise chats
break mid-response.

Exit: documented, disabled by default, with the cost of enabling it stated.

### Phase 9 - operations

- `scripts/status.sh`: pods per namespace, Gateway and route status, kagent
  CRs, database reachability.
- `scripts/teardown.sh`: uninstall releases, optionally drop the database
  content, require an explicit confirmation flag.
- Cost control: document scaling the node pool to zero, and that Supabase
  pauses the project when idle.
- `docs/VERSIONS.md` with the pins and the upgrade procedure.

## Risks and unknowns

| Risk | Handling |
|---|---|
| Supavisor does not route to a second database or forward `search_path` | Phase 3 spike decides; worst case a second Supabase project |
| pgx prepared statements against the pooler | Session mode on 5432; transaction mode would need pool settings changed |
| Supabase free plan connection ceiling with several agent pods | Cap `pool.maxConns`, keep agent count low |
| Free project pauses when idle | Documented; a scheduled ping is possible later |
| Shared control plane has no SLA and a 256 MB datastore | Acceptable for a playground; keep CRD and object counts modest |
| Node cost is not zero | Two small nodes, scale to zero when unused |
| kagent UI is unauthenticated by default | No public exposure until oauth2-proxy is in place |
| Custom MCP images need a registry the cluster can pull | Prefer public images; GHCR plus pull secret as fallback |

## Later, beyond the first working stack

- Further solo.io components (kgateway, Istio ambient) on the same cluster.
- Additional exercises ported from the workshop repo.
- GitOps: the manifests are already declarative, so Argo CD or Flux is a small
  step once the shape is stable.
- Secret handling beyond a local `.env`, for example SOPS with an age key.
