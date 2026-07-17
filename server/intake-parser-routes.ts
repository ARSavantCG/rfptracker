/**
 * RFP Tracker - AI Intake Parser Routes
 *
 * Reads Step-1 intake (uploaded files + typed text) for an RFP, applies the
 * admin-curated scope inference rules, and proposes scope items (stored as
 * intake_proposals) for the dev team to review in Step 2.
 *
 * Follows the proven ai-routes.ts pattern (Anthropic SDK, claude-sonnet-4-5,
 * JSON-only response, admin-gated). See DESIGN-ai-intake-parser.md.
 */
import type { Express } from 'express';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { storage } from './storage';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, checkPermission } from './middleware';
import { resolveSecureFilePath, getSecureDownloadPath } from './file-organization';
import { downloadFromObjectStorage } from './storage-backup';

// Claude supports these natively as document/image blocks.
const PDF_MIME = 'application/pdf';
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// Cap how much file content we send, to bound token cost.
const MAX_FILES = 8;

export function registerIntakeParserRoutes(app: Express): void {
  // ---- Scope Inference Rules (admin-curated knowledge base) ----
  app.get("/api/inference-rules", requireAuth, async (_req, res) => {
    try {
      const rules = await storage.getAllInferenceRules();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch inference rules" });
    }
  });

  app.post("/api/inference-rules", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const rule = await storage.createInferenceRule(req.body);
      res.status(201).json(rule);
    } catch (error: any) {
      res.status(400).json({ message: "Invalid rule data", error: error?.message });
    }
  });

  app.put("/api/inference-rules/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const rule = await storage.updateInferenceRule(id, req.body);
      if (!rule) return res.status(404).json({ message: "Rule not found" });
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update rule", error: error?.message });
    }
  });

  app.delete("/api/inference-rules/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const deleted = await storage.deleteInferenceRule(id);
      if (!deleted) return res.status(404).json({ message: "Rule not found" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete rule" });
    }
  });

  // Parse Step-1 intake for an RFP and produce proposals.
  // Body may include { typedText?: string } for free-typed description input.
  app.post("/api/ai/intake-parse/:rfpId", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ message: "AI is not configured (missing API key)." });
      }

      const typedText: string = (req.body?.typedText || "").toString();

      // 1) Gather intake files for this RFP from ALL sources. Files can live in:
      //   (a) the project_files table (getProjectFiles), OR
      //   (b) JSON arrays on the RFP record itself: files / additionalDocuments /
      //       (attachments). The Step-1 drop stores into the RFP's `files` array, so
      //       querying only project_files missed them entirely (0 files read).
      // Normalize everything into { originalName, filePath, mimeType }.
      const projectFileRows = await storage.getProjectFiles(rfpId);
      const rfp = await storage.getRfpRequest(rfpId);

      type IntakeFile = { originalName: string; filePath: string; mimeType: string };
      const gathered: IntakeFile[] = [];

      for (const f of projectFileRows) {
        if (f.filePath) gathered.push({ originalName: f.originalName, filePath: f.filePath, mimeType: f.mimeType || "" });
      }
      const jsonArrays = [
        (rfp as any)?.files,
        (rfp as any)?.additionalDocuments,
        (rfp as any)?.attachments,
      ];
      for (const arr of jsonArrays) {
        if (Array.isArray(arr)) {
          for (const rf of arr) {
            const p = rf?.path;
            if (p) gathered.push({ originalName: rf.name || "file", filePath: p, mimeType: rf.type || "" });
          }
        }
      }
      // Dedupe by filePath.
      const seenPaths = new Set<string>();
      const step1Files = gathered.filter((f) => {
        if (seenPaths.has(f.filePath)) return false;
        seenPaths.add(f.filePath);
        return true;
      });

      // 2) Load the active inference rules (the editable knowledge base).
      const rules = await storage.getActiveInferenceRules();

      // 3) Load the catalog (names + categories) so Claude can catalog-match.
      const catalog = await storage.getAllRomScopeItems();
      const catalogForPrompt = catalog.map((c) => ({ id: c.id, name: c.name, category: c.category }));

      // 4) Build the message content: typed text + readable files (PDF/image as blocks).
      const content: any[] = [];

      const rulesText = rules.length
        ? rules.map((r) => `- IF ${r.triggerType} "${r.triggerValue}" THEN propose: ${r.impliedScope}`).join("\n")
        : "(no custom rules yet — use general CRE construction judgment)";

      let filesIncluded = 0;
      const skipped: string[] = [];
      const skipReasons: string[] = [];
      const extractedTexts: string[] = []; // text pulled from Word/email/txt files
      for (const f of step1Files) {
        if (filesIncluded >= MAX_FILES) { skipped.push(f.originalName); skipReasons.push(`${f.originalName}: max files reached`); continue; }
        const mime = f.mimeType || "";
        const nameLower = (f.originalName || "").toLowerCase();
        const isPdf = mime === PDF_MIME || nameLower.endsWith(".pdf");
        const isImage = IMAGE_MIMES.includes(mime) || /\.(jpe?g|png|gif|webp)$/.test(nameLower);
        const isWord = mime.includes("word") || mime.includes("officedocument.wordprocessing") || nameLower.endsWith(".docx") || nameLower.endsWith(".doc");
        const isText = mime.startsWith("text/") || /\.(txt|eml|md|csv|html?)$/.test(nameLower);

        try {
          // Mirror the WORKING /uploads/* file server's resolution exactly
          // (server/routes.ts). filePath here looks like
          // "uploads/projects/<folder>/Step_1_Entry/<file>".
          let buf: Buffer | null = null;
          const bare = f.filePath.split('/').pop() || f.filePath;
          const localCandidates = [
            path.join(process.cwd(), f.filePath),                        // full nested path
            path.join(process.cwd(), 'uploads', bare),                   // bare under uploads/
            path.join(process.cwd(), 'uploads', 'projects', bare),       // bare under uploads/projects/
          ];
          for (const p of localCandidates) {
            let ok = false;
            try { ok = existsSync(p); } catch { ok = false; }
            console.log(`[intake-parser] candidate: ${p} exists=${ok}`);
            if (ok) { buf = readFileSync(p); break; }
          }
          // Fall back to Object Storage (same as the working server: bare filename,
          // plus try the full path as urlPath in case it's keyed by full path).
          if (!buf) {
            // Diagnostic: list what actually exists in the file's directory on disk.
            try {
              const dir = path.dirname(path.join(process.cwd(), f.filePath));
              const { readdirSync } = await import('fs');
              const entries = existsSync(dir) ? readdirSync(dir) : ['(dir does not exist)'];
              console.log(`[intake-parser] dir ${dir} contains:`, entries);
            } catch (e) {
              console.log(`[intake-parser] could not list dir:`, (e as Error).message);
            }
            buf = await downloadFromObjectStorage(bare, f.filePath);
          }
          if (!buf) {
            skipped.push(f.originalName);
            skipReasons.push(`${f.originalName}: not found on disk or object storage (path: ${f.filePath})`);
            continue;
          }

          if (isPdf) {
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: PDF_MIME, data: buf.toString('base64') },
              title: f.originalName,
            });
            filesIncluded++;
          } else if (isImage) {
            const mediaType = mime && IMAGE_MIMES.includes(mime) ? mime : 'image/png';
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
            });
            filesIncluded++;
          } else if (isWord) {
            const result = await mammoth.extractRawText({ buffer: buf });
            const txt = (result?.value || "").trim();
            if (txt) {
              extractedTexts.push(`--- ${f.originalName} (Word document) ---\n${txt}`);
              filesIncluded++;
            } else {
              skipped.push(f.originalName);
              skipReasons.push(`${f.originalName}: Word doc had no extractable text`);
            }
          } else if (nameLower.endsWith(".msg")) {
            try {
              const { default: MsgReader } = await import('@kenjiuno/msgreader');
              const reader = new (MsgReader as any)(buf);
              const data = reader.getFileData();
              const body = (data?.body || data?.bodyHTML || "").toString().trim();
              const subject = (data?.subject || "").toString();
              const combined = `${subject ? `Subject: ${subject}\n` : ""}${body}`.trim();
              if (combined) {
                extractedTexts.push(`--- ${f.originalName} (email) ---\n${combined.slice(0, 20000)}`);
                filesIncluded++;
              } else {
                skipped.push(f.originalName);
                skipReasons.push(`${f.originalName}: .msg had no readable body`);
              }
            } catch (msgErr) {
              skipped.push(f.originalName);
              skipReasons.push(`${f.originalName}: .msg parse failed (${(msgErr as Error).message})`);
            }
          } else if (isText) {
            const txt = buf.toString('utf-8').trim();
            if (txt) {
              extractedTexts.push(`--- ${f.originalName} ---\n${txt.slice(0, 20000)}`);
              filesIncluded++;
            } else {
              skipped.push(f.originalName);
              skipReasons.push(`${f.originalName}: text file was empty`);
            }
          } else {
            skipped.push(f.originalName);
            skipReasons.push(`${f.originalName}: unsupported type (mime="${mime}")`);
          }
        } catch (err) {
          console.error(`Intake parser: failed to read ${f.originalName}:`, (err as Error).message);
          skipped.push(f.originalName);
          skipReasons.push(`${f.originalName}: read error (${(err as Error).message})`);
        }
      }

      // The instruction block (always last, after the documents).
      content.push({
        type: 'text',
        text:
`You are a commercial real estate construction scope analyst for industrial tenant-improvement projects.

Apply these scope inference rules (curated by the dev team):
${rulesText}

Also scan for ANY construction-related scope in the material: office buildout, electrical/power, HVAC/air conditioning, plumbing, parking, dock levelers/dock packages, demising walls, fire alarm, fire sprinkler, lighting, and similar. Note any tenant desired occupancy/delivery date (it can drive overtime/feasibility).

Here is the ROM catalog you can match against (id, name, category):
${JSON.stringify(catalogForPrompt)}

${typedText ? `Typed description from the team:\n"""${typedText}"""\n` : ""}${extractedTexts.length ? `\nText extracted from attached documents:\n${extractedTexts.join("\n\n")}\n` : ""}${filesIncluded ? `There are ${filesIncluded} attached/extracted document(s) — read them all.` : "(No readable files attached; work from the typed description and rules.)"}

Propose scope items. Respond with VALID JSON ONLY (no markdown, no prose outside JSON), exactly:
{
  "proposals": [
    {
      "description": "short scope item name",
      "catalogItemId": <number or null>,   // the catalog id if you are confident it matches one, else null
      "matchType": "catalog-match" | "needs-mapping",
      "confidence": "high" | "medium" | "low",
      "reason": "why proposed (cite the trigger, e.g. 'RFP is for suite 200 only → demising wall')",
      "sourceRef": "which file or 'typed text' this came from"
    }
  ]
}
If you cannot find any scope, return {"proposals": []}.`
      });

      // 5) Call Claude.
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2048,
        system: "You are a precise CRE construction scope analyst. Respond with valid JSON only.",
        messages: [{ role: "user", content }],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      let parsed: any;
      try {
        const clean = text.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch (e) {
        console.error("Intake parser: failed to parse Claude JSON:", text.substring(0, 400));
        return res.status(502).json({ message: "AI returned an unreadable response. Try again." });
      }

      const proposals = Array.isArray(parsed?.proposals) ? parsed.proposals : [];

      // 6) Replace any prior proposals for this RFP, then store the new ones.
      await storage.deleteIntakeProposalsForRfp(rfpId);
      const stored = [];
      for (const p of proposals) {
        // Validate catalogItemId actually exists; else force needs-mapping.
        let catalogItemId: number | null = null;
        if (typeof p.catalogItemId === 'number' && catalog.some((c) => c.id === p.catalogItemId)) {
          catalogItemId = p.catalogItemId;
        }
        const created = await storage.createIntakeProposal({
          rfpId,
          description: (p.description || "Untitled scope").toString().slice(0, 500),
          catalogItemId,
          matchType: catalogItemId ? "catalog-match" : "needs-mapping",
          confidence: (p.confidence || "medium").toString(),
          reason: (p.reason || "").toString().slice(0, 1000),
          sourceRef: (p.sourceRef || "").toString().slice(0, 300),
          status: "proposed",
        } as any);
        stored.push(created);
      }

      res.json({
        proposals: stored,
        meta: {
          filesIncluded,
          skipped,
          rulesApplied: rules.length,
          totalFilesFound: step1Files.length,
          fileNames: step1Files.map((f) => f.originalName),
          skipReasons,
        },
      });
    } catch (error: any) {
      console.error("Intake parse error:", error);
      res.status(500).json({ message: "Failed to parse intake", error: error?.message });
    }
  });

  // Read proposals for an RFP (Step 2 review panel).
  app.get("/api/intake-proposals/:rfpId", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) return res.status(400).json({ message: "Invalid RFP ID" });
      const proposals = await storage.getIntakeProposals(rfpId);
      res.json(proposals);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch proposals" });
    }
  });

  // Update a proposal's status (accept / reject / edited).
  app.patch("/api/intake-proposals/:id/status", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
      const status = (req.body?.status || "").toString();
      if (!["proposed", "accepted", "rejected", "edited"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const updated = await storage.updateIntakeProposalStatus(id, status);
      if (!updated) return res.status(404).json({ message: "Proposal not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update proposal" });
    }
  });
}
