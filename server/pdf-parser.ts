import { PDFParse } from 'pdf-parse';
import fs from 'fs';
import path from 'path';

export interface ParsedCell {
  text: string;
  x: number;
  y: number;
  width?: number;
}

export interface ParsedRow {
  cells: string[];
  rowIndex: number;
  confidence: number;
}

export interface ParsedTable {
  headers: string[];
  rows: ParsedRow[];
  rawText: string;
  detectedColumns: number;
  headerSignature?: string;
}

export interface ParsedPdfResult {
  success: boolean;
  tables: ParsedTable[];
  rawText: string;
  pageCount: number;
  error?: string;
  extractionMethod: 'layout' | 'text' | 'fallback';
}

const HEADER_KEYWORDS = [
  'description', 'desc', 'item', 'scope', 'work',
  'qty', 'quantity', 'quan',
  'unit', 'uom', 'u/m',
  'price', 'cost', 'rate', 'amount',
  'total', 'subtotal', 'ext', 'extended',
  'ea', 'sf', 'lf', 'ls', 'hr', 'day',
  'labor', 'material', 'materials'
];

const PRICE_PATTERNS = [
  /^\$[\d,]+\.?\d*$/,
  /^[\d,]+\.\d{2}$/,
  /^\(?\$?[\d,]+\.?\d*\)?$/,
];

const QUANTITY_PATTERNS = [
  /^\d+$/,
  /^\d+\.\d+$/,
  /^[\d,]+$/,
];

const UNIT_PATTERNS = [
  /^(ea|sf|lf|ls|hr|day|wk|mo|cy|sy|cf|gal|lb|ton|each|sqft|lnft|lump\s*sum)$/i,
];

function isLikelyPrice(text: string): boolean {
  const cleaned = text.trim();
  return PRICE_PATTERNS.some(p => p.test(cleaned)) || 
         (cleaned.includes('$') && /\d/.test(cleaned));
}

function isLikelyQuantity(text: string): boolean {
  const cleaned = text.trim().replace(/,/g, '');
  return QUANTITY_PATTERNS.some(p => p.test(cleaned)) && !cleaned.includes('$');
}

function isLikelyUnit(text: string): boolean {
  const cleaned = text.trim().toLowerCase();
  return UNIT_PATTERNS.some(p => p.test(cleaned));
}

function isLikelyHeader(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return HEADER_KEYWORDS.some(kw => lower.includes(kw));
}

function splitIntoColumns(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let spaces = 0;
  
  for (const char of line) {
    if (char === ' ' || char === '\t') {
      spaces++;
      if (spaces >= 2 && current.trim()) {
        parts.push(current.trim());
        current = '';
        spaces = 0;
      } else {
        current += char;
      }
    } else {
      spaces = 0;
      current += char;
    }
  }
  
  if (current.trim()) {
    parts.push(current.trim());
  }
  
  return parts.filter(p => p.length > 0);
}

function detectColumnBoundaries(rows: string[][]): number[] {
  if (rows.length === 0) return [];
  
  const maxCols = Math.max(...rows.map(r => r.length));
  const boundaries: number[] = [];
  
  for (let i = 0; i < maxCols; i++) {
    boundaries.push(i);
  }
  
  return boundaries;
}

function normalizeRow(row: string[], targetColumns: number): string[] {
  if (row.length === targetColumns) return row;
  if (row.length > targetColumns) return row.slice(0, targetColumns);
  
  const result = [...row];
  while (result.length < targetColumns) {
    result.push('');
  }
  return result;
}

function calculateRowConfidence(cells: string[]): number {
  let score = 0.5;
  
  const hasPrice = cells.some(c => isLikelyPrice(c));
  const hasQuantity = cells.some(c => isLikelyQuantity(c));
  const hasDescription = cells.some(c => c.length > 10 && !isLikelyPrice(c) && !isLikelyQuantity(c));
  
  if (hasPrice) score += 0.2;
  if (hasQuantity) score += 0.15;
  if (hasDescription) score += 0.15;
  
  const numericCount = cells.filter(c => /\d/.test(c)).length;
  if (numericCount >= 2) score += 0.1;
  
  return Math.min(1, score);
}

function createHeaderSignature(headers: string[]): string {
  return headers.map(h => h.toLowerCase().replace(/[^a-z]/g, '')).join('|');
}

// Patterns for cells that should never be treated as a valid description
const JUNK_DESC_PATTERNS = [
  /^\s*$/,                  // blank / whitespace only
  /^[\d,.\s]+$/,            // only digits, commas, dots, spaces (pure number)
  /^[\(\)\[\]\{\}\s]+$/,    // only parentheses / brackets
  /^\$[\d,.\s]+$/,          // dollar amount with no text (e.g. "$1,200")
];

// Exact (case-insensitive) phrases that are headers, not data
const JUNK_DESC_PHRASES = new Set([
  'qty unit', 'qty', 'quantity', 'unit', 'price', 'unit price',
  'shell area', 'other area', 'total area',
  'description', 'desc', 'item', 'scope',
  'total', 'subtotal', 'extended price', 'ext price',
  'labor', 'material', 'materials',
]);

function isJunkDescriptionCell(text: string): boolean {
  const t = text.trim();
  if (JUNK_DESC_PATTERNS.some(p => p.test(t))) return true;
  const lower = t.toLowerCase();
  if (JUNK_DESC_PHRASES.has(lower)) return true;
  // Multi-word header phrases (starts-with match for combos like "qty unit price total")
  for (const phrase of JUNK_DESC_PHRASES) {
    if (phrase.includes(' ') && lower.startsWith(phrase)) return true;
  }
  return false;
}

/** Returns true if the row should be discarded before showing the review screen */
function isJunkRow(cells: string[]): boolean {
  const desc = cells[0]?.trim() ?? '';
  return isJunkDescriptionCell(desc);
}

/** A "clean data row" has a real text description in cell[0] and at least one price-like cell */
function isCleanDataRow(cells: string[]): boolean {
  const desc = cells[0]?.trim() ?? '';
  if (!desc || isJunkDescriptionCell(desc)) return false;
  // Needs at least one other cell that looks numeric / price
  return cells.slice(1).some(c => isLikelyPrice(c) || isLikelyQuantity(c));
}

/**
 * Find the index (exclusive) at which the first contiguous clean block ends.
 * Once 3 consecutive non-clean rows appear after the block starts, we cut there.
 */
function findCleanBlockEnd(rows: string[][]): number {
  // Locate where the clean block begins
  let cleanStart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (isCleanDataRow(rows[i])) { cleanStart = i; break; }
  }
  if (cleanStart === -1) return rows.length; // nothing clean → keep all (no-op)

  let consecutiveNonClean = 0;
  let lastClean = cleanStart;

  for (let i = cleanStart; i < rows.length; i++) {
    if (isCleanDataRow(rows[i])) {
      consecutiveNonClean = 0;
      lastClean = i;
    } else {
      consecutiveNonClean++;
      if (consecutiveNonClean >= 3) {
        return lastClean + 1; // cut after the last confirmed clean row
      }
    }
  }
  return rows.length; // clean block runs to the end
}

function detectTableRows(text: string): { rows: ParsedRow[], headers: string[], signature: string } {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const allRows: string[][] = [];
  
  for (const line of lines) {
    const cells = splitIntoColumns(line);
    if (cells.length >= 2) {
      allRows.push(cells);
    }
  }
  
  if (allRows.length === 0) {
    return { rows: [], headers: [], signature: '' };
  }
  
  let headerIndex = -1;
  let headerScore = 0;
  
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i];
    const matchCount = row.filter(cell => isLikelyHeader(cell)).length;
    const score = matchCount / row.length;
    
    if (matchCount >= 2 && score > headerScore) {
      headerScore = score;
      headerIndex = i;
    }
  }
  
  let headers: string[];
  let dataStartIndex: number;
  
  if (headerIndex >= 0) {
    headers = allRows[headerIndex];
    dataStartIndex = headerIndex + 1;
  } else {
    const maxCols = Math.max(...allRows.map(r => r.length));
    headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
    dataStartIndex = 0;
  }
  
  const targetColumns = headers.length;
  const dataRows: ParsedRow[] = [];
  
  for (let i = dataStartIndex; i < allRows.length; i++) {
    const rawCells = allRows[i];
    const cells = normalizeRow(rawCells, targetColumns);
    const confidence = calculateRowConfidence(cells);
    
    const hasContent = cells.some(c => c.trim().length > 0);
    const isNotSubheader = !cells.every(c => isLikelyHeader(c));
    
    if (hasContent && isNotSubheader) {
      dataRows.push({
        cells,
        rowIndex: i,
        confidence
      });
    }
  }
  
  const signature = createHeaderSignature(headers);

  // --- Step 1: drop junk rows (blank desc, pure numbers, header phrases, only brackets) ---
  const noJunk = dataRows.filter(row => !isJunkRow(row.cells));

  // --- Step 2: "first clean table only" — cut at end of first contiguous block ---
  const blockEnd = findCleanBlockEnd(noJunk.map(r => r.cells));
  const finalRows = noJunk.slice(0, blockEnd);

  return { rows: finalRows, headers, signature };
}

function detectTables(text: string): ParsedTable[] {
  const { rows, headers, signature } = detectTableRows(text);
  
  if (rows.length === 0) {
    return [];
  }
  
  return [{
    headers,
    rows,
    rawText: text,
    detectedColumns: headers.length,
    headerSignature: signature
  }];
}

function autoDetectMapping(headers: string[]): MappingConfig {
  const mapping: MappingConfig = {};
  const lowerHeaders = headers.map(h => h.toLowerCase());
  
  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    
    if (mapping.description === undefined) {
      if (h.includes('desc') || h.includes('item') || h.includes('scope') || h.includes('work')) {
        mapping.description = i;
        continue;
      }
    }
    
    if (mapping.quantity === undefined) {
      if (h.includes('qty') || h.includes('quantity') || h.includes('quan') || h === 'q') {
        mapping.quantity = i;
        continue;
      }
    }
    
    if (mapping.unit === undefined) {
      if (h.includes('unit') || h.includes('uom') || h.includes('u/m') || h === 'um') {
        mapping.unit = i;
        continue;
      }
    }
    
    if (mapping.unitPrice === undefined) {
      if ((h.includes('unit') && h.includes('price')) || h.includes('rate') || h === 'price' || h.includes('u/p')) {
        mapping.unitPrice = i;
        continue;
      }
    }
    
    if (mapping.totalPrice === undefined) {
      if (h.includes('total') || h.includes('ext') || h.includes('amount') || h.includes('subtotal')) {
        mapping.totalPrice = i;
        continue;
      }
    }
  }
  
  if (mapping.unitPrice === undefined && mapping.totalPrice === undefined) {
    const priceColumns = lowerHeaders
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.includes('price') || h.includes('cost') || h.includes('$'));
    
    if (priceColumns.length >= 2) {
      mapping.unitPrice = priceColumns[0].i;
      mapping.totalPrice = priceColumns[priceColumns.length - 1].i;
    } else if (priceColumns.length === 1) {
      mapping.totalPrice = priceColumns[0].i;
    }
  }
  
  return mapping;
}

export async function parsePdfFile(filePath: string): Promise<ParsedPdfResult> {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        tables: [],
        rawText: '',
        pageCount: 0,
        error: 'File not found',
        extractionMethod: 'fallback'
      };
    }
    
    const dataBuffer = fs.readFileSync(filePath);
    return parsePdfBuffer(dataBuffer);
  } catch (error) {
    return {
      success: false,
      tables: [],
      rawText: '',
      pageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error parsing PDF',
      extractionMethod: 'fallback'
    };
  }
}

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedPdfResult> {
  try {
    const parser = new PDFParse({ data: buffer });
    
    const info = await parser.getInfo({ parsePageInfo: true });
    const textResult = await parser.getText();
    await parser.destroy();
    
    const text = typeof textResult === 'string' ? textResult : (textResult as any).text || '';
    const pageCount = info?.total || 1;
    
    const tables = detectTables(text);
    
    if (tables.length > 0) {
      const suggestedMapping = autoDetectMapping(tables[0].headers);
      (tables[0] as any).suggestedMapping = suggestedMapping;
    }
    
    return {
      success: true,
      tables,
      rawText: text,
      pageCount,
      extractionMethod: 'text'
    };
  } catch (error) {
    return {
      success: false,
      tables: [],
      rawText: '',
      pageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error parsing PDF',
      extractionMethod: 'fallback'
    };
  }
}

export interface MappingConfig {
  description?: number;
  quantity?: number;
  unit?: number;
  unitPrice?: number;
  totalPrice?: number;
}

export interface MappedLineItem {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  totalPrice: string;
  rawData: string[];
  confidence: number;
}

export function applyMapping(table: ParsedTable, mapping: MappingConfig): MappedLineItem[] {
  return table.rows.map(row => {
    const getCell = (index: number | undefined): string => {
      if (index === undefined || index < 0 || index >= row.cells.length) {
        return '';
      }
      return row.cells[index];
    };
    
    return {
      description: getCell(mapping.description),
      quantity: getCell(mapping.quantity),
      unit: getCell(mapping.unit),
      unitPrice: getCell(mapping.unitPrice),
      totalPrice: getCell(mapping.totalPrice),
      rawData: row.cells,
      confidence: row.confidence
    };
  });
}

export function validateMapping(items: MappedLineItem[]): { valid: MappedLineItem[], invalid: MappedLineItem[], warnings: string[] } {
  const valid: MappedLineItem[] = [];
  const invalid: MappedLineItem[] = [];
  const warnings: string[] = [];
  
  for (const item of items) {
    const hasDescription = item.description.trim().length > 0;
    const hasPrice = item.unitPrice.trim().length > 0 || item.totalPrice.trim().length > 0;
    
    if (hasDescription && hasPrice) {
      valid.push(item);
    } else if (hasDescription || hasPrice) {
      invalid.push(item);
      if (!hasDescription) warnings.push(`Row missing description: ${item.rawData.join(' | ')}`);
      if (!hasPrice) warnings.push(`Row missing price: ${item.description}`);
    }
  }
  
  return { valid, invalid, warnings };
}
