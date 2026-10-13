// tests/ops/registry.test.ts — every registered operation's input must
// render through the strict JSON Schema exporter, so a future tool adapter
// (CLI, MCP) can describe it.

import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { OPERATIONS } from '@/lib/ops/index.js';
import { toJsonSchema } from '@/lib/ops/schema.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/ops-registry`;
});

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in tests');
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

it('renders every registered input as JSON Schema', () => {
  for (const [name, op] of Object.entries(OPERATIONS)) {
    expect(op.spec.name).toBe(name);
    expect(() => toJsonSchema(op.spec.input), name).not.toThrow();
  }
});
