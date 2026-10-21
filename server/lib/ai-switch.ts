/**
 * The one switch for every AI feature in the app.
 *
 * Adolfo uses AI reading (RFP Step 2, bid import, pay apps) himself today, and
 * wants to be able to hand the app to the team with all of it off. One stored
 * setting, read by every AI endpoint and by the client to hide the buttons.
 *
 * Stored in app_settings rather than an env var so it flips from Admin without
 * a republish. Missing row = ON, so nothing changes until someone turns it off.
 */
import type { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db';

export const SETTING_AI_ENABLED = 'ai_enabled';
export const AI_OFF_MESSAGE = 'AI features are turned off. An admin can turn them back on in Admin → AI.';

let cache: { value: boolean; at: number } | null = null;
const TTL_MS = 10_000;

async function ensureTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS app_settings (
    "key" text PRIMARY KEY,
    "value" text NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(),
    updated_by text
  )`);
}

export async function aiEnabled(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const r: any = await db.execute(sql`SELECT value FROM app_settings WHERE key = ${SETTING_AI_ENABLED}`);
    const rows = r?.rows ?? r ?? [];
    const value = rows.length ? String(rows[0].value) !== 'false' : true;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Table missing: nothing has ever been turned off.
    return true;
  }
}

export async function setAiEnabled(enabled: boolean, by: string | null): Promise<void> {
  await ensureTable();
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${SETTING_AI_ENABLED}, ${enabled ? 'true' : 'false'}, ${by}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
  cache = { value: enabled, at: Date.now() };
}

export async function aiStatus() {
  const r: any = await db.execute(sql`SELECT updated_by, extract(epoch from updated_at) AS at FROM app_settings WHERE key = ${SETTING_AI_ENABLED}`).catch(() => null);
  const row = (r?.rows ?? r ?? [])[0];
  return {
    enabled: await aiEnabled(),
    configured: !!process.env.ANTHROPIC_API_KEY,
    updatedBy: row?.updated_by ?? null,
    // Stored as UTC wall time (now() on a UTC database); epoch keeps it unambiguous.
    updatedAt: row?.at != null ? new Date(Number(row.at) * 1000).toISOString() : null,
  };
}

/** Route guard: 403 when the switch is off, 503 when no key is set. */
export async function requireAi(_req: Request, res: Response, next: NextFunction) {
  if (!(await aiEnabled())) return res.status(403).json({ message: AI_OFF_MESSAGE, aiOff: true });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ message: 'AI is not configured (no ANTHROPIC_API_KEY secret).' });
  next();
}
