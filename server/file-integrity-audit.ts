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
