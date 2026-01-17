import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';

export interface ParsedRow {
  cells: string[];
  rowIndex: number;
}

export interface ParsedTable {
  headers: string[];
  rows: ParsedRow[];
  rawText: string;
}

export interface ParsedPdfResult {
  success: boolean;
  tables: ParsedTable[];
  rawText: string;
  pageCount: number;
  error?: string;
}

function splitIntoColumns(line: string): string[] {
  const parts = line.split(/\s{2,}|\t/).map(s => s.trim()).filter(s => s.length > 0);
  return parts;
}

function detectTableRows(text: string): ParsedRow[] {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const rows: ParsedRow[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const cells = splitIntoColumns(line);
    
    if (cells.length >= 2) {
      rows.push({
        cells,
        rowIndex: i
      });
    }
  }
  
  return rows;
}

function detectTables(text: string): ParsedTable[] {
  const rows = detectTableRows(text);
  
  if (rows.length === 0) {
    return [];
  }
  
  let headerRow: string[] = [];
  const dataRows: ParsedRow[] = [];
  
  const potentialHeaderKeywords = ['description', 'qty', 'quantity', 'unit', 'price', 'total', 'item', 'amount', 'cost'];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cellsLower = row.cells.map(c => c.toLowerCase());
    
    const matchCount = cellsLower.filter(cell => 
      potentialHeaderKeywords.some(keyword => cell.includes(keyword))
    ).length;
    
    if (matchCount >= 2 && headerRow.length === 0) {
      headerRow = row.cells;
      continue;
    }
    
    if (headerRow.length > 0 || i > 0) {
      dataRows.push(row);
    }
  }
  
  if (headerRow.length === 0 && rows.length > 0) {
    const maxCols = Math.max(...rows.map(r => r.cells.length));
    headerRow = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
  }
  
  return [{
    headers: headerRow,
    rows: dataRows,
    rawText: text
  }];
}

export async function parsePdfFile(filePath: string): Promise<ParsedPdfResult> {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        tables: [],
        rawText: '',
        pageCount: 0,
        error: 'File not found'
      };
    }
    
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    
    const tables = detectTables(data.text);
    
    return {
      success: true,
      tables,
      rawText: data.text,
      pageCount: data.numpages
    };
  } catch (error) {
    return {
      success: false,
      tables: [],
      rawText: '',
      pageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error parsing PDF'
    };
  }
}

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsedPdfResult> {
  try {
    const data = await pdf(buffer);
    const tables = detectTables(data.text);
    
    return {
      success: true,
      tables,
      rawText: data.text,
      pageCount: data.numpages
    };
  } catch (error) {
    return {
      success: false,
      tables: [],
      rawText: '',
      pageCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error parsing PDF'
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
      rawData: row.cells
    };
  });
}
