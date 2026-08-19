import { PROPERTY_LEGAL_TOTALS_BY_ID } from "@shared/area-utils";
/**
 * Legal Compliance Rounding System
 * 
 * Critical requirement: Leasable area must be exact - overstating even by 1 SF 
 * can result in legal action. This system ensures consistent rounding across 
 * all properties by distributing excess square footage across smallest bays.
 */

export interface BayConfiguration {
  bayNumber: string;
  rentableSquareFootage: number;
  mechanicalRoomAllocation?: number;
  [key: string]: any;
}

export interface RoundingResult {
  success: boolean;
  originalTotal: number;
  finalTotal: number;
  adjustedBays: Array<{
    bayNumber: string;
    originalSF: number;
    adjustedSF: number;
    reduction: number;
  }>;
  message: string;
}

/**
 * Applies legal compliance rounding to bay configurations
 * Distributes excess square footage by taking 1 SF from the smallest bays
 * matching the exact difference (e.g., 5 SF excess = 1 SF from 5 smallest bays)
 * When multiple bays have the same SF, prioritizes by bay number order (Bay 1, Bay 2, etc.)
 * 
 * @param bayConfigs - Array of bay configurations
 * @param targetTotal - Exact total square footage allowed for leasing
 * @returns Updated bay configurations and adjustment details
 */
export function applyLegalRounding(
  bayConfigs: BayConfiguration[], 
  targetTotal: number
): { updatedBayConfigs: BayConfiguration[], result: RoundingResult } {
  
  // Calculate current total
  const originalTotal = bayConfigs.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0);
  const excess = originalTotal - targetTotal;
  
  const result: RoundingResult = {
    success: false,
    originalTotal,
    finalTotal: originalTotal,
    adjustedBays: [],
    message: ''
  };
  
  // If no excess, no adjustment needed
  if (excess <= 0) {
    result.success = true;
    result.message = `No adjustment needed. Total: ${originalTotal} SF matches target: ${targetTotal} SF`;
    return { updatedBayConfigs: bayConfigs, result };
  }
  
  // If excess is greater than number of bays, we cannot distribute
  if (excess > bayConfigs.length) {
    result.message = `Cannot distribute ${excess} SF excess across ${bayConfigs.length} bays. Maximum reduction possible: ${bayConfigs.length} SF`;
    return { updatedBayConfigs: bayConfigs, result };
  }
  
  // Sort bays by square footage (ascending), then by bay number (ascending) for ties
  // This ensures consistent selection when multiple bays have the same SF
  const bayIndices = bayConfigs.map((bay, index) => ({
    index,
    sf: bay.rentableSquareFootage,
    bayNumber: bay.bayNumber
  })).sort((a, b) => {
    // Primary sort: by square footage (smallest first)
    if (a.sf !== b.sf) {
      return a.sf - b.sf;
    }
    // Secondary sort: by bay number (Bay 1, Bay 2, etc.) for ties
    // Extract numeric part from bay number for proper sorting
    const aBayNum = parseInt(a.bayNumber.split('-')[0]);
    const bBayNum = parseInt(b.bayNumber.split('-')[0]);
    return aBayNum - bBayNum;
  });
  
  // Create updated configurations
  const updatedBayConfigs = [...bayConfigs];
  
  // Distribute excess across the exact number of smallest bays matching the difference
  // If 5 SF excess, take 1 SF from 5 smallest bays
  // If 3 SF excess, take 1 SF from 3 smallest bays, etc.
  for (let i = 0; i < excess; i++) {
    const bayIndex = bayIndices[i].index;
    const originalSF = updatedBayConfigs[bayIndex].rentableSquareFootage;
    
    updatedBayConfigs[bayIndex] = {
      ...updatedBayConfigs[bayIndex],
      rentableSquareFootage: originalSF - 1
    };
    
    result.adjustedBays.push({
      bayNumber: bayIndices[i].bayNumber,
      originalSF,
      adjustedSF: originalSF - 1,
      reduction: 1
    });
  }
  
  // Verify final total
  const finalTotal = updatedBayConfigs.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0);
  
  result.success = finalTotal === targetTotal;
  result.finalTotal = finalTotal;
  result.message = result.success 
    ? `Successfully adjusted ${excess} SF across ${result.adjustedBays.length} smallest bays. Final total: ${finalTotal} SF`
    : `Adjustment failed. Final total: ${finalTotal} SF does not match target: ${targetTotal} SF`;
  
  return { updatedBayConfigs, result };
}

/**
 * Validates that a property's total rentable area matches legal requirements
 * 
 * @param bayConfigs - Array of bay configurations
 * @param expectedTotal - Expected total square footage
 * @returns Validation result with details
 */
export function validateLegalCompliance(
  bayConfigs: BayConfiguration[], 
  expectedTotal: number
): { isCompliant: boolean; actualTotal: number; variance: number; message: string } {
  
  const actualTotal = bayConfigs.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0);
  const variance = actualTotal - expectedTotal;
  
  return {
    isCompliant: variance === 0,
    actualTotal,
    variance,
    message: variance === 0 
      ? `✅ LEGALLY COMPLIANT: Total ${actualTotal} SF matches required ${expectedTotal} SF`
      : `❌ LEGAL RISK: Total ${actualTotal} SF exceeds allowed ${expectedTotal} SF by ${variance} SF`
  };
}

/**
 * Property-specific legal totals
 * These are the maximum allowable totals for each property to avoid legal issues
 */
/**
 * DEPRECATED — derived from shared/area-utils so it cannot drift.
 *
 * This copy held only TWO of the four published totals, under a third naming
 * convention. It had ALREADY diverged from the other copies, which is precisely
 * the failure a single source prevents.
 */
export const LEGAL_TOTALS = {
  BRIDGE_POINT_GRATIGNY: PROPERTY_LEGAL_TOTALS_BY_ID[1],
  BRIDGE_595_BUILDING_2: PROPERTY_LEGAL_TOTALS_BY_ID[2],
} as const;