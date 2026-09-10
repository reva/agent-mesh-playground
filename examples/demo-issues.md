# Issues to open during the demo

Three reports of the kind that arrive in real life. Paste one as an issue body
and let the CronJob pick it up. The titles are as unhelpful as the bodies on
purpose.

## 1. Vague, but the reporter did give one fact

**Title:** up.sh doesn't work

> tried to set this up on my machine and it just fails somewhere in the helm
> part. waited a while and nothing. is there something else I need to install
> first? worked for Ana apparently

What good looks like: the agent should ask which Helm step and for the error
text, notice that `scripts/up.sh` has a ten minute timeout on the kagent
install, point at `docs/PREREQUISITES.md` for the missing dependency theory, and
not invent a stack trace.

## 2. Two problems in one report

**Title:** db stuff broken + also the UI is slow

> npm run db:provision printed connection strings but the second one looked
> wrong, missing the sslmode bit I think. Also unrelated the kagent UI takes
> forever to load the first time.

What good looks like: it should say these are two issues and suggest splitting
them, and it should check what `scripts/db-provision.mjs` actually writes rather
than agreeing with the reporter.

## 3. Near duplicate of number 1

Open this one a few minutes after the first, so the duplicate search has
something to find.

**Title:** helm install times out during setup

> Running the up script, helm sits on the kagent chart for ten minutes and then
> gives up. Single node cluster.

What good looks like: it should find issue 1 under Possible duplicates and say
how they relate. This one has more detail than issue 1, so the useful
refinement is to point at the older issue rather than to restate this one.
