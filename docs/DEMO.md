# Demo: the issue refiner

A human opens a thin bug report. A minute later the report has a comment on it
that an engineer could pick up, with the duplicates already checked and the
suspect file already read. Nobody triggered anything.

## What it is

One agent, `agents/refiner.yaml`, plus a CronJob that polls the tracker. The
agent has four issue tools and three read-only repository tools, listed in its
YAML. Its only write is `add_issue_comment`.

```
CronJob (every minute)
  └─ scripts/refiner-poll.mjs
       ├─ GitHub API: which open issues has my account not commented on?
       └─ kagent controller A2A: "Refine issue 42 in repository owner/name"
            └─ refiner agent
                 ├─ github-issues       read the issue, search for duplicates, comment
                 └─ github-repo-read    read the files the report names
```

The poll script decides which issues are pending, and the agent refines the one
it is given. Selection is deterministic, so a run cannot comment twice on the
same issue whatever the model does.

## Setup

Fill `GITHUB_REPO` and `GITHUB_TOKEN` in `.env`, then `./scripts/up.sh`. Both
empty means no refiner and no CronJob.

### The token

A fine-grained PAT, made at
`https://github.com/settings/personal-access-tokens/new`:

| Field | Value |
|---|---|
| Resource owner | the account or org that owns the repository |
| Repository access | Only select repositories, then that one |
| Issues | Read and write |
| Contents | Read-only |
| Metadata | Read-only, mandatory, enabled for you |

Nothing else. Issues write is the comment, Contents read is the file the report
names. The agent cannot touch code even if something goes wrong, and if the
model is talked into something the worst it can do is write a comment.

If the repository belongs to an organisation, set the resource owner to that
organisation, and expect to wait: an org owner has to approve the token when the
fine-grained PAT policy is on.

One tool is not covered by that grant. `search_code` is absent from GitHub's
table of endpoints that accept fine-grained tokens, and code search has a
history of rejecting them. Check before demoing:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/search/code?q=repo:$GITHUB_REPO+kagent"
```

403 or 422 means drop `search_code` from the tool list in `agents/refiner.yaml`.
The agent still reads files with `get_file_contents`, which returns a listing
when given a directory. A classic PAT with the `repo` scope would fix code
search and grant write access to every repository you can see, which is a poor
trade for one tool.

Comments appear as whoever owns the token, so use a machine account if you can.
Your own name on the agent's comments reads badly on a screen, and the poll
treats any comment from that account as "already refined", which means your own
replies would stop it looking at the issue again.

Rehearse without waiting for the schedule:

```bash
npm run refine -- --dry-run       # list what the next run would pick up
npm run refine -- --issue 42      # refine one issue now
```

## Running it

1. Show `agents/refiner.yaml`. The tool list is the permission model, and the
   system message is the whole of the agent's behaviour. Both are in git.
2. Open a deliberately thin issue. `examples/demo-issues.md` has three to
   choose from if you would rather not improvise.
3. Keep talking. Nobody touches a terminal.
4. Refresh the issue after a minute. The comment is there.
5. Answer its questions in a reply and open a second issue that is a near
   duplicate of the first. Next run it finds the duplicate and says so.

Optional close: edit the system message, `kubectl apply -f agents/refiner.yaml`,
and run the same issue again through `npm run refine -- --issue N`. The
behaviour changes because a file in git changed.

## Watching it

```bash
kubectl -n kagent get cronjob refiner-poll
kubectl -n kagent logs -l job-name --tail=20 --prefix
kubectl -n kagent logs deploy/refiner --tail=50
```

## Limits worth stating out loud

The agent reads issue text written by other people and holds a token. The tool
list is what keeps that safe, so the blast radius of a bad issue is one comment
on that issue. On a public repository, note that anyone can open an issue and
so anyone can spend your model budget.

First run on a repository with a backlog would otherwise comment on everything,
so the poll ignores issues older than seven days and refines at most three per
run. Both are set in `manifests/refiner-cron.yaml`. The `no-refine` label opts
one issue out.

Polling, not webhooks, because the cluster has no inbound path. See
`docs/DECISIONS.md`.
