# nisaba-cloud

A command-line tool for the nisaba cloud service — the local `db` CLI's
grammar (nisaba's `bin/db.md`) pointed at the web API instead of local
files. Same commands, same Extended-JSON conventions, same output
shapes; only where the database lives differs.

```
nisaba-cloud <db> <command> [args] [options]
```

`<db>` selects one of your tenant's logical databases (springing into
existence on first write, like `client.db(name)`). If `<command>` is
omitted it defaults to `collections`.

## Connection

The gateway and credentials come from the environment, never argv (a
key in argv leaks into shell history and `ps`):

| Variable | Meaning |
| --- | --- |
| `NISABA_API_KEY` | **required** — a tenant API key (`sk_…`), minted in the console |
| `NISABA_URL` | gateway base URL; default `https://api.nisaba.cloud` |

Requires Node 18+ (global `fetch`); `watch` requires Node 22+ (global
`WebSocket`).

```sh
export NISABA_API_KEY=sk_...
nisaba-cloud mydb insert users '{"name":"Ada"}'

# against a local dev stack
NISABA_URL=http://127.0.0.1:8087 nisaba-cloud mydb find users
```

## Commands

| Command | Description |
| --- | --- |
| `databases` | List your tenant's logical databases. Bare form only (`nisaba-cloud databases`); with any explicit `<command>` after it, `databases` is treated as a database name |
| `collections` | List collection names (default) |
| `drop-collection <coll>` | Drop a collection and its indexes |
| `dump [coll]` | Write the database (or one collection) to stdout as Extended-JSON JSONL: one `{"collection", "indexes"}` header line per collection, one `{"collection", "doc"}` line per document |
| `restore` | Read a dump from stdin into this database. Documents keep their `_id`s and indexes are recreated first, so restore into a **fresh** database name (existing `_id`s fail loudly) |
| `insert <coll> <doc>` | Insert one document |
| `insert-many <coll> <docs>` | Insert an array of documents |
| `find <coll> [filter]` | Find matching documents (`{}` if omitted) |
| `find-one <coll> [filter]` | Find the first matching document |
| `count <coll> [filter]` | Count matching documents |
| `estimated-count <coll>` | Fast collection size (no filter) |
| `distinct <coll> <field> [filter]` | Unique values of `field` across matching documents |
| `delete-one <coll> [filter]` | Delete the first matching document |
| `delete-many <coll> [filter]` | Delete every matching document |
| `replace-one <coll> <filter> <doc>` | Replace the first matching document |
| `update-one <coll> <filter> <update>` | Apply update operators to the first matching document |
| `update-many <coll> <filter> <update>` | Apply update operators to every matching document |
| `find-one-and-update <coll> <filter> <update>` | Atomically update and return a document |
| `find-one-and-replace <coll> <filter> <doc>` | Atomically replace and return a document |
| `find-one-and-delete <coll> [filter]` | Atomically delete and return a document |
| `bulk-write <coll> <operations>` | Mixed insert/update/delete operations in one call |
| `watch <coll>` | Stream change events (insert/update/replace/delete) over WebSocket until Ctrl+C |
| `create-index <coll> <keys>` | Create an index, e.g. `'{"team":1}'` |
| `drop-index <coll> <indexName>` | Drop an index |
| `list-indexes <coll>` | List a collection's indexes |

Options (`--sort`, `--skip`, `--limit`, `--project`, `--upsert`,
`--return-document`, `--unordered`, and the `create-index` flags
`--name`/`--unique`/`--sparse`/`--partial-filter`/`--ttl`) match the
local `db` CLI exactly — see `nisaba-cloud -h`.

## Differences from the local `db` CLI

Scoped to what the web API offers:

- **Not here**: `compact`, `find-by-index`, `prune-expired`, and
  `--order` — local storage administration with no cloud endpoint (the
  service runs compaction and TTL pruning itself as maintenance).
- **Only here**: `databases` (tenants have a listable set of logical
  databases; the local tool's data root is just a directory) and
  `estimated-count`.

## Dump and restore

The dump format is identical to the local `db` CLI's, so the two tools
compose — seed a cloud database from a local one, or pull a cloud
database down to work on it offline:

```sh
db mydb dump | NISABA_API_KEY=sk_... nisaba-cloud mydb-imported restore
nisaba-cloud mydb dump | NISABA_DIR=~/.nisaba db mydb-local restore
```
