.PHONY: db-spike
# Probe the Supabase database for the properties the stack needs (docs/PLAN.md phase 3).
db-spike:
	node scripts/db-spike.mjs
