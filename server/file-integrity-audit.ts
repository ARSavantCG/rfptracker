/**
 * File integrity audit.
 *
 * WHY THIS EXISTS: uploads are written to local disk and backed up to Object
 * Storage on a fire-and-forget promise. Replit wipes the local disk on every
 * publish, so Object Storage is the only durable copy. If a backup failed, the
 * database still holds a perfectly normal-looking attachment row pointing at
 * bytes that no longer exist anywhere — and nobody discovers it until someone
 * clicks download, usually in front of the person who sent the file.
 *
 * This route answers the question "which of our files are actually still there?"
 * BEFORE a user asks it. It is READ-ONLY: it resolves each attachment exactly the
 * way the download routes do, and reports. It never writes, deletes, or repairs.
 *
 * GET /api/admin/file-audit          → summary + the missing files
 * GET /api/admin/file-audit?all=1    → every file, including the healthy ones
 */
import type { Express } from 'express';
import { db } from './db';
import { propertyAttachments, projectFiles, evaluationBudgetAttachments, properties, rfpRequests } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getFileBuffer } from './storage-backup';
import { requireAuth, checkPermission } from './middleware';

interface AuditRow {
  source: 'property_attachment' | 'project_file' | 'evaluation_budget_attachment';
  id: number;
  ownerLabel: string;
  originalName: string;
  storedAs: string;
  sizeBytes: number | null;
  retrievable: boolean;
}

export function registerFileIntegrityAudit(app: Express) {

  /**
   * Purge records whose bytes are gone.
   *
   * Deletes DATABASE ROWS ONLY, and only for records this endpoint has just
   * re-verified as unretrievable. Nothing is deleted on the strength of what the
   * client sends: the client sends ids, the server re-resolves each one through
   * getFileBuffer, and any file that turns out to BE retrievable is skipped and
   * reported. A stale audit result therefore cannot delete a live file.
   *
   * There is nothing to delete on disk or in Object Storage - that is the whole
   * point, the bytes are already gone. This only clears the dangling records.
   */
  app.post('/api/admin/file-audit/purge', requireAuth, checkPermission('admin.access'), async (req, res) => {
    const targets: { source: string; id: number }[] = Array.isArray(req.body?.files) ? req.body.files : [];
    if (targets.length === 0) {
      return res.status(400).json({ message: 'No files specified.' });
    }

    const deleted: { source: string; id: number; name: string }[] = [];
    const skipped: { source: string; id: number; reason: string }[] = [];

    try {
      for (const t of targets) {
        // Re-verify before deleting. This is the guard that makes the endpoint
        // safe to expose at all.
        let filename: string | null = null;
        let originalName: string | null = null;

        if (t.source === 'property_attachment') {
          const [row] = await db.select({ f: propertyAttachments.filename, o: propertyAttachments.originalName })
            .from(propertyAttachments).where(eq(propertyAttachments.id, t.id));
          if (row) { filename = row.f; originalName = row.o; }
        } else if (t.source === 'project_file') {
          const [row] = await db.select({ f: projectFiles.filePath, o: projectFiles.originalName })
            .from(projectFiles).where(eq(projectFiles.id, t.id));
          if (row) { filename = row.f; originalName = row.o; }
        } else if (t.source === 'evaluation_budget_attachment') {
          const [row] = await db.select({ f: evaluationBudgetAttachments.filename, o: evaluationBudgetAttachments.originalName })
            .from(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.id, t.id));
          if (row) { filename = row.f; originalName = row.o; }
        } else {
          skipped.push({ ...t, reason: 'unknown source' });
          continue;
        }

        if (!filename) {
          skipped.push({ ...t, reason: 'record no longer exists' });
          continue;
        }

        const buf = await getFileBuffer(filename, originalName || undefined);
        if (buf) {
          skipped.push({ ...t, reason: 'file IS retrievable — not deleted' });
          continue;
        }

        if (t.source === 'property_attachment') {
          await db.delete(propertyAttachments).where(eq(propertyAttachments.id, t.id));
        } else if (t.source === 'project_file') {
          await db.delete(projectFiles).where(eq(projectFiles.id, t.id));
        } else {
          await db.delete(evaluationBudgetAttachments).where(eq(evaluationBudgetAttachments.id, t.id));
        }
        deleted.push({ source: t.source, id: t.id, name: originalName || filename });
        console.log(`[file-audit] purged dangling record ${t.source}#${t.id} (${originalName})`);
      }

      res.json({ deleted, skipped, deletedCount: deleted.length, skippedCount: skipped.length });
    } catch (error) {
      console.error('[file-audit] purge failed:', error);
      res.status(500).json({ message: 'Purge failed', error: (error as Error).message });
    }
  });

  app.get('/api/admin/file-audit', requireAuth, checkPermission('admin.access'), async (req, res) => {
    const includeAll = req.query.all === '1';
    const rows: AuditRow[] = [];

    try {
      // ── Property attachments ────────────────────────────────────────────
      const propRows = await db
        .select({
          id: propertyAttachments.id,
          filename: propertyAttachments.filename,
          originalName: propertyAttachments.originalName,
          size: propertyAttachments.size,
          propertyName: properties.propertyName,
        })
        .from(propertyAttachments)
        .leftJoin(properties, eq(propertyAttachments.propertyId, properties.id));

      for (const r of propRows) {
        // Same resolution the download route uses, so a pass here means the
        // download genuinely works — not that a file merely exists somewhere.
        const buf = await getFileBuffer(r.filename, r.originalName);
        rows.push({
          source: 'property_attachment',
          id: r.id,
          ownerLabel: r.propertyName || `property #${r.id}`,
          originalName: r.originalName,
          storedAs: r.filename,
          sizeBytes: r.size ?? null,
          retrievable: !!buf,
        });
      }

      // ── Project files ───────────────────────────────────────────────────
      const projRows = await db
        .select({
          id: projectFiles.id,
          filePath: projectFiles.filePath,
          originalName: projectFiles.originalName,
          fileSize: projectFiles.fileSize,
          rfpNumber: rfpRequests.rfpNumber,
        })
        .from(projectFiles)
        .leftJoin(rfpRequests, eq(projectFiles.projectId, rfpRequests.id));

      for (const r of projRows) {
        const buf = await getFileBuffer(r.filePath, r.originalName);
        rows.push({
          source: 'project_file',
          id: r.id,
          ownerLabel: r.rfpNumber || `rfp #${r.id}`,
          originalName: r.originalName,
          storedAs: r.filePath,
          sizeBytes: r.fileSize ?? null,
          retrievable: !!buf,
        });
      }

      // ── Evaluation budget attachments ───────────────────────────────────
      const evalRows = await db
        .select({
          id: evaluationBudgetAttachments.id,
          filename: evaluationBudgetAttachments.filename,
          originalName: evaluationBudgetAttachments.originalName,
          size: evaluationBudgetAttachments.size,
          rfpNumber: rfpRequests.rfpNumber,
        })
        .from(evaluationBudgetAttachments)
        .leftJoin(rfpRequests, eq(evaluationBudgetAttachments.rfpId, rfpRequests.id));

      for (const r of evalRows) {
        const buf = await getFileBuffer(r.filename, r.originalName);
        rows.push({
          source: 'evaluation_budget_attachment',
          id: r.id,
          ownerLabel: r.rfpNumber || `rfp #${r.id}`,
          originalName: r.originalName,
          storedAs: r.filename,
          sizeBytes: r.size ?? null,
          retrievable: !!buf,
        });
      }

      const missing = rows.filter((r) => !r.retrievable);

      res.json({
        checkedAt: new Date().toISOString(),
        objectStorageConfigured: !!process.env.PRIVATE_OBJECT_DIR,
        summary: {
          total: rows.length,
          retrievable: rows.length - missing.length,
          missing: missing.length,
          bySource: ['property_attachment', 'project_file', 'evaluation_budget_attachment'].map((src) => {
            const of = rows.filter((r) => r.source === src);
            return { source: src, total: of.length, missing: of.filter((r) => !r.retrievable).length };
          }),
        },
        missingFiles: missing,
        allFiles: includeAll ? rows : undefined,
      });
    } catch (error) {
      console.error('[file-audit] failed:', error);
      res.status(500).json({ message: 'File audit failed', error: (error as Error).message });
    }
  });
}
