/**
 * index.js — public entry point for the nisaba-web client.
 *
 * `ObjectId`/`Pointer` are re-exported from the exact same class nisaba's
 * own WASM wrapper uses server-side (not a separate third_party/binjson
 * copy), so a value constructed by this client and one produced by the
 * embedded API are interchangeable -- there's exactly one ObjectId
 * implementation in this project, not a client-side lookalike that
 * happens to have the same shape (see extended-json.js's header for why
 * a mismatched copy silently breaks server-side instanceof checks).
 */
export { NisabaClient, Db, Collection, FindCursor, ClientChangeStream, NisabaServerError } from './nisaba-client.js';
export { ObjectId, Pointer } from './third_party/nisaba/wasm/nisaba-wasm.js';
