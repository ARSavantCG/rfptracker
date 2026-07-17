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
import { readFileSync } from 'fs';
import mammoth from 'mammoth';
import { storage } from './storage';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, checkPermission } from './middleware';
import { resolveSecureFilePath } from './file-organization';

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

      // 1) Gather intake files for this RFP. Files can be stored under different
      // workflow-step labels depending on the RFP's phase when uploaded (e.g. a file
      // dropped while the RFP is in validation lands under "Step_2_Validation", not
      // "Step_1_Entry"). So gather ALL of the RFP's files and let the AI read the
      // intake material regardless of which step folder it landed in.
      const step1Files = await storage.getProjectFiles(rfpId);

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
      const extractedTexts: string[] = []; // text pulled from Word/email/txt files
      for (const f of step1Files) {
        if (filesIncluded >= MAX_FILES) { skipped.push(f.originalName); continue; }
        const mime = f.mimeType || "";
        const nameLower = (f.originalName || "").toLowerCase();
        const isPdf = mime === PDF_MIME || nameLower.endsWith(".pdf");
        const isImage = IMAGE_MIMES.includes(mime) || /\.(jpe?g|png|gif|webp)$/.test(nameLower);
        const isWord = mime.includes("word") || mime.includes("officedocument.wordprocessing") || nameLower.endsWith(".docx");
        const isText = mime.startsWith("text/") || /\.(txt|eml|md|csv|html?)$/.test(nameLower);

        try {
          const fullPath = resolveSecureFilePath(f.filePath, process.cwd());
          if (!fullPath) { skipped.push(f.originalName); continue; }

          if (isPdf) {
            const base64 = readFileSync(fullPath).toString('base64');
            content.push({
              type: 'document',
              source: { type: 'base64', media_type: PDF_MIME, data: base64 },
              title: f.originalName,
            });
            filesIncluded++;
          } else if (isImage) {
            const base64 = readFileSync(fullPath).toString('base64');
            const mediaType = mime && IMAGE_MIMES.includes(mime) ? mime : 'image/png';
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            });
            filesIncluded++;
          } else if (isWord) {
            // Extract text from .docx via mammoth.
            const result = await mammoth.extractRawText({ path: fullPath });
            const txt = (result?.value || "").trim();
            if (txt) {
              extractedTexts.push(`--- ${f.originalName} (Word document) ---\n${txt}`);
              filesIncluded++;
            } else {
              skipped.push(f.originalName);
            }
          } else if (isText) {
            // Emails (.eml), plain text, etc. — read directly.
            const txt = readFileSync(fullPath, 'utf-8').trim();
            if (txt) {
              extractedTexts.push(`--- ${f.originalName} ---\n${txt.slice(0, 20000)}`);
              filesIncluded++;
            } else {
              skipped.push(f.originalName);
            }
          } else {
            skipped.push(f.originalName);
          }
        } catch (err) {
          console.error(`Intake parser: failed to read ${f.originalName}:`, (err as Error).message);
          skipped.push(f.originalName);
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
