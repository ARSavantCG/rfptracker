/**
 * Property Legal Compliance System
 * 
 * Ensures ALL properties (existing and new) maintain exact legal square footage requirements
 * to prevent lawsuit risk from overstating leasable areas.
 */

import { applyLegalRounding, validateLegalCompliance } from './legal-rounding-system';
import { applyLegalIncrease } from './legal-increase-system';
import { storage } from './storage';

/**
 * Legal square footage requirements for each property
 * CRITICAL: These totals are exact legal requirements - overstating even by 1 SF can result in lawsuits
 */
export const LEGAL_PROPERTY_TOTALS: Record<number, { name: string; requiredSF: number }> = {
  1: { name: 'Bridge Point Gratigny', requiredSF: 409189 },
  2: { name: 'Bridge 595', requiredSF: 290307 },
  3: { name: 'MG Westside', requiredSF: 794334 }, // Current total - verify this is correct
  4: { name: 'Bridge Point Port Everglades', requiredSF: 171983 }
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

    // Apply legal compliance (either increase or decrease as needed)
    const bayConfigs = property.bayConfigurations.map((bay: any) => ({
      bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
      rentableSquareFootage: bay.rentableSquareFootage || 0,
      ...bay
    }));

    let updatedBayConfigs;
    let result;

    if (originalTotal > legalReq.requiredSF) {
      // Need to reduce total - use rounding system
      const roundingResult = applyLegalRounding(bayConfigs, legalReq.requiredSF);
      updatedBayConfigs = roundingResult.updatedBayConfigs;
      result = roundingResult.result;
    } else if (originalTotal < legalReq.requiredSF) {
      // Need to increase total - use increase system  
      const increaseResult = applyLegalIncrease(bayConfigs, legalReq.requiredSF);
      updatedBayConfigs = increaseResult.updatedBayConfigs;
      result = increaseResult.result;
    } else {
      // Already compliant
      updatedBayConfigs = bayConfigs;
      result = {
        success: true,
        finalTotal: originalTotal,
        message: `Already compliant at ${originalTotal} SF`
      };
    }

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

/**
 * Fixes BIA lease bay total for MG Westside Building B
 * Ensures Bays 14-26 total exactly 397,167 SF by applying legal increase
 */
export async function fixBIALeaseTotal(): Promise<{
  success: boolean;
  message: string;
  originalTotal: number;
  finalTotal: number;
  adjustedBays: string[];
}> {
  try {
    const property = await storage.getProperty(3); // MG Westside Building B
    if (!property || !property.bayConfigurations) {
      return {
        success: false,
        message: 'MG Westside Building B not found or has no bay configurations',
        originalTotal: 0,
        finalTotal: 0,
        adjustedBays: []
      };
    }

    // Define BIA lease bays (14-26)
    const biaBayNames = [
      'Bay 14-15', 'Bay 15-16', 'Bay 16-17', 'Bay 17-18', 'Bay 18-19', 'Bay 19-20',
      'Bay 20-21', 'Bay 21-22', 'Bay 22-23', 'Bay 23-24', 'Bay 24-25', 'Bay 25-26', 'Bay 26-27'
    ];

    // Extract BIA lease bays
    const biaBays = property.bayConfigurations.filter((bay: any) => 
      biaBayNames.includes(bay.bayName)
    );

    // Calculate current BIA lease total
    const originalBIATotal = biaBays.reduce((sum: number, bay: any) => 
      sum + (bay.rentableSquareFootage || 0), 0
    );

    const targetBIATotal = 397167; // Exact BIA lease requirement
    const shortage = targetBIATotal - originalBIATotal;

    console.log(`🏗️ BIA LEASE COMPLIANCE CHECK:`);
    console.log(`   Current BIA lease total: ${originalBIATotal} SF`);
    console.log(`   Required BIA lease total: ${targetBIATotal} SF`);
    console.log(`   Shortage: ${shortage} SF`);

    if (shortage === 0) {
      return {
        success: true,
        message: `✅ BIA lease already compliant at ${originalBIATotal} SF`,
        originalTotal: originalBIATotal,
        finalTotal: originalBIATotal,
        adjustedBays: []
      };
    }

    if (shortage < 0) {
      return {
        success: false,
        message: `❌ BIA lease exceeds requirement by ${Math.abs(shortage)} SF - manual adjustment needed`,
        originalTotal: originalBIATotal,
        finalTotal: originalBIATotal,
        adjustedBays: []
      };
    }

    // Apply legal increase to BIA bays only
    const biaBayConfigs = biaBays.map((bay: any) => ({
      bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
      rentableSquareFootage: bay.rentableSquareFootage || 0,
      ...bay
    }));

    const { updatedBayConfigs, result } = applyLegalIncrease(biaBayConfigs, targetBIATotal);

    if (!result.success) {
      return {
        success: false,
        message: `❌ Failed to adjust BIA lease total: ${result.message}`,
        originalTotal: originalBIATotal,
        finalTotal: originalBIATotal,
        adjustedBays: []
      };
    }

    // Update the property with adjusted BIA bays
    const updatedBayConfigurations = property.bayConfigurations.map((bay: any) => {
      const updatedBay = updatedBayConfigs.find((updated: any) => updated.bayNumber === bay.bayName);
      if (updatedBay) {
        return {
          ...bay,
          rentableSquareFootage: updatedBay.rentableSquareFootage
        };
      }
      return bay;
    });

    // Update property in database
    await storage.updateProperty(3, {
      ...property,
      bayConfigurations: updatedBayConfigurations
    });

    const finalBIATotal = updatedBayConfigs.reduce((sum: number, bay: any) => 
      sum + bay.rentableSquareFootage, 0
    );

    console.log(`✅ BIA LEASE LEGAL COMPLIANCE FIXED:`);
    console.log(`   Original total: ${originalBIATotal} SF`);
    console.log(`   Final total: ${finalBIATotal} SF`);
    console.log(`   Adjusted bays: ${result.adjustedBays.join(', ')}`);

    return {
      success: true,
      message: `✅ BIA lease total fixed: ${originalBIATotal} → ${finalBIATotal} SF. Adjusted ${result.adjustedBays.length} bays.`,
      originalTotal: originalBIATotal,
      finalTotal: finalBIATotal,
      adjustedBays: result.adjustedBays
    };

  } catch (error) {
    console.error('❌ Error fixing BIA lease total:', error);
    return {
      success: false,
      message: `Error fixing BIA lease total: ${error instanceof Error ? error.message : 'Unknown error'}`,
      originalTotal: 0,
      finalTotal: 0,
      adjustedBays: []
    };
  }
}