import { describe, it, expect } from 'vitest';
import { ObjectId, Pointer } from '../third_party/binjson/js/binjson.js';
import { encode, decode } from '../extended-json.js';

describe('extended-json', () => {
  it('round-trips a document with every wrapped type through real JSON.stringify/parse', () => {
    const id = new ObjectId();
    const doc = {
      _id: id,
      name: 'Ada',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      avatar: new Uint8Array([1, 2, 3, 255]),
      offset: new Pointer(12345),
      nested: { tags: ['a', 'b'], count: 3, active: true, note: null }
    };

    const text = JSON.stringify(encode(doc));
    const back = decode(JSON.parse(text));

    expect(back._id).toBeInstanceOf(ObjectId);
    expect(back._id.equals(id)).toBe(true);
    expect(back.createdAt).toBeInstanceOf(Date);
    expect(back.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(back.avatar).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.avatar)).toEqual([1, 2, 3, 255]);
    expect(back.offset).toBeInstanceOf(Pointer);
    expect(back.offset.valueOf()).toBe(12345);
    expect(back.nested).toEqual({ tags: ['a', 'b'], count: 3, active: true, note: null });
  });

  it('encodes the wire shape documented in cloud-rest-api.md', () => {
    const id = new ObjectId('507f1f77bcf86cd799439011');
    const wire = encode({ _id: id, createdAt: new Date('2024-01-01T00:00:00.000Z') });
    expect(wire).toEqual({
      _id: { $oid: '507f1f77bcf86cd799439011' },
      createdAt: { $date: '2024-01-01T00:00:00.000Z' }
    });
  });

  it('leaves plain values (arrays, primitives, null) untouched', () => {
    const value = { a: 1, b: 'x', c: [1, 2, { d: null }], e: false };
    expect(decode(JSON.parse(JSON.stringify(encode(value))))).toEqual(value);
  });

  it('encode() duck-types ObjectId/Pointer-shaped values, not just instanceof (e.g. values read back from nisaba\'s own internal copy)', () => {
    const real = new ObjectId();
    // Simulates a value nisaba's engine handed back that was constructed
    // against its own internal copy of binjson's ObjectId (a different
    // module instance, same shape) -- exactly what an auto-generated _id
    // or any ObjectId-typed document field looks like when read back
    // through the server, per this file's own header comment.
    const foreignId = { toHexString: () => real.toHexString(), toBytes: () => real.toBytes() };
    expect(foreignId).not.toBeInstanceOf(ObjectId);
    expect(encode(foreignId)).toEqual({ $oid: real.toHexString() });

    // Same class *name* as a different copy of binjson would produce
    // (nisaba's own internal Pointer class), deliberately not the same
    // class reference as the `Pointer` imported above.
    class ForeignPointerModule {
      static {
        Object.defineProperty(this, 'name', { value: 'Pointer' });
      }
      constructor(offset) {
        this.offset = offset;
      }
    }
    const foreignPointer = new ForeignPointerModule(42);
    expect(foreignPointer).not.toBeInstanceOf(Pointer);
    expect(foreignPointer.constructor.name).toBe('Pointer');
    expect(encode(foreignPointer)).toEqual({ $pointer: '42' });

    // A plain object that merely happens to have a numeric `offset` field
    // must NOT be mistaken for a Pointer.
    expect(encode({ offset: 42, note: 'just a document field' })).toEqual({ offset: 42, note: 'just a document field' });
  });
});
