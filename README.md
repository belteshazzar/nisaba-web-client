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
- `ObjectId`/`Pointer` — re-exported from nisaba's own WASM wrapper (not
  a separate copy), so values constructed here and values produced by the
  embedded API are interchangeable.
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

The engine's compiled WASM artifact (`third_party/nisaba/wasm/lib/`) isn't
checked into that submodule and isn't built by `npm install` — build it
once with the [Emscripten SDK](https://emscripten.org/) (`emcc`) on your
`PATH`:

```bash
npm run --prefix third_party/nisaba build:wasm
```

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

## License

BSD 2-Clause License
