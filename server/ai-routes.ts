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
      const analysis = JSON.parse(text);
      res.json(analysis);
    } catch (error: any) {
      console.error("AI bid analysis error:", error);
      res.status(500).json({ message: "Analysis failed", error: error.message });
    }
  });
}
