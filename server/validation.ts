import type { RfpRequest } from "@shared/schema";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  completionPercentage: number;
}

export interface ValidationRule {
  field: string;
  required: boolean;
  // When present, overrides `required` for a specific rfp object. The rule fires only
  // when this predicate returns true — used for due-date fields that are only required
  // when the corresponding RFP type was selected (contractorRfpRequired /
  // architectRfpRequired flags, merged in from invitation_to_bid before validation).
  conditionalRequired?: (rfp: any) => boolean;
  validator?: (value: any) => boolean;
  message: string;
}

// Fields required at every phase boundary
const baseValidationRules: ValidationRule[] = [
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
    field: "receivedOn",
    required: true,
    message: "Received on date is required"
  },
  {
    field: "requestTypes",
    required: true,
    validator: (types: string[]) => Array.isArray(types) && types.length > 0,
    message: "At least one request type must be selected"
  },
  {
    field: "files",
    required: false,
    validator: (files: any[]) => Array.isArray(files) && files.length > 0,
    message: "Consider adding relevant project files"
  }
];

// Date rules required only from bid-collection onward (these fields are captured in
// Step 3 — Invitation to Bid UI, so they cannot be required at the rfp-validation →
// invitation-to-bid transition where the UI doesn't exist yet).
//
// Each date is conditional on its RFP type being selected (contractorRfpRequired /
// architectRfpRequired flags merged from invitation_to_bid by the route handler before
// calling validateRfpForProgression). If the flag is false the date is never required,
// regardless of phase. This means a user who solicits neither a contractor nor an
// architect can advance past invitation-to-bid without providing any due dates.
const dateValidationRules: ValidationRule[] = [
  {
    field: "contractorDueDate",
    required: false,
    conditionalRequired: (rfp: any) => rfp.contractorRfpRequired === true,
    message: "Contractor due date is required for validation"
  },
  {
    field: "architectDueDate",
    required: false,
    conditionalRequired: (rfp: any) => rfp.architectRfpRequired === true,
    message: "Architect due date is required for validation"
  },
];

// Phases for which date fields are required (bid-collection and all later phases)
const PHASES_REQUIRING_DATES = new Set([
  "bid-collection",
  "evaluation",
  "award",
  "publish",
]);

export function validateRfpForProgression(rfp: RfpRequest, targetPhase?: string): ValidationResult {
  const datesRequired = targetPhase ? PHASES_REQUIRING_DATES.has(targetPhase) : true;
  const rules = datesRequired
    ? [...baseValidationRules, ...dateValidationRules]
    : baseValidationRules;

  const errors: string[] = [];
  let validFields = 0;
  const totalFields = rules.length;

  for (const rule of rules) {
    const fieldValue = (rfp as any)[rule.field];

    // A rule fires as required when either `required` is true OR `conditionalRequired`
    // returns true for this specific rfp object (e.g. date required only when its RFP
    // type was selected).
    const isRequired = rule.required || (rule.conditionalRequired ? rule.conditionalRequired(rfp) : false);

    if (isRequired) {
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
  // NOTE: projectAddress, projectSize, estimatedValue, timelineRequirements, specialRequirements
  // exist in the schema but have NO UI for population. They are excluded from all phase gates
  // to prevent permanently blocking advancement. Schema columns are preserved for future use.
  // See backlog: "Four legacy schema columns in rfp_requests have no UI."
  switch (phase) {
    default:
      return [];
  }
}

export function canAdvanceToPhase(rfp: RfpRequest, targetPhase: string): boolean {
  const validation = validateRfpForProgression(rfp, targetPhase);
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
