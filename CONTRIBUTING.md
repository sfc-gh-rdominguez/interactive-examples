# Contributing

## What belongs here

- One self-contained, runnable example per directory, built around Interactive tables and
  Interactive warehouses.
- Synthetic data, and a single ingest path per example.

## Example layout

```
<use-case>/
├── README.md         # the walkthrough (see "Writing the README")
├── .env.example      # non-secret config, copied to .env (gitignored)
├── compose.yaml      # local infra + apps
├── justfile          # set dotenv-load; one recipe per step
├── data/
│   ├── migrations/NNN_<what>.sql   # all setup SQL, numbered, idempotent
│   ├── checks/NN_<what>.sql        # all verify SQL; NN = step number
│   └── teardown/teardown.sql
├── scripts/          # up.sh, producers, probes
├── api/ web/         # only if there's a consumer app
└── keys/             # gitignored
```

## justfile conventions

- Recipes take `connection`, the name you'd pass to `snow sql -c`.
- Required recipes:
  - `doctor <connection>`: checks local tools, account access, and every preview feature
    the example needs. Exits non-zero on anything that would break a later step.
  - `up <connection>`: the one-shot run (see below).
  - `check <connection> <name>`: runs `data/checks/<name>.sql`.
  - `stop <connection>`: pauses billing.
  - `teardown <connection>`: removes everything, behind a `[confirm]` prompt.
- Experimental or unverified steps: prefix the recipe line with `-` and put each one in its
  own migration.
- Script recipes pass `*args` through: `produce *args: docker compose run --rm tools produce.py {{args}}`.

## Host dependencies

Keep the host to `snow`, `just`, `docker`, `openssl`, `jq` and `curl`. Everything else
runs in Docker:
- **Scripts** (producers, probes) run in a `tools` service under the `tools` profile.
  Build it with `just tools` and run it with `docker compose run --rm tools`.
- **Apps** build and run in their own containers.
- **Dev loops**, such as hot reload, run under the `dev` profile.
- **Mount directories, not single files** (for example `./keys:/keys:ro`). If a mounted
  file doesn't exist yet, Docker creates a directory in its place.
- **Make container-specific addresses configurable** with an environment variable and a
  host default, for example `KAFKA_BOOTSTRAP`, which is `kafka:29092` in the container
  and `localhost:9092` on the host.
- **Include every profile** in `stop` and `teardown`:
  `docker compose --profile tools --profile dev ...`.

## One-shot run: `just up <connection>`

Every example ships `just up`, backed by `scripts/up.sh`, which builds the whole example end
to end.

- **It calls the same `just` recipes the README walks through**, so the one-shot path
  and the manual path can't drift apart.
- **It's safe to re-run.** Each step is idempotent or skipped when its output already
  exists. Never regenerate key pairs that are already registered to a user.
- **It checks `.env` first** and stops if it's missing or still has placeholder values.
- **It runs each step's Verify check**, and polls when a step takes time to settle (a
  connector reaching `RUNNING`, rows landing, an app passing its health check).
- **It fails fast** and names the step that failed, so you know which README section
  to read.
- **Experiments may fail.** Report them as a finding and carry on.
- **It ends by printing** where to look (URLs), what to try next, and the `stop` and
  `teardown` commands.
- **`teardown` is never part of `up`.**

## SQL conventions

- Use `IF NOT EXISTS` and `ALTER ... SET` so migrations can be re-run. If a statement
  can't be re-run, say so in the README.
- Grant to `CURRENT_USER()`, never to a hard-coded user:
  ```sql
  SET s = 'GRANT ROLE <lab_role> TO USER "' || CURRENT_USER() || '"';
  EXECUTE IMMEDIATE $s;
  ```
- Secrets go in as `__PLACEHOLDER__`. The recipe fills them into a copy in `/tmp`, runs
  it, and deletes it.
- Prefix every object (for example `IA_LAB_*`) so teardown is safe.
- One lab role owns the objects. Each workload gets its own `TYPE = SERVICE` user.
  Consumer roles are read-only.

## Designing for Interactive warehouses

- **Statement timeout is 5 seconds.** Serving queries must be selective: a key filter, a
  time range and a `LIMIT`. Set `FALLBACK_WAREHOUSE` to a standard warehouse.
- **`CLUSTER BY` is required.** Lead with the most selective filter, then a time bucket.
- **Billing has a 1-hour minimum per resume**, and the minimum auto-suspend is 24 hours.
  Every example ships `just stop`.
- **Interactive tables allow no DML except `INSERT OVERWRITE`**, and they can't be a
  source for streams or dynamic tables.
- **Preview features:** `doctor` probes each one (create a throwaway object, then drop it)
  and says which steps still work without it.

## Consumer apps (if any)

- **Use a BFF + SPA.** The browser never holds credentials.
- **Build SQL only in the BFF:**
  - check identifiers against an allowlist;
  - validate user input against a pattern;
  - use `?` bindings for everything else.
- **Connect optional dependencies on first use**, not at startup.
- **A tenant picker is a filter, not isolation.** The UI should say so.

## Writing the example README

- **Start with a summary**, then a mermaid `flowchart LR`:
  Sources → Snowflake (Ingest / Store / Serve) → Consumers.
- **Add a "Grounded in" note:** the docs the example relies on, and the date you read
  them.
- **Put a quickstart near the top:** `cp .env.example .env`, then `just up <connection>`.
- **Step 0 is always `just doctor <connection>`.** Every step after it has Why / Do /
  Verify.
- **End with:** a recipe cheat sheet, stop and teardown, and what to try next.

## Before opening a PR

- [ ] `just up` passes on a clean account, and passes again when re-run
- [ ] `just teardown`, then the teardown check returns no rows
- [ ] Every code block in the README matches the files
      (`just --list`, `tsc --noEmit`, the mermaid diagram renders)
- [ ] `git status` shows no `.env`, `keys/` or `plugins/` staged
- [ ] A row is added to the Examples table in the root README

## Commits

- Use `feat(<use-case>): …` or `chore(...)`.
- No attribution trailers.
