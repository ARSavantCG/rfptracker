import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { evaluateFormula, formatFormulaResult, type FormulaResult } from '@shared/formula-utils';
import { cn } from '@/lib/utils';

interface FormulaInputProps {
  value: string | number;
  onChange: (value: string | number, evaluatedValue?: number) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  decimalPlaces?: number;
  type?: 'quantity' | 'rate' | 'total';
}

export function FormulaInput({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  disabled,
  decimalPlaces = 2,
  type = 'quantity'
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
      setDisplayValue(strValue);
      
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
  }, [value, isEditing]);

  const handleFocus = () => {
    setIsEditing(true);
    const strValue = String(value || '');
    setDisplayValue(strValue);
    
    // If it's a formula, show the formula when editing
    if (strValue.startsWith('=')) {
      setShowFormula(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    
    const result = evaluateFormula(displayValue);
    console.log('🔍 FormulaInput handleBlur evaluation:', displayValue, '=>', result);
    setFormulaResult(result);
    
    // If it's a valid formula, show the result
    if (result.isFormula && !result.error) {
      setShowFormula(false);
    }
    
    // Call the onChange with both the raw value and evaluated value
    // For non-formula values, use the parsed number as evaluatedValue
    let evaluatedValue = result.value;
    if (!result.isFormula && displayValue) {
      const numValue = parseFloat(displayValue);
      if (!isNaN(numValue)) {
        evaluatedValue = numValue;
      }
    }
    
    // Don't call onChange if we have invalid values
    if (evaluatedValue !== null && !isNaN(evaluatedValue)) {
      onChange(displayValue, evaluatedValue);
    } else {
      console.log('⚠️ Skipping onChange due to invalid value:', displayValue, evaluatedValue);
    }
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    
    // Real-time formula evaluation for immediate feedback
    if (newValue.startsWith('=')) {
      const result = evaluateFormula(newValue);
      setFormulaResult(result);
    } else {
      setFormulaResult(null);
    }
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
    
    if (formulaResult) {
      if (formulaResult.error) {
        console.log('🚨 Formula error for', displayValue, ':', formulaResult.error);
        return `Error: ${formulaResult.error}`;
      }
      
      if (formulaResult.value !== null && !isNaN(formulaResult.value)) {
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
        console.log('💰 Formatted formula result:', displayValue, '=>', formattedValue);
        return formattedValue;
      } else {
        console.log('⚠️ Invalid formula result:', displayValue, formulaResult);
        return '0.00'; // Return a safe default instead of showing error
      }
    }
    
    // For non-formula values, format numbers properly
    if (displayValue && !displayValue.startsWith('=')) {
      const numValue = parseFloat(displayValue);
      if (!isNaN(numValue)) {
        if (type === 'quantity') {
          return numValue.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
          });
        } else {
          return numValue.toLocaleString('en-US', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces
          });
        }
      }
    }
    
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