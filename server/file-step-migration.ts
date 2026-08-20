/**
 * One-time renumber of file workflow steps.
 *
 * The folder mapping used to fold invitation-to-bid and bid-collection into a
 * single Step_3, so everything after it was one too low:
 *
 *   OLD                           NEW
 *   3  Bidding (ITB + responses)  3  Invitation to Bid
 *                                 4  Bid Collection
 *   4  Evaluation                 5  Evaluation
 *   5  Publishing                 6  Publish
 *
 * THE TWO SCHEMES OVERLAP AMBIGUOUSLY. A file recorded as "4" is old-Evaluation
 * OR new-Bid-Collection. A "5" is old-Publishing OR new-Evaluation. The stored
 * value alone cannot tell them apart - only the upload time can, because the
 * renumbering shipped at a known moment.
 *
 * So this migrates ONLY files uploaded before a caller-supplied cutoff, and it
 * PREVIEWS before it writes. It is not wired into startup: it rewrites real
 * records, and the counts should be seen first.
 *
 * STEP 3 IS DELIBERATELY NOT SPLIT. Under the old scheme both the invitation and
 * the bid responses were written as 3, and nothing in the record distinguishes
 * them. Guessing would file real bid responses under the invitation that
 * requested them. They stay at 3 and the response says how many are affected.
 */
import type { Express } from 'express';
import { db } from './db';
import { projectFiles } from '@shared/schema';
import { and, lt, sql } from 'drizzle-orm';
import { requireAuth, checkPermission } from './middleware';

/** old step -> new step. Only the shifted ones. */
const STEP_REMAP: Record<number, number> = {
  4: 5, // Evaluation
  5: 6, // Publish
};

/** The column is TEXT and holds either "4" or "Step_4_Evaluation". */
function stepNumber(raw: string | null): number {
  const m = String(raw ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

export function registerFileStepMigration(app: Express) {
  /**
   * Defaults to PREVIEW. Applying requires ?apply=1, so a mistyped URL cannot
   * rewrite records.
   */
  app.post('/api/admin/migrate-file-steps', requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const apply = req.query.apply === '1';
      const cutoffRaw = String(req.body?.cutoff || '').trim();
      if (!cutoffRaw) {
        return res.status(400).json({
          message: 'A cutoff timestamp is required — the moment the renumbering was published. Files uploaded BEFORE it are treated as old-scheme.',
        });
      }
      const cutoff = new Date(cutoffRaw);
      if (isNaN(cutoff.getTime())) {
        return res.status(400).json({ message: `Could not parse cutoff "${cutoffRaw}". Use an ISO timestamp, e.g. 2026-08-20T00:00:00-04:00` });
      }

      const candidates = await db
        .select({
          id: projectFiles.id,
          projectId: projectFiles.projectId,
          originalName: projectFiles.originalName,
          workflowStep: projectFiles.workflowStep,
          uploadedAt: projectFiles.uploadedAt,
        })
        .from(projectFiles)
        .where(lt(projectFiles.uploadedAt, cutoff));

      const planned = candidates
        .map((f) => ({ ...f, from: stepNumber(f.workflowStep) }))
        .filter((f) => STEP_REMAP[f.from] !== undefined)
        .map((f) => ({ ...f, to: STEP_REMAP[f.from] }));

      const byMove: Record<string, number> = {};
      for (const f of planned) {
        const k = `${f.from} -> ${f.to}`;
        byMove[k] = (byMove[k] || 0) + 1;
      }

      const stuckAtThree = candidates.filter((f) => stepNumber(f.workflowStep) === 3).length;

      if (!apply) {
        return res.json({
          mode: 'preview',
          cutoff: cutoff.toISOString(),
          filesBeforeCutoff: candidates.length,
          wouldChange: planned.length,
          byMove,
          stuckAtThree,
          note: stuckAtThree > 0
            ? `${stuckAtThree} file(s) sit at step 3, which used to mean BOTH Invitation to Bid and Bid Collection. They cannot be told apart and are left alone.`
            : undefined,
          sample: planned.slice(0, 10).map((f) => ({
            id: f.id, name: f.originalName, from: f.from, to: f.to, uploadedAt: f.uploadedAt,
          })),
          howToApply: 'Re-send the same request with ?apply=1 once these numbers look right.',
        });
      }

      // Highest step FIRST (5->6 before 4->5) so a file moved in this pass is
      // never picked up again by the next mapping.
      let updated = 0;
      for (const from of Object.keys(STEP_REMAP).map(Number).sort((a, b) => b - a)) {
        const to = STEP_REMAP[from];
        const ids = planned.filter((f) => f.from === from).map((f) => f.id);
        if (ids.length === 0) continue;
        await db
          .update(projectFiles)
          .set({ workflowStep: String(to) })
          .where(and(
            lt(projectFiles.uploadedAt, cutoff),
            sql`${projectFiles.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`
          ));
        updated += ids.length;
        console.log(`[file-step-migration] ${ids.length} file(s) moved from step ${from} to ${to}`);
      }

      res.json({ mode: 'applied', cutoff: cutoff.toISOString(), updated, byMove, stuckAtThree });
    } catch (error) {
      console.error('[file-step-migration] failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Migration failed: ${message}` });
    }
  });
}
