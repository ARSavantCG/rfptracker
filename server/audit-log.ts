/**
 * RFP Tracker — Audit Log Helper
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 *
 * Known event types (open-ended — new values can be added without touching this file):
 *   'login_success'  — user authenticated successfully
 *   'login_failure'  — authentication attempt rejected (check metadata.reason)
 *
 * Future event types (not yet instrumented):
 *   'rfp_created', 'rfp_updated', 'rfp_deleted'
 *   'property_created', 'property_updated', 'property_deleted'
 *   'existing_improvement_created', 'existing_improvement_updated', 'existing_improvement_deleted'
 *   'contact_created', 'contact_updated', 'contact_deleted'
 *   'bid_collection_updated', 'rom_scope_item_updated', 'project_actuals_saved'
 */

import { db } from './db';
import { auditLog } from '@shared/schema';

// Keys whose values are always replaced with '[REDACTED]' before storage.
// Extend this list when new sensitive fields are introduced.
const SENSITIVE_KEYS = ['password', 'passwordHash', 'token', 'sessionToken', 'apiKey', 'secret'];

function redactSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.includes(key) ? '[REDACTED]' : redactSensitive(value);
  }
  return result;
}

export async function logEvent(params: {
  eventType: string;
  userId: string | null;
  userEmail: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: object | null;
  beforeData?: object | null;
  afterData?: object | null;
  changedFields?: string[] | null;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      eventType: params.eventType,
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      metadata: params.metadata ? (redactSensitive(params.metadata) as object) : null,
      beforeData: params.beforeData ? (redactSensitive(params.beforeData) as object) : null,
      afterData: params.afterData ? (redactSensitive(params.afterData) as object) : null,
      changedFields: params.changedFields ?? null,
    });
  } catch (error: any) {
    // CONTROLLED SWALLOW: audit failures must NEVER block or fail user operations.
    // We log loudly (name + message + params) so the failure is visible in monitoring,
    // but we do NOT re-throw. This is intentional contrast to the silent-failure
    // anti-pattern — swallowing errors with no trace — that has caused hard-to-debug
    // regressions in this codebase historically.
    console.error('[audit-log] Insert failed — non-fatal but requires investigation:', {
      errorName: error?.name,
      errorMessage: error?.message,
      params,
    });
  }
}
