# nisaba-web-client

A MongoDB-driver-shaped client for [nisaba-web](https://github.com/belteshazzar/nisaba-web),
the cloud SaaS layer of the [nisaba](https://github.com/mdy-docs/nisaba)
document database. Split out from `nisaba-web`'s own `client/` directory
so an application can depend on just the client, without the server's
own code.

- `NisabaClient`/`Db`/`Collection`/`FindCursor` — the driver-shaped API,
  matching the method surface of nisaba's own embedded `Collection`/`Db`.
- `ClientChangeStream` — `watch()` change-stream subscriptions over a
  single multiplexed WebSocket connection.
- `ObjectId`/`Pointer` — re-exported from
  [`binjson`](https://github.com/mdy-docs/binjson) (this package's own
  submodule dependency), not the whole `nisaba` document-database engine —
  `ObjectId`/`Pointer` are codec-layer value types, not database-layer
  ones, and binjson's plain-JS module needs no compiled WASM/Emscripten
  build step to use them. A value constructed here is technically a
  different module instance than nisaba's own internal `ObjectId` copy
  (nisaba keeps its own self-contained copy of binjson by design), but
  nisaba's own `toObjectId()`/`writeValue()` duck-type rather than doing a
  strict `instanceof` check, specifically to tolerate that.
- Extended JSON (`encode`/`decode`) — the wire format for
  `ObjectId`/`Date`/binary/`Pointer` values crossing the REST/WebSocket
  boundary.

See `nisaba-web`'s [`docs/cloud-rest-api.md`](https://github.com/belteshazzar/nisaba-web/blob/main/docs/cloud-rest-api.md)
and [`docs/cloud-websocket-api.md`](https://github.com/belteshazzar/nisaba-web/blob/main/docs/cloud-websocket-api.md)
for the wire protocol this client implements.

## Installation

```bash
git clone --recurse-submodules <this-repo-url>
cd nisaba-web-client
npm install
```

(If you already cloned without `--recurse-submodules`:
`git submodule update --init --recursive`.)

That's it — no compiled WASM artifact, no Emscripten SDK. `binjson`'s
plain-JS module (`third_party/binjson/js/binjson.js`) is synchronous,
dependency-free, and needs no build step.

### Run the tests

```bash
npm test
```

(Unit tests only — `encode`/`decode` round-tripping. End-to-end tests
against a real gateway live in `nisaba-web`'s own `test/client-e2e.test.js`,
which depends on this package as its `third_party/nisaba-web-client`
submodule.)

## Usage

```javascript
import { NisabaClient } from '@belteshazzar/nisaba-web-client';

const client = new NisabaClient('https://api.yourapp.com', { apiKey: 'sk_live_...' });
await client.connect();

const users = client.db('app').collection('users');
const { insertedId } = await users.insertOne({ name: 'Ada' });
const user = await users.findOne({ _id: insertedId });

// Every database this tenant has provisioned/used:
const databases = await client.listDatabases();

// Live change-stream subscription:
const stream = users.watch();
stream.on('change', (event) => console.log(event));
```

## Command line

The package ships `nisaba-cloud` ([`bin/nisaba-cloud.md`](bin/nisaba-cloud.md)) —
the local `db` CLI's grammar (nisaba's `bin/db.md`) pointed at the cloud
service, scoped to what the web API offers:

```bash
export NISABA_API_KEY=sk_...
nisaba-cloud mydb insert users '{"name":"Ada"}'
nisaba-cloud mydb find users '{"name":"Ada"}'
nisaba-cloud mydb watch users

# the gateway defaults to https://api.nisaba.cloud; point NISABA_URL
# elsewhere to test against a local stack
export NISABA_URL=http://127.0.0.1:8087
```

## License

BSD 2-Clause License
