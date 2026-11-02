---
name: new-interactive-example
description: "Plan and scaffold a new runnable example in this repo for Snowflake Interactive tables / Interactive warehouses, following CONTRIBUTING.md. Use when asked to create, add, start, or plan a new example, demo, or use case in interactive-examples. Also use when extending an existing example with a consumer app or a `just up` script."
---

# New Interactive Example

Build a new self-contained example directory that satisfies `CONTRIBUTING.md`, using
`streaming-kafka/` as the reference implementation.

## Sources of truth

- **`CONTRIBUTING.md` (repo root):** the required layout, recipes, SQL conventions,
  Interactive warehouse limits, consumer-app rules, README structure, and PR checklist.
  **Read it in full before planning.** When this skill and CONTRIBUTING disagree,
  CONTRIBUTING wins.
- **`streaming-kafka/`:** the working reference. Copy its patterns before inventing new
  ones.
- **Current Snowflake docs:** check every Interactive feature you use with
  `cortex search docs`, including preview limitations. Record the pages and the date in
  the README's "Grounded in" note.

## Workflow

### 1. Scope
Ask the user for:
- the use-case name, which becomes the directory name in kebab-case;
- the source of the data (Kafka, files, API, an SDK, ...);
- who reads it: which consumers, and how fresh each one needs the data;
- whether the example needs a consumer app (`api/` + `web/`);
- which preview features it depends on.

**Stop.** Confirm the scope before designing anything.

### 2. Plan
Draft the plan and present it. It should contain:
- **A mermaid `flowchart LR`:** Sources → Snowflake (Ingest / Store / Serve) → Consumers.
  One direction only.
- **An object-name table**, with every object under one prefix (for example
  `IA_<SHORT>_*`) so teardown is safe.
- **The ordered step list.** Step 0 is `doctor`. Put the riskiest preview feature as early
  as possible. For each step, list its recipe, its migration or check file, and what Verify
  expects.
- **Experiments:** which steps are unverified. Each gets a `-` recipe and its own
  migration.
- **How each serving query stays within the 5-second timeout:** its key filter, time
  range and `LIMIT`, plus the `FALLBACK_WAREHOUSE`.

**Stop.** Get the user's approval of the plan before writing files.

### 3. Scaffold
Create the CONTRIBUTING layout. Start from the `streaming-kafka/` files and adapt them:

| Need | Copy from |
|---|---|
| justfile skeleton (`doctor`, `check`, `keys`, placeholder injection, `stop`, `teardown`, `clean-local`) | `streaming-kafka/justfile` |
| Preview-feature probe in `doctor` (create a throwaway object, then drop it either way) | `streaming-kafka/data/checks/00_cdc_probe.sql` and the `doctor` recipe |
| Role / database / warehouse, and a service user with a key placeholder | `streaming-kafka/data/migrations/001_init.sql`, `002_service_user.sql` |
| Read-only consumer role and user | `streaming-kafka/data/migrations/007_dashboard.sql` |
| One-shot runner (`run`, `wait_for`, skip-if-exists, failure trap, closing summary) | `streaming-kafka/scripts/up.sh` |
| Scripts in Docker (`tools` service, `tools` profile, mounted `keys/`, `KAFKA_BOOTSTRAP`) | `streaming-kafka/scripts/Dockerfile`, `compose.yaml`, the `tools`/`produce`/`probe` recipes |
| Teardown and its check | `streaming-kafka/data/teardown/teardown.sql`, `data/checks/16_teardown.sql` |

**`scripts/up.sh` must call the same recipes the README documents, in the same order.**
Write it alongside the steps, not afterwards.

### 4. Consumer app (if any)
Follow CONTRIBUTING's "Consumer apps" rules for security: a BFF that holds the
credentials, allowlisted identifiers, and bound parameters.

For the UX, **reuse `streaming-kafka/web/` rather than starting from a blank page.**
Copy the files and change the content:
- **Stack:** Vite + React 19 + TypeScript, `lucide-react` icons, `recharts`, `motion`.
  Served by nginx (`web/Dockerfile`, `default.conf.template`) on :8000, with `/api/*`
  proxied to the BFF on :8001.
- **Theme:** `src/index.css`. It uses Catppuccin Mocha variables (`--ctp-*`), a dark
  colour scheme, and tabular numbers for anything that changes. Keep the palette. Use
  `ok`, `warn` and `bad` tones for status values.
- **Motion:** copy `src/motion.ts` as is, with its shared easing, springs, staggered
  `stage`/`pop`/`rise` entrances, and `MotionConfig reducedMotion="user"` in
  `main.tsx`.
- **Layout** (see `src/App.tsx`):
  - The header states the claim, not the technology.
  - A **hero row of 2–4 `Stat`s** holds the numbers that prove the point (freshness, a
    live end-to-end test, duplicates collapsed).
  - Below that, `Card`s each map to **one consumer or one query mode** from the diagram,
    and show that query's time in the card header.
- **Reusable pieces in `App.tsx`:**
  - `Stat`, `Card`, `Swap` (animated value changes) and `Toast`;
  - `StaleNotice` for when data falls behind its target;
  - `Hops`, the progress line for a live "send a test event and watch it arrive" action,
    which every example should have when it can.
- **Guided tour:** `src/Tour.tsx`. It dims the page and moves a spotlight between
  `data-tour` targets. Write a new `STEPS` list that tells the example's story in
  reading order, and keep clicks passing through so the live action can be tried during
  the tour.
- **Dev loop:** `just app-up` for the containers. `just web-dev` runs Vite with hot reload in
  the `web-dev` compose service (`dev` profile), with `web/` bind-mounted and the proxy
  pointed at the BFF through `API_URL`, so Bun is never needed on the host.
- **If there's no identity provider,** label the tenant picker as a filter, not
  isolation.

Before wiring the app to Snowflake, check it builds with `docker compose build web`, which
runs `bun run build`, including `tsc --noEmit`, inside the image.

### 5. README
Write `<use-case>/README.md` following CONTRIBUTING's "Writing the example README":
- a summary and the mermaid diagram;
- the "Grounded in" note;
- a quickstart: `cp .env.example .env`, then `just up <connection>`;
- the steps, each with Why / Do / Verify;
- a recipe cheat sheet, stop and teardown, and what to try next.

Then add a row to the Examples table in the root `README.md`.

### 6. Verify
Run through CONTRIBUTING's "Before opening a PR" checklist. Run whatever you can locally:
- `just --list`;
- `bash -n scripts/up.sh`;
- the web build;
- render the mermaid diagram: `npx -y @mermaid-js/mermaid-cli -i d.mmd -o d.png`, then look
  at the image.

Steps that need a live account are for the user to run, starting with `just up`. **Say
plainly what you verified and what you didn't.**

## Stopping points
- After step 1: the scope is confirmed.
- After step 2: the plan is approved.
- After step 6: report what was verified and what's left for the user to run.

## Output
- A new `<use-case>/` directory that matches the CONTRIBUTING layout.
- A working `just up`.
- `README.md` for the example.
- An updated Examples table in the root README.
