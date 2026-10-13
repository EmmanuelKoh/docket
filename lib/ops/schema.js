// lib/ops/schema.js: Zod helpers shared by ops.
import { z } from 'zod';

const bytes = z.instanceof(Buffer);
// Bytes in or out of an op. JSON form: a base64 string.
export const Binary = z.object({ contentType: z.string(), body: bytes });

// Input JSON Schema, for the registry test now and a tool adapter later.
// Throws on anything JSON cannot carry, except Binary.
const NOT_JSON = ['custom', 'date', 'bigint', 'symbol', 'map', 'set', 'function', 'nan', 'undefined', 'void'];
export const toJsonSchema = schema => z.toJSONSchema(schema, {
  io: 'input', unrepresentable: 'any',
  override: ({ zodSchema, jsonSchema }) => {
    if (zodSchema === bytes) Object.assign(jsonSchema, { type: 'string', contentEncoding: 'base64' });
    else if (NOT_JSON.includes(zodSchema._zod.def.type)) throw new Error(`${zodSchema._zod.def.type} is not JSON`);
  },
});
