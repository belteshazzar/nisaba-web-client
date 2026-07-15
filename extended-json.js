/**
 * extended-json.js — the wire format for documents crossing the
 * REST/WebSocket boundary (see nisaba-web's docs/cloud-rest-api.md's
 * "Wire format for documents"). Plain JSON can't round-trip
 * ObjectId/Date/binary, so this reuses MongoDB's own Extended JSON
 * (relaxed mode) convention instead of inventing one, plus one
 * binjson-specific extension (`$pointer`) for the `Pointer` type, which
 * has no Mongo equivalent.
 *
 * Lives in this package, not nisaba-web's service/, even though
 * nisaba-web's service/rest-gateway.js and service/websocket-gateway.js
 * both depend on it too (as this package's git submodule, see
 * nisaba-web's third_party/nisaba-web-client): this is a wire-format
 * concern shared by both ends of the connection, not a server-internal
 * detail -- the reverse (this package depending on nisaba-web's service/)
 * would be backwards.
 *
 * Operates on already-parsed/to-be-serialized JS values, not raw text, so
 * it composes with JSON.parse/JSON.stringify: `decode(JSON.parse(text))`
 * and `JSON.stringify(encode(value))`.
 */
// ObjectId/Pointer come from this package's own binjson submodule, not
// nisaba's. That cuts both ways across the wire:
//   - decode() constructs values the *server* then hands to nisaba's
//     Collection methods (insertOne, etc.) -- nisaba's own toObjectId()/
//     writeValue() duck-type (accept anything shaped like an ObjectId, not
//     just strict `instanceof`) specifically to tolerate that.
//   - encode() has to handle the *reverse* direction too: any value read
//     back from the engine (an auto-generated _id, or any ObjectId-typed
//     field in a stored document) is nisaba's own internal ObjectId
//     instance, not this file's. Strict `instanceof ObjectId` here would
//     silently fail to recognize it and mis-encode it as a plain object
//     instead of `{ $oid: ... }` -- so encode() duck-types too, the exact
//     mirror of nisaba's own fix.
// See nisaba's own wasm/nisaba-wasm.js for the matching server-side half.
import { ObjectId, Pointer } from './third_party/binjson/js/binjson.js';

function isObjectIdLike(value) {
  return value instanceof ObjectId || (value && typeof value.toHexString === 'function' && typeof value.toBytes === 'function');
}

function isPointerLike(value) {
  return value instanceof Pointer || (value && typeof value.offset === 'number' && value.constructor?.name === 'Pointer');
}

/** JS value (possibly containing ObjectId/Date/Pointer/Uint8Array) -> plain JSON-safe value. */
function encode(value) {
  if (isObjectIdLike(value)) return { $oid: value.toHexString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (isPointerLike(value)) return { $pointer: String(value.offset) };
  if (value instanceof Uint8Array) return { $binary: { base64: Buffer.from(value).toString('base64'), subType: '00' } };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encode(v);
    return out;
  }
  return value;
}

/** Plain JSON value (possibly containing $oid/$date/$pointer/$binary wrappers) -> JS value. */
function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    if (typeof value.$oid === 'string') return new ObjectId(value.$oid);
    if (typeof value.$date === 'string') return new Date(value.$date);
    if (typeof value.$pointer === 'string') return new Pointer(Number(value.$pointer));
    if (value.$binary && typeof value.$binary.base64 === 'string') {
      return new Uint8Array(Buffer.from(value.$binary.base64, 'base64'));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

export { encode, decode };
