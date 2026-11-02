# Snowflake Interactive Examples

Runnable, end-to-end examples for Snowflake **Interactive tables** and **Interactive
warehouses**: low-latency, high-concurrency serving on fresh data.

Each example is self-contained, with its own setup, checks and teardown, and builds a
working system you can run with one command.

## Examples

| Example | What it shows | Stack |
|---|---|---|
| [streaming-kafka](./streaming-kafka) | Kafka → Snowflake Kafka connector v4 → CDC interactive table → interactive warehouse → live dashboard. Dedup on read, end-to-end latency in seconds. | Docker Compose, Kafka Connect, Python, Bun, React |

## Interactive tables and warehouses, briefly

- **Interactive tables** are built for selective, high-QPS queries, such as dashboards,
  APIs and point lookups. `CLUSTER BY` is required. A CDC variant deduplicates
  streamed rows by primary key.
- **Interactive warehouses** serve them. Attach tables to a warehouse so new data is
  warmed into its cache.
- **Know the trade-offs** before you build on them:
  - statements have a **5-second timeout**;
  - DML is limited;
  - billing has a **1-hour minimum per resume**, and auto-suspend can't be set below
    **24 hours**.

See the [Snowflake docs on interactive tables](https://docs.snowflake.com/en/user-guide/interactive).
Some features the examples use are in preview. Each example's README says which.

## Prerequisites

Common to every example:
- a Snowflake account, and a role that can create roles, users, databases and
  warehouses;
- the [`snow` CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/index)
  with a named connection;
- [`just`](https://github.com/casey/just), `docker` with `docker compose`, `openssl`,
  `jq` and `curl`.

Language runtimes, such as Python and Bun, run in Docker, so you don't install them.
Anything extra, such as a preview feature, is listed in that example's README.
`just doctor <connection>` checks all of it.

## Quickstart

```sh
cd streaming-kafka
cp .env.example .env        # fill it in
just up <connection>        # builds and verifies everything
```

Every example also has a step-by-step walkthrough in its README, and `just` with no
arguments lists its recipes.

## Cost and cleanup

Interactive warehouses bill while they're running. When you're done with an example:

```sh
just stop <connection>       # pause
just teardown <connection>   # remove everything it created
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the layout, conventions and PR checklist.
If you use Cortex Code, it loads the
[`new-interactive-example`](./.cortex/skills/new-interactive-example/SKILL.md) skill from
`.cortex/skills/` automatically. With any other agent, point it at that file.

## Disclaimer

These are learning examples, not production-supported code.
