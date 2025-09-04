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
 * Applies symmetrical legal compliance adjustments for ALL buildings
 * Ensures mirrored buildings maintain consistent tenant allocations
 * Uses center bay distribution to preserve building symmetry
 */
export async function applySymmetricalLegalCompliance(
  propertyId: number,
  targetBays: string[],
  targetTotal: number
): Promise<{
  success: boolean;
  message: string;
  originalTotal: number;
  finalTotal: number;
  adjustedBays: string[];
}> {
  try {
    const property = await storage.getProperty(propertyId);
    if (!property || !property.bayConfigurations) {
      return {
        success: false,
        message: `Property ${propertyId} not found or has no bay configurations`,
        originalTotal: 0,
        finalTotal: 0,
        adjustedBays: []
      };
    }

    // Extract specified tenant bays
    const tenantBays = property.bayConfigurations.filter((bay: any) => 
      targetBays.includes(bay.bayName)
    );

    // Calculate current tenant total
    const originalTotal = tenantBays.reduce((sum: number, bay: any) => 
      sum + (bay.rentableSquareFootage || 0), 0
    );

    const shortage = targetTotal - originalTotal;

    console.log(`🏗️ SYMMETRICAL LEGAL COMPLIANCE CHECK (Property ${propertyId}):`);
    console.log(`   Current tenant total: ${originalTotal} SF`);
    console.log(`   Required tenant total: ${targetTotal} SF`);
    console.log(`   Adjustment needed: ${shortage} SF`);

    if (shortage === 0) {
      return {
        success: true,
        message: `✅ Tenant allocation already compliant at ${originalTotal} SF`,
        originalTotal,
        finalTotal: originalTotal,
        adjustedBays: []
      };
    }

    if (shortage < 0) {
      return {
        success: false,
        message: `❌ Tenant allocation exceeds requirement by ${Math.abs(shortage)} SF - manual adjustment needed`,
        originalTotal,
        finalTotal: originalTotal,
        adjustedBays: []
      };
    }

    // Apply symmetrical legal compliance to tenant bays
    const tenantBayConfigs = tenantBays.map((bay: any) => ({
      bayNumber: bay.bayName || bay.bayNumber || 'Unknown',
      rentableSquareFootage: bay.rentableSquareFootage || 0,
      ...bay
    }));

    // Symmetrical distribution for ALL mirrored building layouts
    // Ensures consistent tenant allocations across mirror buildings
    const updatedBayConfigs = [...tenantBayConfigs];
    let result: any;

    // For small adjustments (1-10 SF), use symmetrical center distribution
    if (shortage > 0 && shortage <= 10) {
      // Find center bays for symmetrical distribution
      const totalBays = tenantBayConfigs.length;
      const centerStart = Math.floor(totalBays / 3);
      const centerEnd = Math.floor((2 * totalBays) / 3);
      
      // Select center bays for adjustment to maintain building symmetry
      const centerBays = tenantBayConfigs.slice(centerStart, centerEnd + 1);
      const adjustedBays: string[] = [];
      
      // Distribute shortage evenly across center bays
      const sfPerBay = Math.floor(shortage / centerBays.length);
      const remainderSF = shortage % centerBays.length;
      
      centerBays.forEach((bay, index) => {
        const bayIndex = updatedBayConfigs.findIndex(config => config.bayNumber === bay.bayNumber);
        if (bayIndex !== -1) {
          const adjustment = sfPerBay + (index < remainderSF ? 1 : 0);
          updatedBayConfigs[bayIndex] = {
            ...updatedBayConfigs[bayIndex],
            rentableSquareFootage: updatedBayConfigs[bayIndex].rentableSquareFootage + adjustment
          };
          adjustedBays.push(bay.bayNumber);
        }
      });

      result = {
        success: true,
        originalTotal,
        finalTotal: targetTotal,
        adjustedBays,
        message: `Symmetrically distributed ${shortage} SF across ${centerBays.length} center bays to maintain mirror building balance`
      };
    } else {
      // For larger adjustments, use the standard legal increase system
      const { updatedBayConfigs: standardConfigs, result: standardResult } = applyLegalIncrease(tenantBayConfigs, targetTotal);
      updatedBayConfigs.splice(0, updatedBayConfigs.length, ...standardConfigs);
      result = standardResult;
    }

    if (!result.success) {
      return {
        success: false,
        message: `❌ Failed to adjust tenant allocation: ${result.message}`,
        originalTotal,
        finalTotal: originalTotal,
        adjustedBays: []
      };
    }

    // Update the property with adjusted tenant bays
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
    await storage.updateProperty(propertyId, {
      ...property,
      bayConfigurations: updatedBayConfigurations
    });

    const finalTotal = updatedBayConfigs.reduce((sum: number, bay: any) => 
      sum + bay.rentableSquareFootage, 0
    );

    console.log(`✅ SYMMETRICAL LEGAL COMPLIANCE APPLIED (Property ${propertyId}):`);
    console.log(`   Original total: ${originalTotal} SF`);
    console.log(`   Final total: ${finalTotal} SF`);
    console.log(`   Adjusted bays: ${result.adjustedBays.join(', ')}`);

    return {
      success: true,
      message: `✅ Tenant allocation adjusted: ${originalTotal} → ${finalTotal} SF. Applied symmetrical distribution to ${result.adjustedBays.length} bays.`,
      originalTotal,
      finalTotal,
      adjustedBays: result.adjustedBays
    };

  } catch (error) {
    console.error(`❌ Error applying symmetrical legal compliance to property ${propertyId}:`, error);
    return {
      success: false,
      message: `Error applying symmetrical legal compliance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      originalTotal: 0,
      finalTotal: 0,
      adjustedBays: []
    };
  }

}

/**
 * Convenience function for BIA lease specifically
 */
export async function fixBIALeaseTotal(): Promise<{
  success: boolean;
  message: string;
  originalTotal: number;
  finalTotal: number;
  adjustedBays: string[];
}> {
  const biaBayNames = [
    'Bay 14-15', 'Bay 15-16', 'Bay 16-17', 'Bay 17-18', 'Bay 18-19', 'Bay 19-20',
    'Bay 20-21', 'Bay 21-22', 'Bay 22-23', 'Bay 23-24', 'Bay 24-25', 'Bay 25-26', 'Bay 26-27'
  ];
  
  return applySymmetricalLegalCompliance(3, biaBayNames, 397167);
}