import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { evaluateFormula, formatFormulaResult, type FormulaResult } from '@shared/formula-utils';
import { cn } from '@/lib/utils';

// Helper to format number with thousands separators
function formatWithThousands(value: string): string {
  if (!value || value.startsWith('=')) return value;
  
  // Remove existing commas
  const cleaned = value.replace(/,/g, '');
  
  // Don't format if empty or just a decimal point
  if (!cleaned || cleaned === '.' || cleaned === '-' || cleaned === '-.') {
    return cleaned;
  }
  
  // Split on decimal point
  const parts = cleaned.split('.');
  
  // Add commas to integer part
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  // Rejoin with decimal
  return parts.join('.');
}

// Helper to remove thousands separators
function removeThousands(value: string): string {
  return value.replace(/,/g, '');
}

interface FormulaInputProps {
  value: string | number;
  onChange: (value: string | number, evaluatedValue?: number) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  decimalPlaces?: number;
  type?: 'quantity' | 'rate' | 'total';
  formatThousands?: boolean;
}

export function FormulaInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  disabled,
  decimalPlaces = 2,
  type = 'quantity',
  formatThousands = false
}: FormulaInputProps) {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [formulaResult, setFormulaResult] = useState<FormulaResult | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update display value when prop value changes
  useEffect(() => {
    if (!isEditing) {
      const strValue = String(value || '');
      
      // Apply thousands formatting if enabled and not a formula
      const formatted = formatThousands && !strValue.startsWith('=') 
        ? formatWithThousands(strValue)
        : strValue;
      
      setDisplayValue(formatted);
      
      if (strValue.startsWith('=')) {
        const result = evaluateFormula(strValue);
        console.log('🧮 Formula evaluation:', strValue, '=>', result);
        setFormulaResult(result);
        setShowFormula(false); // Show result by default
      } else {
        setFormulaResult(null);
        setShowFormula(false);
      }
    }
  }, [value, isEditing, formatThousands]);

  const handleFocus = () => {
    setIsEditing(true);
    const strValue = String(value || '');
    
    // Apply formatting when focusing if enabled
    const formatted = formatThousands && !strValue.startsWith('=')
      ? formatWithThousands(strValue)
      : strValue;
    
    setDisplayValue(formatted);
    
    // If it's a formula, show the formula when editing
    if (strValue.startsWith('=')) {
      setShowFormula(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    
    // Remove commas for evaluation and submission
    const rawValue = removeThousands(displayValue);
    
    const result = evaluateFormula(rawValue);
    console.log('🔍 FormulaInput handleBlur evaluation:', rawValue, '=>', result);
    setFormulaResult(result);
    
    // If it's a valid formula, show the result
    if (result.isFormula && !result.error) {
      setShowFormula(false);
    }
    
    // Call the onChange with both the raw value and evaluated value
    // For non-formula values, use the parsed number as evaluatedValue
    let evaluatedValue = result.value;
    if (!result.isFormula && rawValue) {
      const numValue = parseFloat(rawValue);
      if (!isNaN(numValue)) {
        evaluatedValue = numValue;
      }
    }
    
    // Always call onChange with the RAW value (no commas) for validation
    onChange(rawValue, evaluatedValue || undefined);
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    
    // Real-time formula evaluation for immediate feedback
    if (newValue.startsWith('=')) {
      setDisplayValue(newValue);
      const result = evaluateFormula(newValue);
      setFormulaResult(result);
      return;
    }
    
    // If formatThousands is disabled, use normal path
    if (!formatThousands) {
      setDisplayValue(newValue);
      setFormulaResult(null);
      return;
    }
    
    // Format thousands: validate and reformat with cursor preservation
    const rawValue = removeThousands(newValue);
    
    // Validate input: allow digits, one decimal, optional leading minus
    if (rawValue && !/^-?\d*\.?\d*$/.test(rawValue)) {
      return; // Invalid input, don't update
    }
    
    // Format with thousands separators
    const formatted = formatWithThousands(rawValue);
    
    // Calculate cursor position: count raw digits in the new input up to cursor position
    const rawBeforeCursor = removeThousands(newValue.substring(0, cursorPos));
    const targetRawCount = rawBeforeCursor.length;
    
    // Find cursor position in formatted string by counting raw digits
    let newCursorPos = 0;
    
    // Handle edge case: cursor at start (targetRawCount === 0)
    if (targetRawCount === 0) {
      newCursorPos = 0;
    } else {
      // Count raw digits to find cursor position
      let rawCount = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (formatted[i] !== ',') {
          rawCount++;
          if (rawCount >= targetRawCount) {
            newCursorPos = i + 1;
            break;
          }
        }
      }
      
      // Handle case where cursor is at the end
      if (rawCount < targetRawCount) {
        newCursorPos = formatted.length;
      }
    }
    
    setDisplayValue(formatted);
    setFormulaResult(null);
    
    // Restore cursor position after state update
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Toggle between formula and result view with F2
    if (e.key === 'F2' && formulaResult?.isFormula) {
      e.preventDefault();
      setShowFormula(!showFormula);
      if (!showFormula) {
        // Switching to formula view - set cursor to end
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(displayValue.length, displayValue.length);
          }
        }, 0);
      }
    }
    
    // Enter confirms the input
    if (e.key === 'Enter') {
      inputRef.current?.blur();
    }
  };

  // Determine what to show in the input
  const getInputValue = () => {
    
    if (isEditing || showFormula) {
      return displayValue;
    }
    
    // Only format formula results if it's actually a formula (starts with =)
    if (formulaResult && displayValue.startsWith('=')) {
      if (formulaResult.error) {
        return displayValue; // Return original value instead of error message
      }
      
      if (formulaResult.value !== null && formulaResult.value !== undefined && typeof formulaResult.value === 'number' && !isNaN(formulaResult.value)) {
        // Format based on the type
        const formattedValue = type === 'quantity' 
          ? formulaResult.value.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2
            })
          : formulaResult.value.toLocaleString('en-US', {
              minimumFractionDigits: decimalPlaces,
              maximumFractionDigits: decimalPlaces
            });
        return formattedValue;
      } else {
        return displayValue; // Return original value instead of '0.00'
      }
    }
    
    // For non-formula values when NOT editing, don't apply any formatting
    // Always return the original value to preserve exact decimal representation
    // This prevents "1.50" from being rounded to "2"
    
    return displayValue;
  };

  const inputClassName = cn(
    className,
    formulaResult?.error && "border-red-500 bg-red-50 dark:bg-red-900/20",
    formulaResult?.isFormula && !formulaResult.error && "border-blue-500 bg-blue-50 dark:bg-blue-900/20",
    "font-mono text-right"
  );

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={getInputValue()}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        disabled={disabled}
      />
      
      {/* Formula indicator */}
      {formulaResult?.isFormula && !isEditing && (
        <div className="absolute -top-2 -right-2">
          <div className="bg-blue-500 text-white text-xs px-1 py-0.5 rounded text-center min-w-[16px] h-4 flex items-center justify-center">
            f
          </div>
        </div>
      )}
      
      {/* Error tooltip */}
      {formulaResult?.error && isEditing && (
        <div className="absolute top-full left-0 mt-1 bg-red-500 text-white text-xs px-2 py-1 rounded shadow-lg z-10 whitespace-nowrap">
          {formulaResult.error}
        </div>
      )}
      
      {/* Formula help text */}
      {isEditing && displayValue.startsWith('=') && (
        <div className="absolute top-full left-0 mt-1 bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-lg z-10 whitespace-nowrap">
          Press F2 to toggle formula/result view
        </div>
      )}
    </div>
  );
}