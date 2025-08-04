/**
 * Excel-like formula evaluation utility
 * Supports basic arithmetic operations for quantities, unit rates, and totals
 */

export interface FormulaResult {
  value: number | null;
  error?: string;
  isFormula: boolean;
}

/**
 * Evaluates a formula or returns the numeric value
 * @param input - The input string (can be a number or formula starting with "=")
 * @returns FormulaResult with evaluated value or error
 */
export function evaluateFormula(input: string | number): FormulaResult {
  // Handle numeric input
  if (typeof input === 'number') {
    return { value: input, isFormula: false };
  }

  // Handle string input
  const trimmed = String(input).trim();
  
  // Check if it's a formula (starts with "=")
  if (!trimmed.startsWith('=')) {
    // Try to parse as a regular number
    const numValue = parseFloat(trimmed);
    if (isNaN(numValue)) {
      return { value: null, error: 'Invalid number', isFormula: false };
    }
    return { value: numValue, isFormula: false };
  }

  // It's a formula - extract the expression after "="
  const expression = trimmed.slice(1).trim();
  
  if (!expression) {
    return { value: null, error: 'Empty formula', isFormula: true };
  }

  try {
    // Evaluate the mathematical expression
    const result = evaluateExpression(expression);
    return { value: result, isFormula: true };
  } catch (error) {
    return { 
      value: null, 
      error: error instanceof Error ? error.message : 'Formula error', 
      isFormula: true 
    };
  }
}

/**
 * Safely evaluates a mathematical expression
 * Supports: +, -, *, /, (, ), numbers, decimal points
 */
function evaluateExpression(expression: string): number {
  // Remove all whitespace
  const cleaned = expression.replace(/\s/g, '');
  
  // Validate the expression contains only allowed characters
  const allowedChars = /^[0-9+\-*/.()]+$/;
  if (!allowedChars.test(cleaned)) {
    throw new Error('Invalid characters in formula');
  }

  // Check for balanced parentheses
  let parenthesesCount = 0;
  for (const char of cleaned) {
    if (char === '(') parenthesesCount++;
    if (char === ')') parenthesesCount--;
    if (parenthesesCount < 0) {
      throw new Error('Unmatched parentheses');
    }
  }
  if (parenthesesCount !== 0) {
    throw new Error('Unmatched parentheses');
  }

  // Prevent potential security issues by using a safe evaluation approach
  // This implementation uses a simple recursive descent parser
  return parseExpression(cleaned, { pos: 0 });
}

interface ParseContext {
  pos: number;
}

function parseExpression(expr: string, ctx: ParseContext): number {
  let result = parseTerm(expr, ctx);
  
  while (ctx.pos < expr.length) {
    const op = expr[ctx.pos];
    if (op === '+' || op === '-') {
      ctx.pos++;
      const right = parseTerm(expr, ctx);
      result = op === '+' ? result + right : result - right;
    } else {
      break;
    }
  }
  
  return result;
}

function parseTerm(expr: string, ctx: ParseContext): number {
  let result = parseFactor(expr, ctx);
  
  while (ctx.pos < expr.length) {
    const op = expr[ctx.pos];
    if (op === '*' || op === '/') {
      ctx.pos++;
      const right = parseFactor(expr, ctx);
      if (op === '/' && right === 0) {
        throw new Error('Division by zero');
      }
      result = op === '*' ? result * right : result / right;
    } else {
      break;
    }
  }
  
  return result;
}

function parseFactor(expr: string, ctx: ParseContext): number {
  if (ctx.pos >= expr.length) {
    throw new Error('Unexpected end of expression');
  }
  
  // Handle negative numbers
  if (expr[ctx.pos] === '-') {
    ctx.pos++;
    return -parseFactor(expr, ctx);
  }
  
  // Handle positive numbers (optional + sign)
  if (expr[ctx.pos] === '+') {
    ctx.pos++;
    return parseFactor(expr, ctx);
  }
  
  // Handle parentheses
  if (expr[ctx.pos] === '(') {
    ctx.pos++;
    const result = parseExpression(expr, ctx);
    if (ctx.pos >= expr.length || expr[ctx.pos] !== ')') {
      throw new Error('Missing closing parenthesis');
    }
    ctx.pos++;
    return result;
  }
  
  // Parse number
  return parseNumber(expr, ctx);
}

function parseNumber(expr: string, ctx: ParseContext): number {
  const start = ctx.pos;
  
  // Skip digits and decimal point
  while (ctx.pos < expr.length && /[0-9.]/.test(expr[ctx.pos])) {
    ctx.pos++;
  }
  
  if (start === ctx.pos) {
    throw new Error('Expected number');
  }
  
  const numberStr = expr.slice(start, ctx.pos);
  const result = parseFloat(numberStr);
  
  if (isNaN(result)) {
    throw new Error('Invalid number: ' + numberStr);
  }
  
  return result;
}

/**
 * Formats a number for display, handling null values
 */
export function formatFormulaResult(result: FormulaResult, decimalPlaces: number = 2): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }
  
  if (result.value === null) {
    return '';
  }
  
  return result.value.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  });
}

/**
 * Example usage and test cases
 */
export const formulaExamples = [
  { input: '100', expected: 100 },
  { input: '=50+25', expected: 75 },
  { input: '=100*2.5', expected: 250 },
  { input: '=(100+50)/3', expected: 50 },
  { input: '=1000-250+50', expected: 800 },
  { input: '=10*10+5*5', expected: 125 },
];