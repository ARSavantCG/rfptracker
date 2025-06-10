import type { RfpRequest } from "@shared/schema";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  completionPercentage: number;
}

export interface ValidationRule {
  field: string;
  required: boolean;
  validator?: (value: any) => boolean;
  message: string;
}

const rfpValidationRules: ValidationRule[] = [
  {
    field: "property",
    required: true,
    message: "Property is required"
  },
  {
    field: "tenantName",
    required: true,
    message: "Tenant name is required"
  },
  {
    field: "projectName",
    required: true,
    message: "Project name is required"
  },
  {
    field: "sentBy",
    required: true,
    message: "Sent by is required"
  },
  {
    field: "sentOn",
    required: true,
    message: "Sent on date is required"
  },
  {
    field: "requestTypes",
    required: true,
    validator: (types: string[]) => Array.isArray(types) && types.length > 0,
    message: "At least one request type must be selected"
  },
  // Phase 2 validation fields (for workflow progression to General Contractor and/or Architect)
  {
    field: "dueDate",
    required: true,
    message: "Due date is required for validation"
  },
  {
    field: "files",
    required: false,
    validator: (files: any[]) => Array.isArray(files) && files.length > 0,
    message: "Consider adding relevant project files"
  }
];

export function validateRfpForProgression(rfp: RfpRequest): ValidationResult {
  const errors: string[] = [];
  let validFields = 0;
  const totalFields = rfpValidationRules.length;

  for (const rule of rfpValidationRules) {
    const fieldValue = (rfp as any)[rule.field];
    
    if (rule.required) {
      if (!fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '')) {
        errors.push(rule.message);
      } else if (rule.validator && !rule.validator(fieldValue)) {
        errors.push(rule.message);
      } else {
        validFields++;
      }
    } else {
      // Optional fields still count towards completion percentage
      if (fieldValue && (!rule.validator || rule.validator(fieldValue))) {
        validFields++;
      }
    }
  }

  const completionPercentage = Math.round((validFields / totalFields) * 100);
  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    completionPercentage
  };
}

export function getRequiredFieldsForPhase(phase: string): string[] {
  switch (phase) {
    case "invitation-to-bid":
      return ["projectAddress", "projectSize", "estimatedValue", "timelineRequirements"];
    case "bid-collection":
      return ["projectAddress", "projectSize", "estimatedValue", "timelineRequirements", "specialRequirements"];
    case "evaluation":
      return ["projectAddress", "projectSize", "estimatedValue", "timelineRequirements", "specialRequirements"];
    case "award":
      return ["projectAddress", "projectSize", "estimatedValue", "timelineRequirements", "specialRequirements"];
    case "publish":
      return ["projectAddress", "projectSize", "estimatedValue", "timelineRequirements", "specialRequirements"];
    default:
      return [];
  }
}

export function canAdvanceToPhase(rfp: RfpRequest, targetPhase: string): boolean {
  const validation = validateRfpForProgression(rfp);
  const requiredFields = getRequiredFieldsForPhase(targetPhase);
  
  // Check if all required fields for the target phase are filled
  for (const field of requiredFields) {
    const value = (rfp as any)[field];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      return false;
    }
  }
  
  return validation.isValid;
}