/**
 * AI bid extraction — the fallback for PDFs the heuristic parser cannot handle.
 *
 * WHY THIS EXISTS (measured against two real bids, 2026-08-05):
 *
 *   Nova Construction's ROM parses fine heuristically. Every row is one line:
 *     "1 New Cooler Buildout $760,000 8,000 SF $95.00"
 *   Description, total, quantity, unit, and unit price all travel together.
 *
 *   Excel Construction's BID DETAIL cannot be parsed by ANY line-based approach.
 *   Its PDF text layer emits the description/location/qty column as one block and
 *   the RATE/PRICE column as a separate block ~85 lines later:
 *
 *     line  33 | PIT LEVELER CONCRETE WORK   WAREHOUSE   8.00 EA
 *     ...
 *     line 118 | 7,200.00   57,600.00
 *
 *   One description was even detached from its own quantity row. No regex can
 *   rejoin columns the extractor has already torn apart — but a model reading the
 *   whole page can, because it can reason about ordering and count alignment.
 *
 * So: heuristic first (free, instant, deterministic), AI only when the heuristic
 * comes back weak. Most bids never reach this file.
 *
 * NOTHING HERE WRITES TO THE DATABASE. It returns candidate rows for the human
 * review step. On money data, a wrong line that arrives silently is worse than a
 * parse that fails loudly.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface AiLineItem {
  division: string | null;
  description: string;
  location: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  /** true when the row is a subtotal/total rather than a priced scope line. */
  isSubtotal: boolean;
  /** Model's own confidence that this row was read correctly, 0-1. */
  confidence: number;
}

export interface AiExtractionResult {
  success: boolean;
  lineItems: AiLineItem[];
  contractorName: string | null;
  projectName: string | null;
  bidDate: string | null;
  grandTotal: number | null;
  /** Anything the model could not resolve — shown to the reviewer, not swallowed. */
  warnings: string[];
  error?: string;
}

const SYSTEM_PROMPT = `You extract line items from construction bid PDFs for a commercial real estate tenant-improvement estimating system.

The text you receive comes from a PDF text layer and MAY HAVE COLUMNS TORN APART. It is common for a description/quantity block to appear far away from its matching rate/price block. When that happens, realign them by order and by count: the Nth description in a division corresponds to the Nth price in that division's price block. Use division subtotals to check your alignment — the line items under a division should sum to its subtotal.

Rules:
- Extract only real scope line items and clearly-labelled subtotals. Ignore headers, addresses, phone numbers, page furniture, and boilerplate.
- Set isSubtotal true for any row that is a division subtotal, section subtotal, or grand total.
- Preserve the description EXACTLY as written. Do not tidy, expand, or correct it.
- quantity, unitPrice, and totalPrice must be plain numbers with no currency symbols, commas, or units. Use null when a value is genuinely absent.
- Non-numeric price cells such as "Not Included", "By Tenant", "In Above", "Not Applicable" mean there is NO price. Set totalPrice null and put the phrase in the description if it is not already there. NEVER convert these to 0 — a zero is a quoted price of nothing, an absence is not a quote.
- confidence: 1.0 when a row was read intact from a single line; lower it when you had to realign columns across blocks or infer a value. Be honest — a low score routes the row to a human, which is the desired outcome.
- If a division's line items do not sum to its stated subtotal, still return the rows, and add a warning naming the division and both figures.

Return ONLY a JSON object, no preamble and no markdown fences:
{"contractorName":string|null,"projectName":string|null,"bidDate":string|null,"grandTotal":number|null,"warnings":string[],"lineItems":[{"division":string|null,"description":string,"location":string|null,"quantity":number|null,"unit":string|null,"unitPrice":number|null,"totalPrice":number|null,"isSubtotal":boolean,"confidence":number}]}`;

export async function extractBidLineItemsWithAi(rawText: string): Promise<AiExtractionResult> {
  const empty: AiExtractionResult = {
    success: false, lineItems: [], contractorName: null,
    projectName: null, bidDate: null, grandTotal: null, warnings: [],
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...empty, error: 'ANTHROPIC_API_KEY is not configured — AI bid extraction is unavailable.' };
  }
  if (!rawText || rawText.trim().length < 50) {
    return {
      ...empty,
      error: 'The PDF contains almost no extractable text. It is most likely a scan; AI extraction of scanned bids requires page images, which this path does not yet support.',
    };
  }

  // Guard the request size. Bid packages run to dozens of pages, most of which is
  // work letters and drawings rather than pricing.
  const MAX_CHARS = 120_000;
  const text = rawText.length > MAX_CHARS ? rawText.slice(0, MAX_CHARS) : rawText;
  const truncated = rawText.length > MAX_CHARS;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Extract the bid line items from this PDF text:\n\n${text}` }],
    });

    const block = response.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') {
      return { ...empty, error: 'Model returned no text content.' };
    }

    // Strip fences defensively — the prompt forbids them, but a parse failure here
    // would discard an otherwise good extraction.
    const cleaned = block.text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return { ...empty, error: 'Model response did not contain a JSON object.' };
    }

    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
    const warnings: string[] = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    if (truncated) {
      warnings.unshift(`PDF text exceeded ${MAX_CHARS.toLocaleString()} characters and was truncated — later pages were not read.`);
    }

    const num = (v: any): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    };

    const lineItems: AiLineItem[] = (Array.isArray(parsed.lineItems) ? parsed.lineItems : [])
      .filter((r: any) => r && typeof r.description === 'string' && r.description.trim())
      .map((r: any) => ({
        division: r.division ?? null,
        description: String(r.description).trim(),
        location: r.location ?? null,
        quantity: num(r.quantity),
        unit: r.unit ? String(r.unit).trim() : null,
        unitPrice: num(r.unitPrice),
        totalPrice: num(r.totalPrice),
        isSubtotal: !!r.isSubtotal,
        confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
      }));

    return {
      success: true,
      lineItems,
      contractorName: parsed.contractorName ?? null,
      projectName: parsed.projectName ?? null,
      bidDate: parsed.bidDate ?? null,
      grandTotal: num(parsed.grandTotal),
      warnings,
    };
  } catch (error) {
    console.error('[ai-bid-extractor] failed:', error);
    return { ...empty, error: error instanceof Error ? error.message : 'AI extraction failed' };
  }
}

/**
 * Should the heuristic result be handed to the AI?
 *
 * Deliberately conservative: the heuristic is free and instant, so it only falls
 * through when its output is actually poor. The Excel bid trips the "rows without
 * prices" test — it yields plenty of descriptions and quantities and almost no
 * prices, which is precisely the torn-column signature.
 */
export function shouldUseAiFallback(heuristic: {
  rowCount: number;
  rowsWithPrice: number;
  averageConfidence: number;
}): { use: boolean; reason: string } {
  const { rowCount, rowsWithPrice, averageConfidence } = heuristic;

  if (rowCount === 0) {
    return { use: true, reason: 'Heuristic parsing found no table rows.' };
  }
  const pricedRatio = rowsWithPrice / rowCount;
  if (pricedRatio < 0.5) {
    return {
      use: true,
      reason: `Only ${rowsWithPrice} of ${rowCount} rows had a price — the price column was probably separated from the descriptions in the PDF text layer.`,
    };
  }
  if (averageConfidence < 0.6) {
    return { use: true, reason: `Low average row confidence (${averageConfidence.toFixed(2)}).` };
  }
  return { use: false, reason: 'Heuristic parsing produced a clean table.' };
}
