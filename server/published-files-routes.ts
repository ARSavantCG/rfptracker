/**
 * Published files — one internal link per RFP.
 *
 * A page listing the files that belong to the published deliverable, so the link
 * can be pasted into a message rather than telling someone to open the app,
 * find the RFP, and download everything including working files.
 *
 * INTERNAL ONLY. Behind requireAuthFlexible, which accepts a Bearer token or a
 * ?token= query string - the same gate the printable reports use. It is not a
 * public URL and is not safe to send outside the company: anyone with a valid
 * token can open it. An external version needs signed, expiring, per-RFP tokens,
 * which is a different job.
 */
import type { Express } from 'express';
import { db } from './db';
import { projectFiles, rfpRequests, properties } from '@shared/schema';
import { eq, asc } from 'drizzle-orm';
import { requireAuthFlexible } from './middleware';
import { getBrandLogo as getBridgeLogo, BRAND_COLOR_PRIMARY, COMPANY_NAME } from './lib/branding';
import { formatBusinessDate } from '@shared/date-utils';

function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtSize(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b === 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which steps count as "published".
 *
 * Step 6 is the publish step itself, but the deliverable is rarely only what was
 * uploaded there - the priced evaluation from step 5 is usually part of what gets
 * sent. Both are included, labelled by origin so the reader can tell them apart.
 * Steps 1-4 are intake and working files and are excluded.
 */
const PUBLISHED_STEPS = [5, 6];

const STEP_LABELS: Record<number, string> = {
  5: 'Evaluation',
  6: 'Published',
};

export function registerPublishedFilesRoutes(app: Express) {
  app.get('/api/rfp-requests/:id/published-files', requireAuthFlexible, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      if (isNaN(rfpId)) return res.status(400).json({ message: 'Invalid RFP id' });

      const [rfp] = await db
        .select({
          id: rfpRequests.id,
          rfpNumber: rfpRequests.rfpNumber,
          projectName: rfpRequests.projectName,
          tenantName: rfpRequests.tenantName,
          propertyRef: rfpRequests.property,
          publishedDate: rfpRequests.publishedDate,
          publishedBy: rfpRequests.publishedBy,
        })
        .from(rfpRequests)
        .where(eq(rfpRequests.id, rfpId));

      if (!rfp) return res.status(404).json({ message: 'RFP not found' });

      // Project only what is needed: a bare select on this table throws outright
      // if any column has drifted, taking the page with it.
      const allFiles = await db
        .select({
          id: projectFiles.id,
          originalName: projectFiles.originalName,
          fileSize: projectFiles.fileSize,
          workflowStep: projectFiles.workflowStep,
          uploadedAt: projectFiles.uploadedAt,
        })
        .from(projectFiles)
        .where(eq(projectFiles.projectId, rfpId))
        .orderBy(asc(projectFiles.workflowStep), asc(projectFiles.originalName));

      // workflowStep is TEXT and has been written both as "6" and "Step_6_Publish".
      // Normalise before comparing rather than matching either spelling.
      const stepNumber = (raw: string | null): number => {
        const s = String(raw ?? '').trim();
        const m = s.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : NaN;
      };

      const files = allFiles
        .map(f => ({ ...f, step: stepNumber(f.workflowStep) }))
        .filter(f => PUBLISHED_STEPS.includes(f.step));

      // Property name resolved in JS: rfp_requests.property is text, properties.id
      // is serial, and Postgres rejects that join.
      let propertyLabel = '—';
      if (rfp.propertyRef) {
        const props = await db
          .select({ id: properties.id, propertyName: properties.propertyName, building: properties.building })
          .from(properties);
        const match = props.find(p => String(p.id) === String(rfp.propertyRef).trim());
        if (match) {
          propertyLabel = match.building
            ? `${match.propertyName} - Bldg. ${match.building}`
            : match.propertyName;
        }
      }

      if (req.query.format === 'json') {
        return res.json({ rfp, propertyLabel, files });
      }

      const heading = [rfp.projectName, rfp.tenantName].filter(Boolean).join(' — ');
      const rows = files.map(f => `
        <tr>
          <td><a href="/api/project-files/${f.id}/download">${escapeHtml(f.originalName)}</a></td>
          <td class="step">${escapeHtml(STEP_LABELS[f.step] || `Step ${f.step}`)}</td>
          <td class="size">${fmtSize(f.fileSize)}</td>
          <td class="date">${formatBusinessDate(f.uploadedAt)}</td>
        </tr>`).join('');

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Published Files — ${escapeHtml(rfp.rfpNumber || '')}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; margin: 24px; color: #222; font-size: 13px; max-width: 900px; }
  .document-title { font-size: 22px; font-weight: bold; background: ${BRAND_COLOR_PRIMARY}; color: #fff; padding: 10px; border-radius: 5px; text-align: center; }
  .report-subtitle { text-align: center; color: #666; font-size: 12px; margin-top: 4px; }
  .meta { margin-top: 14px; font-size: 12px; color: #444; }
  .meta strong { color: #222; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th { background: #eef2f9; text-align: left; padding: 6px; border: 1px solid #ccc; font-size: 12px; }
  td { padding: 6px; border: 1px solid #ddd; }
  td a { color: ${BRAND_COLOR_PRIMARY}; text-decoration: none; font-weight: 600; }
  td a:hover { text-decoration: underline; }
  .step, .size, .date { color: #666; white-space: nowrap; }
  .empty { padding: 20px; background: #fff8e1; border: 1px solid #ffe082; border-radius: 5px; margin-top: 14px; }
  .internal { margin-top: 18px; padding: 8px 10px; background: #f1f5f9; border-radius: 4px; font-size: 11px; color: #475569; }
</style></head><body>
  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
    <img src="${getBridgeLogo()}" alt="${COMPANY_NAME}" style="height: 30px; width: auto;" />
    <div style="font-size: 12px; color: #999;">${formatBusinessDate(new Date())}</div>
  </div>
  <div class="document-title">Published Files</div>
  <div class="report-subtitle">${escapeHtml(heading)}</div>

  <div class="meta">
    <div><strong>${escapeHtml(rfp.rfpNumber || '')}</strong> · ${escapeHtml(propertyLabel)}</div>
    ${rfp.publishedDate
      ? `<div>Published ${formatBusinessDate(rfp.publishedDate)}${rfp.publishedBy ? ` by ${escapeHtml(rfp.publishedBy)}` : ''}</div>`
      : '<div>Not yet published.</div>'}
  </div>

  ${files.length === 0
    ? `<div class="empty">
         No files are attached to the evaluation or publish steps of this RFP. Intake and
         working files from earlier steps are deliberately not listed here.
       </div>`
    : `<table>
         <thead><tr><th>File</th><th>From</th><th>Size</th><th>Uploaded</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>`}

  <div class="internal">
    <strong>Internal link.</strong> Anyone signed in can open this. It is not safe to send
    outside the company — external sharing needs a per-recipient expiring link.
  </div>
</body></html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error('[published-files] failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Failed to load published files: ${message}` });
    }
  });
}
