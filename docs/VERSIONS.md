# Pinned versions

Baseline taken from `ch-open/agent-mesh-setup`, verified there on 2026-09-07.
Bump deliberately, one component at a time, and record the result here.

| Component | Pin | Chart source |
|---|---|---|
| Gateway API | 1.6.0 standard | `github.com/kubernetes-sigs/gateway-api` release manifest |
| kagent-crds | 0.10.0 | `oci://ghcr.io/kagent-dev/kagent/helm/kagent-crds` |
| kagent | 0.10.0 | `oci://ghcr.io/kagent-dev/kagent/helm/kagent` |
| agentgateway-crds | v1.5.0 | `oci://cr.agentgateway.dev/charts/agentgateway-crds` |
| agentgateway | v1.5.0 | `oci://cr.agentgateway.dev/charts/agentgateway` |
| agentregistry | 0.4.0 | `oci://ghcr.io/agentregistry-dev/agentregistry/charts/agentregistry` |
| arctl | v0.4.0 | GitHub release, checksum verified into `bin/` |
| node (refiner CronJob) | 22-alpine | Docker Hub, `manifests/refiner-cron.yaml` |

Cluster side, not pinned by this repo: Kubernetes 1.31+ on Infomaniak's shared
control plane, Postgres 17 on Supabase.
