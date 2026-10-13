// lib/ops/define.js: an operation is (caller, input) -> output, declared once.
// Adapters (routes, pages, scripts) call operations; operations call stores.
// No zod import: lib/ops/device-service.js imports OpError, and /next stays off zod.

// What an operation touches, in meter terms (docs/store-costs.md). kv = Redis
// records and state (json files locally); signal = Blob flags.
export const READS = ['db.read', 'kv.read', 'queue.read', 'artifact.get', 'signal.read', 'render'];
export const WRITES = ['db.write', 'kv.write', 'queue.enqueue', 'queue.claim', 'queue.release',
  'artifact.put', 'artifact.delete', 'signal.write', 'llm', 'net'];
// Spread into every op that can create a job, directly or through ctx (createJob trims old jobs and their blobs).
export const JOB_CREATE = ['artifact.put', 'db.write', 'queue.enqueue', 'signal.write', 'artifact.delete'];

export class OpError extends Error { constructor(code, message) { super(message); this.name = 'OpError'; this.code = code; } }

const ALLOW = {
  public: () => true,
  owner: c => !!c?.ownerId && c.actor.kind !== 'device',
  admin: c => c?.role === 'admin',
};
export const canCall = (spec, c) => spec.permission.some(p => ALLOW[p](c))
  && (!c?.grants || c.grants.includes(spec.name) || (spec.readOnly && c.grants.includes('read')));

const CHECK_OUTPUT = process.env.NODE_ENV !== 'production';
// Outputs are JSON values: ISO strings for time, bytes only as Binary (lib/ops/schema.js).
function assertJson(v, at = 'result') {
  const obj = v !== null && typeof v === 'object' && !Buffer.isBuffer(v);
  const proto = obj && !Array.isArray(v) ? Object.getPrototypeOf(v) : null;
  if (['function', 'bigint', 'symbol'].includes(typeof v) || (proto && proto !== Object.prototype)) {
    throw new Error(`${at}: ${v?.constructor?.name ?? typeof v} is not a JSON value`);
  }
  if (obj) for (const [k, x] of Object.entries(v)) assertJson(x, `${at}.${k}`);
}

/**
 * @template {import('zod').ZodType} I
 * @template O
 * @param {{ name: string, description: string, input: I, output?: import('zod').ZodType,
 *   permission: 'public' | 'owner' | 'admin' | Array<'public' | 'owner' | 'admin'>,
 *   effects: string[], destructive?: boolean,
 *   run: (caller: import('./caller.js').Caller, input: import('zod').output<I>) => Promise<O> }} spec
 * @returns {((caller: import('./caller.js').Caller | null, input?: import('zod').input<I>) => Promise<O>) & { spec: object }}
 */
export function defineOperation({ name, description, input, output, permission, effects = [], destructive = false, run }) {
  const allow = [permission].flat();
  const bad = [...allow.filter(p => !ALLOW[p]), ...effects.filter(e => !READS.includes(e) && !WRITES.includes(e))];
  if (!name || !description || !input || !run || !effects.length || bad.length) throw new Error(`defineOperation ${name}: bad spec ${bad.join(' ')}`);
  const readOnly = !effects.some(e => WRITES.includes(e));
  const spec = Object.freeze({ name, description, input, output, permission: allow, readOnly, destructive, effects });
  async function op(caller, raw = {}) {
    if (!canCall(spec, caller)) throw caller ? new OpError('forbidden', 'not allowed') : new OpError('unauthenticated', 'sign in required');
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw new OpError('invalid', parsed.error.issues[0].message);
    const result = await run(caller, parsed.data);
    if (CHECK_OUTPUT) { assertJson(result); output?.parse(result); } // dev and tests; never reshapes
    return result;
  }
  op.spec = spec;
  return op;
}
