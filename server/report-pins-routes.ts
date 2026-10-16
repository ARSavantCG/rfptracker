/**
 * Pinned reports — one person's shortcuts to the reports they actually use.
 *
 * Everything is scoped to req.userId. There is no endpoint that reads or writes
 * another person's pins, by id or otherwise: the user id is taken from the
 * authenticated token and never from the request body, so a pin cannot be
 * planted on someone else's account.
 *
 * STALE PINS ARE RESOLVED HERE, NOT IN THE BROWSER. The server knows which
 * properties exist, so a pin whose property has been renamed or deleted comes
 * back marked unavailable with a reason the person can read. The alternative —
 * handing the client a URL and letting it 500 — is how a pin turns into a
 * support question.
 */
import type { Express } from 'express';
import { db } from './db';
import { userReportPins, properties } from '@shared/schema';
import { and, asc, eq } from 'drizzle-orm';
import { requireAuth } from './middleware';
import {
  REPORTS_BY_KEY,
  REPORT_CATALOG,
  buildReportUrl,
  describeReportPin,
  canViewReport,
  unknownParamKeys,
  type ReportParam,
} from '@shared/report-catalog';

/** The maximum number of pins one person can hold. A guard, not a product limit. */
const MAX_PINS = 24;

/** Normalise a params object: strings only, declared keys only, trimmed. */
function cleanParams(reportKey: string, raw: any): Record<string, string> {
  const def = REPORTS_BY_KEY[reportKey];
  if (!def) return {};
  const out: Record<string, string> = {};
  for (const param of def.params) {
    const value = raw?.[param.name];
    if (value === undefined || value === null || value === '' || value === false) continue;
    out[param.name] = param.type === 'boolean' ? 'true' : String(value).trim();
  }
  return out;
}

/** Stable key for "is this the same pin", so starring twice does not duplicate. */
function pinIdentity(reportKey: string, params: Record<string, string>): string {
  const ordered = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return `${reportKey}::${ordered}`;
}

export function registerReportPinRoutes(app: Express): void {
  /**
   * The catalog itself, filtered to what this viewer is allowed to open.
   * Served from the server so the permission check is not the browser's to make.
   */
  app.get('/api/reports/catalog', requireAuth, async (req: any, res) => {
    try {
      const permissions: string[] = req.user?.permissions || [];
      const isAdmin = !!req.user?.isAdmin;
      res.json({
        reports: REPORT_CATALOG.filter((def) => isAdmin || canViewReport(def, permissions)),
      });
    } catch (error) {
      console.error('[report-pins] catalog failed:', error);
      res.status(500).json({ message: 'Failed to load the report catalog' });
    }
  });

  /** This person's pins, resolved and ready to render. */
  app.get('/api/me/report-pins', requireAuth, async (req: any, res) => {
    try {
      const userId = String(req.userId);
      const rows = await db
        .select()
        .from(userReportPins)
        .where(eq(userReportPins.userId, userId))
        .orderBy(asc(userReportPins.position), asc(userReportPins.id));

      // Properties are loaded once for the whole set rather than per pin.
      // Most people pin a handful; a query each would be a handful of queries
      // for one page load.
      const propRows = await db
        .select({ id: properties.id, propertyName: properties.propertyName, building: properties.building })
        .from(properties);
      const propById = new Map(propRows.map((p) => [String(p.id), p]));
      const propNames = new Set(propRows.map((p) => String(p.propertyName).trim().toLowerCase()));

      const resolve = (param: ReportParam, value: string): string | null => {
        if (param.type === 'property') {
          const p = propById.get(String(value));
          if (!p) return null;
          return p.building ? `${p.propertyName} — Bldg. ${p.building}` : p.propertyName;
        }
        if (param.type === 'propertyName') {
          return propNames.has(value.trim().toLowerCase()) ? value : null;
        }
        return value;
      };

      const permissions: string[] = req.user?.permissions || [];
      const isAdmin = !!req.user?.isAdmin;

      const pins = rows.map((row) => {
        const def = REPORTS_BY_KEY[row.reportKey];

        // A pin to a report that no longer exists in the catalog. Shown so the
        // person can see why it stopped working and remove it, rather than
        // quietly vanishing from their list.
        if (!def) {
          return {
            id: row.id,
            reportKey: row.reportKey,
            label: row.reportKey,
            url: null,
            kind: null,
            available: false,
            reason: 'This report is no longer part of the app.',
          };
        }

        if (!isAdmin && !canViewReport(def, permissions)) {
          return {
            id: row.id,
            reportKey: row.reportKey,
            label: def.label,
            url: null,
            kind: def.kind,
            available: false,
            reason: 'You no longer have permission to open this report.',
          };
        }

        const params = (row.params || {}) as Record<string, string>;
        const described = describeReportPin(def, params, resolve);
        const dropped = unknownParamKeys(def, params);

        return {
          id: row.id,
          reportKey: row.reportKey,
          label: described.label,
          // Still built when unavailable is false only; a pin whose property is
          // gone gets no URL, so there is nothing to click through to an error.
          url: described.available ? buildReportUrl(def, params) : null,
          kind: def.kind,
          icon: def.icon,
          answers: def.answers,
          params,
          available: described.available,
          reason: described.reason,
          // Surfaced rather than silently ignored: a parameter this report no
          // longer understands means the pin opens a broader view than intended.
          droppedParams: dropped.length ? dropped : undefined,
        };
      });

      res.json({ pins });
    } catch (error) {
      console.error('[report-pins] list failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to load pinned reports: ${message}` });
    }
  });

  /** Pin a report. Starring the same report and scope twice is a no-op. */
  app.post('/api/me/report-pins', requireAuth, async (req: any, res) => {
    try {
      const userId = String(req.userId);
      const reportKey = String(req.body?.reportKey || '').trim();

      const def = REPORTS_BY_KEY[reportKey];
      if (!def) {
        return res.status(400).json({ message: `Unknown report "${reportKey}".` });
      }

      const permissions: string[] = req.user?.permissions || [];
      if (!req.user?.isAdmin && !canViewReport(def, permissions)) {
        return res.status(403).json({ message: 'You do not have permission to open that report.' });
      }

      const params = cleanParams(reportKey, req.body?.params);

      const existing = await db
        .select()
        .from(userReportPins)
        .where(eq(userReportPins.userId, userId));

      const identity = pinIdentity(reportKey, params);
      const already = existing.find(
        (row) => pinIdentity(row.reportKey, (row.params || {}) as Record<string, string>) === identity
      );
      if (already) {
        return res.json({ pinned: true, id: already.id, alreadyPinned: true });
      }

      if (existing.length >= MAX_PINS) {
        return res.status(400).json({
          message: `You can pin up to ${MAX_PINS} reports. Remove one to add another.`,
        });
      }

      const nextPosition = existing.reduce((max, row) => Math.max(max, row.position ?? 0), -1) + 1;

      const [created] = await db
        .insert(userReportPins)
        .values({ userId, reportKey, params, position: nextPosition })
        .returning();

      res.json({ pinned: true, id: created.id });
    } catch (error) {
      console.error('[report-pins] create failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to pin the report: ${message}` });
    }
  });

  /**
   * Unpin. Scoped to this person's own pins in the WHERE clause, so an id
   * belonging to someone else matches nothing and returns 404 rather than
   * deleting their pin.
   */
  app.delete('/api/me/report-pins/:id', requireAuth, async (req: any, res) => {
    try {
      const userId = String(req.userId);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: 'Invalid pin id' });

      const deleted = await db
        .delete(userReportPins)
        .where(and(eq(userReportPins.id, id), eq(userReportPins.userId, userId)))
        .returning();

      if (deleted.length === 0) {
        return res.status(404).json({ message: 'Pin not found' });
      }
      res.json({ unpinned: true });
    } catch (error) {
      console.error('[report-pins] delete failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to remove the pin: ${message}` });
    }
  });
}
