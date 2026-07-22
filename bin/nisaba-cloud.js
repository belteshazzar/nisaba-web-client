#!/usr/bin/env node
/**
 * nisaba-cloud — the `db` CLI's grammar (nisaba's bin/db.js) pointed at
 * the cloud service instead of local files. Same commands, same
 * Extended-JSON argument conventions, same output shapes, so shell
 * muscle memory transfers between the two; what differs is only where
 * the database lives. Scoped to what the web API actually offers: the
 * local tool's storage-admin commands (`compact`, `find-by-index`,
 * `prune-expired`) have no cloud endpoint and so no command here, while
 * `databases` and `estimated-count` exist only here because they are
 * SaaS-side conveniences with no embedded equivalent.
 *
 * Connection comes from the environment, never argv (a key in argv
 * leaks into shell history and `ps`):
 *
 *   NISABA_API_KEY   required — the tenant API key (sk_...)
 *   NISABA_URL       gateway base URL, default https://api.nisaba.cloud
 *
 * Requires Node 18+ (global fetch); `watch` requires Node 22+ (global
 * WebSocket).
 */
import { NisabaClient } from '../nisaba-client.js';
import { encode, decode } from '../extended-json.js';

const BASE_URL = process.env.NISABA_URL || 'https://api.nisaba.cloud';
const API_KEY = process.env.NISABA_API_KEY;

function usage() {
  console.error(`Usage: nisaba-cloud <db> <command> [args] [options]

The nisaba cloud service from the shell. <db> selects one of your
tenant's logical databases (created on first write). Connection comes
from the environment: NISABA_API_KEY (required) and NISABA_URL
(default https://api.nisaba.cloud).

Tenant commands:
  databases                              List your logical databases (bare
                                         form only: no <command> after it)

Database commands:
  collections                            List collection names (default)
  drop-collection <coll>                 Drop a collection and its indexes
  dump [coll]                            Write the database (or one collection)
                                         to stdout as Extended-JSON JSONL,
                                         indexes included
  restore                                Read a dump from stdin into this
                                         database (fresh names only: documents
                                         keep their _ids)

Document commands:
  insert <coll> <doc>                    Insert one document
  insert-many <coll> <docs>              Insert an array of documents
  find <coll> [filter]                   Find matching documents ({} if omitted)
  find-one <coll> [filter]               Find the first matching document
  count <coll> [filter]                  Count matching documents
  estimated-count <coll>                 Fast collection size (no filter)
  distinct <coll> <field> [filter]       Unique values of a field across matches
  delete-one <coll> [filter]             Delete the first matching document
  delete-many <coll> [filter]            Delete every matching document
  replace-one <coll> <filter> <doc>      Replace the first matching document
  update-one <coll> <filter> <update>    Apply update operators to the first match
  update-many <coll> <filter> <update>   Apply update operators to every match
  find-one-and-update <coll> <filter> <update>
                                          Atomically update and return a document
  find-one-and-replace <coll> <filter> <doc>
                                          Atomically replace and return a document
  find-one-and-delete <coll> [filter]    Atomically delete and return a document
  bulk-write <coll> <operations>         Mixed insert/update/delete in one call
  watch <coll>                           Stream change events until Ctrl+C

Index commands:
  create-index <coll> <keys>             e.g. create-index users '{"team":1}'
  drop-index <coll> <indexName>          Drop an index
  list-indexes <coll>                    List a collection's indexes

<doc>/<filter>/<keys>/<docs>/<operations> are JSON. ObjectId and Date
literals use MongoDB Extended JSON: {"$oid":"<24 hex chars>"} and
{"$date":"<ISO 8601>"}. A few examples:

  '{"age":{"$gt":30}}'                                query operator
  '{"$set":{"team":"core"},"$inc":{"visits":1}}'      update operators
  '[{"insertOne":{"document":{"name":"Ada"}}}]'       bulk-write operation

update-one/update-many/find-one-and-update reject a plain replacement
document -- use replace-one/find-one-and-replace for that.

Options:
  --sort <json>       find: sort spec, e.g. '{"age":1}' or '{"age":-1}'
  --skip <n>          find: number of matches to skip
  --limit <n>         find: max matches to return
  --project <json>    find: projection spec, e.g. '{"name":1}' or '{"age":0}'
  --upsert            replace-one/update-one/update-many/find-one-and-update/
                      find-one-and-replace: insert if nothing matched
  --return-document <before|after>
                      find-one-and-update/find-one-and-replace: which image
                      to return (default before)
  --unordered         insert-many/bulk-write: don't stop at the first failure
  --name <name>       create-index: index name (default: "field_1[_field2_1...]")
  --unique            create-index: reject a duplicate value
  --sparse            create-index: don't index documents missing the field
  --partial-filter <json>
                      create-index: only index documents matching this filter
  --ttl <seconds>     create-index: expireAfterSeconds (single-field index only)
  -h, --help          Show this help`);
  process.exit(1);
}

function formatValue(value) {
  const indentUnit = '  ';
  const render = (val, depth) => {
    const pad = indentUnit.repeat(depth);
    const nextPad = indentUnit.repeat(depth + 1);

    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'string') return JSON.stringify(val);

    // duck-typed, not instanceof -- an _id decoded by the client is a
    // binjson ObjectId, which may be a different module instance
    if (typeof val.toHexString === 'function') return `ObjectId(${val.toHexString()})`;
    if (val instanceof Date) return `Date(${val.toISOString()})`;
    if (val instanceof Uint8Array) return `Binary(${Buffer.from(val).toString('base64')})`;

    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const inner = val.map(item => `${nextPad}${render(item, depth + 1)}`).join('\n');
      return `[\n${inner}\n${pad}]`;
    }

    if (typeof val === 'object') {
      const entries = Object.entries(val);
      if (entries.length === 0) return '{}';
      const inner = entries
        .map(([k, v]) => `${nextPad}${k}: ${render(v, depth + 1)}`)
        .join('\n');
      return `{\n${inner}\n${pad}}`;
    }

    return JSON.stringify(val);
  };

  return render(value, 0);
}

function printDocs(docs, noun = 'document') {
  if (docs.length === 0) {
    console.log(`No ${noun}s found.`);
    return;
  }
  for (let i = 0; i < docs.length; i++) {
    console.log(`${i}: ${formatValue(docs[i])}`);
  }
}

/** JSON.parse + the client's own Extended-JSON decode ({$oid}/{$date}/{$binary} -> real values). */
function parseJson(label, str) {
  try {
    return decode(JSON.parse(str));
  } catch (err) {
    console.error(`Error: ${label} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
    } else if (arg === '--upsert') {
      opts.upsert = true;
    } else if (arg === '--unordered') {
      opts.ordered = false;
    } else if (arg === '--sort') {
      opts.sort = parseJson('--sort', argv[++i]);
    } else if (arg === '--project') {
      opts.project = parseJson('--project', argv[++i]);
    } else if (arg === '--skip') {
      opts.skip = Number(argv[++i]);
    } else if (arg === '--limit') {
      opts.limit = Number(argv[++i]);
    } else if (arg === '--return-document') {
      const v = argv[++i];
      if (v !== 'before' && v !== 'after') {
        console.error('Error: --return-document must be "before" or "after"');
        process.exit(1);
      }
      opts.returnDocument = v;
    } else if (arg === '--name') {
      opts.name = argv[++i];
    } else if (arg === '--unique') {
      opts.unique = true;
    } else if (arg === '--sparse') {
      opts.sparse = true;
    } else if (arg === '--partial-filter') {
      opts.partialFilter = parseJson('--partial-filter', argv[++i]);
    } else if (arg === '--ttl') {
      opts.ttl = Number(argv[++i]);
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}

function requireArgs(args, n, message) {
  if (args.length < n) {
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));

  if (!positional[0]) usage();
  if (!API_KEY) {
    console.error('Error: NISABA_API_KEY is not set. Mint a key in the console and export it.');
    process.exit(1);
  }

  const client = new NisabaClient(BASE_URL, { apiKey: API_KEY });

  // the one command that precedes choosing a database. Bare form only:
  // `nisaba-cloud databases collections` still treats "databases" as a
  // database name, so a tenant that actually named one "databases" can
  // reach it with any explicit <command>.
  if (positional[0] === 'databases' && positional.length === 1) {
    const names = await client.listDatabases();
    if (names.length === 0) {
      console.log('No databases.');
    } else {
      names.forEach((name, i) => console.log(`${i}: ${name}`));
    }
    await client.close();
    return;
  }

  const command = (positional[1] || 'collections').toLowerCase();
  const args = positional.slice(2);
  const db = client.db(positional[0]);

  try {
    switch (command) {
      case 'collections':
      case 'list': {
        const names = await db.listCollections();
        if (names.length === 0) {
          console.log('No collections.');
          break;
        }
        names.forEach((name, i) => console.log(`${i}: ${name}`));
        break;
      }

      case 'drop-collection': {
        requireArgs(args, 1, 'drop-collection requires <coll>');
        await db.dropCollection(args[0]);
        console.log(`Dropped collection ${args[0]}.`);
        break;
      }

      case 'insert': {
        requireArgs(args, 2, 'insert requires <coll> and <doc>');
        const doc = parseJson('<doc>', args[1]);
        const { insertedId } = await db.collection(args[0]).insertOne(doc);
        console.log(`Inserted ${formatValue(insertedId)}.`);
        break;
      }

      case 'insert-many': {
        requireArgs(args, 2, 'insert-many requires <coll> and <docs>');
        const docs = parseJson('<docs>', args[1]);
        if (!Array.isArray(docs)) {
          console.error('Error: <docs> must be a JSON array');
          process.exit(1);
        }
        const result = await db.collection(args[0]).insertMany(docs, { ordered: opts.ordered !== false });
        console.log(`Inserted ${result.insertedCount} document(s).`);
        break;
      }

      case 'find': {
        requireArgs(args, 1, 'find requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        const cursor = db.collection(args[0]).find(filter, {
          sort: opts.sort,
          skip: opts.skip,
          limit: opts.limit,
          projection: opts.project
        });
        printDocs(await cursor.toArray());
        break;
      }

      case 'find-one': {
        requireArgs(args, 1, 'find-one requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        const doc = await db.collection(args[0]).findOne(filter);
        if (doc === null) {
          console.log('No document found.');
          process.exitCode = 1;
        } else {
          console.log(formatValue(doc));
        }
        break;
      }

      case 'count': {
        requireArgs(args, 1, 'count requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        console.log(String(await db.collection(args[0]).countDocuments(filter)));
        break;
      }

      case 'estimated-count': {
        requireArgs(args, 1, 'estimated-count requires <coll>');
        console.log(String(await db.collection(args[0]).estimatedDocumentCount()));
        break;
      }

      case 'distinct': {
        requireArgs(args, 2, 'distinct requires <coll> and <field>');
        const filter = args[2] ? parseJson('<filter>', args[2]) : {};
        const values = await db.collection(args[0]).distinct(args[1], filter);
        if (values.length === 0) {
          console.log('No values found.');
          break;
        }
        values.forEach((v, i) => console.log(`${i}: ${formatValue(v)}`));
        break;
      }

      case 'delete-one': {
        requireArgs(args, 1, 'delete-one requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        const { deletedCount } = await db.collection(args[0]).deleteOne(filter);
        if (deletedCount) {
          console.log('Deleted 1 document.');
        } else {
          console.log('No document matched; nothing deleted.');
          process.exitCode = 1;
        }
        break;
      }

      case 'delete-many': {
        requireArgs(args, 1, 'delete-many requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        const { deletedCount } = await db.collection(args[0]).deleteMany(filter);
        console.log(`Deleted ${deletedCount} document(s).`);
        if (deletedCount === 0) process.exitCode = 1;
        break;
      }

      case 'replace-one': {
        requireArgs(args, 3, 'replace-one requires <coll>, <filter>, and <doc>');
        const filter = parseJson('<filter>', args[1]);
        const replacement = parseJson('<doc>', args[2]);
        const result = await db.collection(args[0]).replaceOne(filter, replacement, { upsert: !!opts.upsert });
        if (result.upsertedId) {
          console.log(`Upserted ${formatValue(result.upsertedId)}.`);
        } else if (result.modifiedCount) {
          console.log('Replaced 1 document.');
        } else {
          console.log('No document matched; nothing replaced.');
          process.exitCode = 1;
        }
        break;
      }

      case 'update-one': {
        requireArgs(args, 3, 'update-one requires <coll>, <filter>, and <update>');
        const filter = parseJson('<filter>', args[1]);
        const update = parseJson('<update>', args[2]);
        const result = await db.collection(args[0]).updateOne(filter, update, { upsert: !!opts.upsert });
        if (result.upsertedId) {
          console.log(`Upserted ${formatValue(result.upsertedId)}.`);
        } else if (result.modifiedCount) {
          console.log('Updated 1 document.');
        } else {
          console.log('No document matched; nothing updated.');
          process.exitCode = 1;
        }
        break;
      }

      case 'update-many': {
        requireArgs(args, 3, 'update-many requires <coll>, <filter>, and <update>');
        const filter = parseJson('<filter>', args[1]);
        const update = parseJson('<update>', args[2]);
        const result = await db.collection(args[0]).updateMany(filter, update, { upsert: !!opts.upsert });
        if (result.upsertedId) {
          console.log(`Upserted ${formatValue(result.upsertedId)}.`);
        } else {
          console.log(`Updated ${result.modifiedCount} document(s).`);
          if (result.modifiedCount === 0) process.exitCode = 1;
        }
        break;
      }

      case 'find-one-and-update': {
        requireArgs(args, 3, 'find-one-and-update requires <coll>, <filter>, and <update>');
        const filter = parseJson('<filter>', args[1]);
        const update = parseJson('<update>', args[2]);
        const doc = await db.collection(args[0]).findOneAndUpdate(filter, update, {
          upsert: !!opts.upsert,
          returnDocument: opts.returnDocument || 'before'
        });
        if (doc === null) {
          console.log('No document found.');
          process.exitCode = 1;
        } else {
          console.log(formatValue(doc));
        }
        break;
      }

      case 'find-one-and-replace': {
        requireArgs(args, 3, 'find-one-and-replace requires <coll>, <filter>, and <doc>');
        const filter = parseJson('<filter>', args[1]);
        const replacement = parseJson('<doc>', args[2]);
        const doc = await db.collection(args[0]).findOneAndReplace(filter, replacement, {
          upsert: !!opts.upsert,
          returnDocument: opts.returnDocument || 'before'
        });
        if (doc === null) {
          console.log('No document found.');
          process.exitCode = 1;
        } else {
          console.log(formatValue(doc));
        }
        break;
      }

      case 'find-one-and-delete': {
        requireArgs(args, 1, 'find-one-and-delete requires <coll>');
        const filter = args[1] ? parseJson('<filter>', args[1]) : {};
        const doc = await db.collection(args[0]).findOneAndDelete(filter);
        if (doc === null) {
          console.log('No document found.');
          process.exitCode = 1;
        } else {
          console.log(formatValue(doc));
        }
        break;
      }

      case 'bulk-write': {
        requireArgs(args, 2, 'bulk-write requires <coll> and <operations>');
        const operations = parseJson('<operations>', args[1]);
        const result = await db.collection(args[0]).bulkWrite(operations, { ordered: opts.ordered !== false });
        console.log(formatValue(result));
        break;
      }

      case 'watch': {
        requireArgs(args, 1, 'watch requires <coll>');
        const stream = db.collection(args[0]).watch();
        console.log(`Watching ${args[0]} for changes... (Ctrl+C to stop)`);
        // Same posture as the local db CLI: hold the event loop open
        // explicitly rather than trusting stdin or the WebSocket handle
        // to do it across runtimes.
        const keepAlive = setInterval(() => {}, 1 << 30);
        process.on('SIGINT', async () => {
          clearInterval(keepAlive);
          stream.close();
          await client.close();
          process.exit(0);
        });
        for await (const change of stream) {
          console.log(formatValue(change));
        }
        // Reached without SIGINT only when the stream closed itself --
        // i.e. the subscribe failed (bad plan, dropped collection). Stop
        // holding the loop open and report the abnormal end.
        clearInterval(keepAlive);
        process.exitCode = 1;
        break;
      }

      case 'create-index': {
        requireArgs(args, 2, 'create-index requires <coll> and <keys>');
        const keys = parseJson('<keys>', args[1]);
        const indexOpts = {};
        if (opts.name) indexOpts.name = opts.name;
        if (opts.unique) indexOpts.unique = true;
        if (opts.sparse) indexOpts.sparse = true;
        if (opts.partialFilter) indexOpts.partialFilterExpression = opts.partialFilter;
        if (opts.ttl !== undefined) indexOpts.expireAfterSeconds = opts.ttl;
        const name = await db.collection(args[0]).createIndex(keys, indexOpts);
        console.log(`Created index ${name}.`);
        break;
      }

      case 'drop-index': {
        requireArgs(args, 2, 'drop-index requires <coll> and <indexName>');
        await db.collection(args[0]).dropIndex(args[1]);
        console.log(`Dropped index ${args[1]}.`);
        break;
      }

      case 'list-indexes': {
        requireArgs(args, 1, 'list-indexes requires <coll>');
        const indexes = await db.collection(args[0]).listIndexes();
        if (indexes.length === 0) {
          console.log('No indexes.');
          break;
        }
        indexes.forEach((ix, i) => console.log(`${i}: ${formatValue(ix)}`));
        break;
      }

      // JSONL to stdout, same format as the local db CLI's dump: one
      // {"collection", "indexes"} header line per collection, then one
      // {"collection", "doc"} line per document, Extended JSON
      // throughout. The two tools' dumps are interchangeable -- pipe a
      // local dump into `nisaba-cloud restore` to seed a cloud database,
      // or the reverse to pull one down.
      case 'dump': {
        const names = args[0] ? [args[0]] : await db.listCollections();
        for (const name of names) {
          const coll = db.collection(name);
          const indexes = await coll.listIndexes();
          process.stdout.write(JSON.stringify({ collection: name, indexes: encode(indexes) }) + '\n');
          const cursor = coll.find({});
          for (;;) {
            const { value, done } = await cursor.next();
            if (done) break;
            process.stdout.write(JSON.stringify({ collection: name, doc: encode(value) }) + '\n');
          }
        }
        break;
      }

      case 'restore': {
        const lines = (await readStdin()).split('\n');
        let batch = [];
        let batchColl = null;
        let inserted = 0, collections = 0;
        const flush = async () => {
          if (!batch.length) return;
          await db.collection(batchColl).insertMany(batch, { ordered: true });
          inserted += batch.length;
          batch = [];
        };
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = parseJson('restore line', line);
          if (entry.indexes) {
            await flush();
            const coll = db.collection(entry.collection);
            collections++;
            for (const def of entry.indexes) {
              const { name, key, ...indexOpts } = def;
              await coll.createIndex(key, { name, ...indexOpts });
            }
            continue;
          }
          if (entry.collection !== batchColl) await flush();
          batchColl = entry.collection;
          batch.push(entry.doc);
          if (batch.length >= 500) await flush();
        }
        await flush();
        console.log(`Restored ${inserted} document(s) across ${collections} collection(s).`);
        break;
      }

      default:
        console.error(`Error: unknown command '${command}'`);
        usage();
    }

    await client.close();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    await client.close();
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
