// lib/llm/index.js: one neutral call: structured output described by a Zod schema.
// Supported schema subset: object, array, string, number, integer, boolean, enum,
// optional, description. Anything else (nullable, union, literal, $ref) needs
// Gemini's generationConfig.responseJsonSchema, which takes raw JSON Schema;
// tool calling would use functionDeclarations[].parametersJsonSchema the same way,
// as a separate generate({ messages, tools }) beside generateObject.
import { z } from 'zod';
import * as provider from './gemini.js';

/**
 * @template {import('zod').ZodType} S
 * @param {{ schema: S, prompt: string, model?: string, temperature?: number }} req
 * @returns {Promise<import('zod').output<S>>}
 */
export async function generateObject({ schema, prompt, model, temperature = 0 }) {
  // Input side: the model's reply is what schema.safeParse consumes.
  const jsonSchema = z.toJSONSchema(schema, { io: 'input' });
  const raw = await provider.generateJson({ jsonSchema, prompt, model, temperature });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`model reply does not match the schema: ${parsed.error.issues[0].message}`);
  return parsed.data;
}
