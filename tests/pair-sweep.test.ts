// tests/pair-sweep.test.ts — /pair is open to anyone and each new
// hardwareId adds a device row, so lib/devices.js beginPairing deletes
// stale unclaimed rows whenever it adds one: no owner, created over a day
// ago, no live code, at most 100 per call. A claimed device, a recent
// row, and a device still showing a live code are never swept. Refreshing
// an existing row's code adds nothing and sweeps nothing.

import crypto from 'node:crypto';
import { like } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { device } from '@/db/schema.js';
import { getDb } from '@/lib/db.js';
import { beginPairing } from '@/lib/devices.js';

vi.hoisted(() => {
  process.env.DATA_DIR = `${process.env.DATA_DIR}/pair-sweep`;
});

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);

type Row = {
  createdAt: Date;
  pairCodeExpiresAt: Date | null;
  ownerId?: string;
};

async function insert(prefix: string, rows: Record<string, Row>) {
  const db = await getDb();
  await db.insert(device).values(
    Object.entries(rows).map(([name, r]) => ({
      id: crypto.randomUUID(),
      hardwareId: `${prefix}-${name}`,
      ownerId: r.ownerId ?? null,
      pairCode: r.pairCodeExpiresAt
        ? `C${crypto.randomBytes(4).toString('hex')}`
        : null,
      pairCodeExpiresAt: r.pairCodeExpiresAt,
      createdAt: r.createdAt,
    })),
  );
}

async function left(prefix: string) {
  const db = await getDb();
  const rows = await db
    .select({ hardwareId: device.hardwareId })
    .from(device)
    .where(like(device.hardwareId, `${prefix}-%`));
  return rows.map((r) => r.hardwareId.slice(prefix.length + 1)).sort();
}

const newPrefix = () =>
  `esp32-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

describe('beginPairing sweeps stale unclaimed devices', () => {
  it('deletes only unclaimed rows over a day old with no live code', async () => {
    const p = newPrefix();
    await insert(p, {
      stale: { createdAt: ago(25 * HOUR), pairCodeExpiresAt: ago(24 * HOUR) },
      nocode: { createdAt: ago(48 * HOUR), pairCodeExpiresAt: null },
      live: {
        createdAt: ago(25 * HOUR),
        pairCodeExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
      recent: { createdAt: ago(1 * HOUR), pairCodeExpiresAt: ago(HOUR / 2) },
      claimed: {
        createdAt: ago(48 * HOUR),
        pairCodeExpiresAt: ago(47 * HOUR),
        ownerId: 'owner-x',
      },
    });

    // Refreshing an existing row's code adds no row and sweeps nothing.
    await beginPairing(`${p}-recent`);
    expect(await left(p)).toEqual([
      'claimed',
      'live',
      'nocode',
      'recent',
      'stale',
    ]);

    // A new hardwareId adds a row and sweeps.
    const { code } = await beginPairing(`${p}-new`);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await left(p)).toEqual(['claimed', 'live', 'new', 'recent']);
  });

  it('deletes at most 100 rows per new pairing', async () => {
    const p = newPrefix();
    const rows: Record<string, Row> = {};
    for (let i = 0; i < 105; i++) {
      rows[`old${String(i).padStart(3, '0')}`] = {
        createdAt: ago(30 * HOUR),
        pairCodeExpiresAt: ago(29 * HOUR),
      };
    }
    // Clear stale rows other tests left, so only these count.
    await beginPairing(`${newPrefix()}-warmup`);
    await insert(p, rows);
    await beginPairing(`${p}-new`);
    expect((await left(p)).filter((n) => n.startsWith('old'))).toHaveLength(5);
    await beginPairing(`${p}-new2`);
    expect((await left(p)).filter((n) => n.startsWith('old'))).toHaveLength(0);
  });

  it('a failed sweep never fails the pairing', async () => {
    const db = await getDb();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const del = vi.spyOn(db, 'delete').mockImplementation(() => {
      throw new Error('sweep broke');
    });
    try {
      const p = newPrefix();
      const { code } = await beginPairing(`${p}-new`);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(await left(p)).toEqual(['new']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sweep broke'));
    } finally {
      del.mockRestore();
      warn.mockRestore();
    }
  });
});
