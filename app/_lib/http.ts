// app/_lib/http.ts: OpError to HTTP for dashboard routes. Anything else is a 500.
const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid: 400,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  busy: 429,
  unavailable: 502,
};
export function errorResponse(err: unknown): Response {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    retryAfter?: number;
  };
  if (e?.name === 'OpError' && e.code && STATUS[e.code]) {
    const headers: Record<string, string> =
      e.code === 'busy' ? { 'Retry-After': String(e.retryAfter ?? 60) } : {};
    return Response.json(
      { error: e.message },
      { status: STATUS[e.code], headers },
    );
  }
  console.error(err);
  return Response.json(
    { error: e?.message || 'server error' },
    { status: 500 },
  );
}
// An op that returns nothing answers null: Response.json(undefined) throws,
// which would turn a write that already happened into a 500.
export async function json(
  fn: () => Promise<unknown>,
  status = 200,
): Promise<Response> {
  try {
    return Response.json((await fn()) ?? null, { status });
  } catch (err) {
    return errorResponse(err);
  }
}

// For routes that read a request body: refuse a request with no session
// before reading it, with the answer the op would give.
export function signInRequired(): Response {
  return Response.json({ error: 'sign in required' }, { status: 401 });
}
