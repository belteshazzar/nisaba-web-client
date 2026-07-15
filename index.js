/**
 * index.js — public entry point for the nisaba-web client.
 *
 * `ObjectId`/`Pointer` are re-exported from `binjson` directly (this
 * package's own lightweight, zero-build submodule) rather than pulling in
 * the whole `nisaba` document-database engine (compiled WASM, Emscripten
 * toolchain) just for two value-type classes -- `ObjectId`/`Pointer`
 * belong to the codec layer, not the database layer.
 *
 * This does mean a value built here is a *different* module instance than
 * nisaba's own internal `ObjectId` (nisaba keeps its own self-contained
 * copy of binjson, by design -- see nisaba's own wasm/nisaba-wasm.js
 * header). That's fine: nisaba-web's server decodes wire `_id` values
 * through this package's `extended-json.js`, and nisaba's `toObjectId()`
 * duck-types (accepts anything shaped like an ObjectId, not just strict
 * `instanceof`) specifically to tolerate that -- see nisaba's own
 * wasm/nisaba-wasm.js for the matching half of this.
 */
export { NisabaClient, Db, Collection, FindCursor, ClientChangeStream, NisabaServerError } from './nisaba-client.js';
export { ObjectId, Pointer } from './third_party/binjson/js/binjson.js';
