/**
 * RFP Tracker - AI Analysis Routes
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */
import type { Express } from 'express';
import { storage } from './storage';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth, checkPermission } from './middleware';

export function registerAiRoutes(app: Express): void {
  app.post("/api/ai/analyze-bid/:bidCollectionId", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const bidCollectionId = parseInt(req.params.bidCollectionId);
      if (isNaN(bidCollectionId)) {
        return res.status(400).json({ message: "Invalid bid collection ID" });
      }

      console.log('Anthropic API key present:', !!process.env.ANTHROPIC_API_KEY);
      console.log('Bid collection ID requested:', bidCollectionId);

      const bidCollection = await storage.getBidCollection(bidCollectionId);
      if (!bidCollection) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      const lineItems = await storage.getBidLineItemsByBid(bidCollectionId);
      if (!lineItems) {
        return res.status(404).json({ message: "Bid line items not found" });
      }

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const simplifiedItems = lineItems.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      }));

      const totalAmount = lineItems.reduce((sum: number, item: any) => sum + (Number(item.totalPrice) || 0), 0);

      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: "You are a commercial construction cost analyst specializing in tenant improvement projects for industrial real estate. You review contractor bid line items and identify anomalies, red flags, and missing items. Always respond with valid JSON only — no markdown, no explanation outside the JSON.",
        messages: [
          {
            role: "user",
            content: `Analyze these bid line items for a commercial tenant improvement project. Contractor: ${bidCollection.contractorCompany}. Total bid: ${totalAmount}. Line items: ${JSON.stringify(simplifiedItems)}. Return a JSON object with exactly these fields: { anomalies: [ { lineItemDescription: string, issue: string, severity: 'low' | 'medium' | 'high' } ], missing: [ { description: string, reason: string } ], summary: string }`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      /**
       * Claude is asked for raw JSON, but models frequently wrap it in markdown
       * code fences (```json ... ```) or add a sentence before/after. Calling
       * JSON.parse() on the raw text then throws and the user just sees
       * "Analysis failed" with no clue why. Normalize before parsing:
       *   1. strip code fences
       *   2. fall back to extracting the outermost {...} block
       */
      const extractJson = (raw: string): string => {
        let s = raw.trim();
        // ```json ... ```  or  ``` ... ```
        const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced) s = fenced[1].trim();
        if (s.startsWith('{')) return s;
        // Last resort: grab the outermost object in the response.
        const first = s.indexOf('{');
        const last = s.lastIndexOf('}');
        if (first !== -1 && last > first) return s.slice(first, last + 1);
        return s;
      };

      let analysis;
      try {
        analysis = JSON.parse(extractJson(text));
      } catch (parseError: any) {
        console.error('AI analyze: could not parse model response as JSON:', parseError.message);
        console.error('AI analyze: raw response was:', text.slice(0, 1000));
        return res.status(502).json({
          message: "Analysis failed",
          error: "The AI returned a response that could not be read as JSON.",
          detail: text.slice(0, 300),
        });
      }
      res.json(analysis);
    } catch (error: any) {
      // Surface *why* it failed instead of a blanket "Analysis failed".
      console.error("AI bid analysis error:", error);
      const status = error?.status ?? error?.response?.status;
      let hint = error?.message || "Unknown error";
      if (!process.env.ANTHROPIC_API_KEY) {
        hint = "ANTHROPIC_API_KEY is not set on the server.";
      } else if (status === 401) {
        hint = "The Anthropic API key was rejected (401). It may be invalid or revoked.";
      } else if (status === 404) {
        hint = `The model was not found (404). Check the model ID.`;
      } else if (status === 429) {
        hint = "Rate limited by the Anthropic API (429). Try again shortly.";
      }
      res.status(500).json({ message: "Analysis failed", error: hint });
    }
  });
}
