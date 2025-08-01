/**
 * Property Legal Compliance System
 * 
 * Ensures ALL properties (existing and new) maintain exact legal square footage requirements
 * to prevent lawsuit risk from overstating leasable areas.
 */

import { applyLegalRounding, validateLegalCompliance } from './legal-rounding-system';
import { storage } from './storage';

/**
 * Legal square footage requirements for each property
 * CRITICAL: These totals are exact legal requirements - overstating even by 1 SF can result in lawsuits
 */
export const LEGAL_PROPERTY_TOTALS: Record<number, { name: string; requiredSF: number }> = {
  1: { name: 'Bridge Point Gratigny', requiredSF: 409189 },
  2: { name: 'Bridge 595', requiredSF: 290307 },
  3: { name: 'MG Westside', requiredSF: 794334 }, // Current total - verify this is correct
  4: { name: 'Bridge Point Port Everglades', requiredSF: 171893 }
};

/**
 * Validates and enforces legal compliance for a single property
 */
export async function enforcePropertyLegalCompliance(propertyId: number): Promise<{
  success: boolean;
  message: string;
  adjustmentsMade: boolean;
  originalTotal: number;
  finalTotal: number;
}> {
  try {
    const property = await storage.getProperty(propertyId);
    if (!property || !property.bayConfigurations) {
      return {
        success: false,
        message: `Property ${propertyId} not found or has no bay configurations`,
        adjustmentsMade: false,
        originalTotal: 0,
        finalTotal: 0
      };
    }

    const legalReq = LEGAL_PROPERTY_TOTALS[propertyId];
    if (!legalReq) {
      return {
        success: false,
        message: `No legal requirement defined for property ${propertyId}`,
        adjustmentsMade: false,
        originalTotal: 0,
        finalTotal: 0
      };
    }

    // Calculate current total
    const originalTotal = property.bayConfigurations.reduce(
      (sum: number, bay: any) => sum + (bay.rentableSquareFootage || 0), 
      0
    );

    // Check if adjustment is needed
    if (originalTotal === legalReq.requiredSF) {
      return {
        success: true,
        message: `✅ ${legalReq.name}: Already compliant at ${originalTotal} SF`,
        adjustmentsMade: false,
        originalTotal,
        finalTotal: originalTotal
      };
    }

    // Apply legal rounding
    const bayConfigs = property.bayConfigurations.map((bay: any) => ({
      bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
      rentableSquareFootage: bay.rentableSquareFootage || 0,
      ...bay
    }));

    const { updatedBayConfigs, result } = applyLegalRounding(bayConfigs, legalReq.requiredSF);

    if (!result.success) {
      return {
        success: false,
        message: `❌ ${legalReq.name}: ${result.message}`,
        adjustmentsMade: false,
        originalTotal,
        finalTotal: result.finalTotal
      };
    }

    // Update property in database
    const updatedProperty = {
      ...property,
      bayConfigurations: updatedBayConfigs
    };

    await storage.updateProperty(propertyId, updatedProperty);

    return {
      success: true,
      message: `✅ ${legalReq.name}: ${result.message}`,
      adjustmentsMade: true,
      originalTotal,
      finalTotal: result.finalTotal
    };

  } catch (error) {
    console.error(`Error enforcing legal compliance for property ${propertyId}:`, error);
    return {
      success: false,
      message: `Error processing property ${propertyId}: ${error}`,
      adjustmentsMade: false,
      originalTotal: 0,
      finalTotal: 0
    };
  }
}

/**
 * Enforces legal compliance for ALL existing properties
 */
export async function enforceAllPropertiesLegalCompliance(): Promise<{
  success: boolean;
  results: Array<{
    propertyId: number;
    propertyName: string;
    success: boolean;
    message: string;
    adjustmentsMade: boolean;
    originalTotal: number;
    finalTotal: number;
  }>;
  summary: string;
}> {
  const results = [];
  let totalAdjustments = 0;
  let totalErrors = 0;

  console.log('🏛️ LEGAL COMPLIANCE ENFORCEMENT - Processing all properties...');

  for (const [propertyId, legalReq] of Object.entries(LEGAL_PROPERTY_TOTALS)) {
    const id = parseInt(propertyId);
    console.log(`📋 Processing ${legalReq.name} (Property ${id})...`);
    
    const result = await enforcePropertyLegalCompliance(id);
    
    results.push({
      propertyId: id,
      propertyName: legalReq.name,
      ...result
    });

    if (result.success) {
      if (result.adjustmentsMade) {
        totalAdjustments++;
        console.log(`✅ ${legalReq.name}: Legal compliance enforced (${result.originalTotal} → ${result.finalTotal} SF)`);
      } else {
        console.log(`✅ ${legalReq.name}: Already compliant (${result.finalTotal} SF)`);
      }
    } else {
      totalErrors++;
      console.log(`❌ ${legalReq.name}: ${result.message}`);
    }
  }

  const allSuccess = totalErrors === 0;
  const summary = `Legal compliance enforcement completed: ${results.length} properties processed, ${totalAdjustments} adjusted, ${totalErrors} errors`;

  console.log(`🏛️ LEGAL COMPLIANCE SUMMARY: ${summary}`);

  return {
    success: allSuccess,
    results,
    summary
  };
}

/**
 * Validates a property before creation/update to ensure legal compliance
 */
export function validatePropertyBeforeSave(
  propertyId: number | null,
  bayConfigurations: any[]
): { isValid: boolean; message: string; requiredAdjustments?: any[] } {
  
  // For new properties, we need to define legal requirements first
  if (propertyId === null) {
    return {
      isValid: true,
      message: 'New property - legal requirements will be established after creation'
    };
  }

  const legalReq = LEGAL_PROPERTY_TOTALS[propertyId];
  if (!legalReq) {
    return {
      isValid: false,
      message: `No legal requirement defined for property ${propertyId}`
    };
  }

  const validation = validateLegalCompliance(
    bayConfigurations.map(bay => ({
      bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
      rentableSquareFootage: bay.rentableSquareFootage || 0,
      ...bay
    })),
    legalReq.requiredSF
  );

  return {
    isValid: validation.isCompliant,
    message: validation.message,
    requiredAdjustments: !validation.isCompliant ? 
      [`Reduce total by ${validation.variance} SF using legal rounding system`] : 
      undefined
  };
}

/**
 * Middleware function to automatically enforce legal compliance on property updates
 */
export async function autoEnforceLegalComplianceMiddleware(
  propertyId: number,
  updatedProperty: any
): Promise<any> {
  
  const validation = validatePropertyBeforeSave(propertyId, updatedProperty.bayConfigurations || []);
  
  if (!validation.isValid && updatedProperty.bayConfigurations) {
    console.log(`🔧 Auto-applying legal compliance to property ${propertyId}...`);
    
    const legalReq = LEGAL_PROPERTY_TOTALS[propertyId];
    if (legalReq) {
      const bayConfigs = updatedProperty.bayConfigurations.map((bay: any) => ({
        bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
        rentableSquareFootage: bay.rentableSquareFootage || 0,
        ...bay
      }));

      const { updatedBayConfigs, result } = applyLegalRounding(bayConfigs, legalReq.requiredSF);
      
      if (result.success) {
        console.log(`✅ Auto-applied legal compliance: ${result.message}`);
        return {
          ...updatedProperty,
          bayConfigurations: updatedBayConfigs
        };
      }
    }
  }

  return updatedProperty;
}