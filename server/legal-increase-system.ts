/**
 * Legal Compliance Increase System
 * 
 * For cases where the property total needs to be INCREASED to meet legal requirements
 * (opposite of the rounding system which decreases totals)
 */

export interface BayConfiguration {
  bayNumber: string;
  rentableSquareFootage: number;
  [key: string]: any;
}

export interface LegalIncreaseResult {
  success: boolean;
  originalTotal: number;
  finalTotal: number;
  adjustedBays: Array<{
    bayNumber: string;
    originalSF: number;
    adjustedSF: number;
    increase: number;
  }>;
  message: string;
}

/**
 * Applies legal compliance by INCREASING bay sizes to reach target total
 * 
 * Distributes the needed increase across the largest bays in descending order
 * When bays have the same size, prioritizes by bay number order
 * 
 * @param bayConfigs - Array of bay configurations to adjust
 * @param targetTotal - Target total square footage
 * @returns Updated bay configurations and adjustment result
 */
export function applyLegalIncrease(
  bayConfigs: BayConfiguration[], 
  targetTotal: number
): { updatedBayConfigs: BayConfiguration[]; result: LegalIncreaseResult } {
  
  const originalTotal = bayConfigs.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0);
  const shortage = targetTotal - originalTotal;
  
  const result: LegalIncreaseResult = {
    success: false,
    originalTotal,
    finalTotal: originalTotal,
    adjustedBays: [],
    message: ''
  };
  
  // If no shortage, no adjustment needed
  if (shortage <= 0) {
    result.success = true;
    result.message = `No adjustment needed. Total: ${originalTotal} SF matches or exceeds target: ${targetTotal} SF`;
    return { updatedBayConfigs: bayConfigs, result };
  }
  
  // If shortage is greater than number of bays, we cannot distribute evenly
  if (shortage > bayConfigs.length) {
    // We can still distribute, but some bays will get more than 1 SF
    console.log(`Note: Distributing ${shortage} SF across ${bayConfigs.length} bays (some bays will get multiple SF)`);
  }
  
  // Sort bays by square footage (descending), then by bay number (ascending) for ties
  // This ensures we add to the largest bays first, with consistent selection for ties
  const bayIndices = bayConfigs.map((bay, index) => ({
    index,
    sf: bay.rentableSquareFootage,
    bayNumber: bay.bayNumber
  })).sort((a, b) => {
    // Primary sort: by square footage (largest first)
    if (a.sf !== b.sf) {
      return b.sf - a.sf;
    }
    // Secondary sort: by bay number (Bay 1, Bay 2, etc.) for ties
    // Extract numeric part from bay number for proper sorting
    const aBayNum = parseInt(a.bayNumber.split('-')[0]);
    const bBayNum = parseInt(b.bayNumber.split('-')[0]);
    return aBayNum - bBayNum;
  });
  
  // Create updated configurations
  const updatedBayConfigs = [...bayConfigs];
  
  // Distribute shortage across bays
  // Start with 1 SF per bay, then distribute remainder
  const baseSFPerBay = Math.floor(shortage / bayConfigs.length);
  const remainderSF = shortage % bayConfigs.length;
  
  for (let i = 0; i < bayConfigs.length; i++) {
    const bayIndex = bayIndices[i].index;
    const originalSF = updatedBayConfigs[bayIndex].rentableSquareFootage;
    
    // Each bay gets at least the base amount
    let increase = baseSFPerBay;
    
    // First few bays get the remainder SF (1 extra SF each)
    if (i < remainderSF) {
      increase += 1;
    }
    
    if (increase > 0) {
      updatedBayConfigs[bayIndex] = {
        ...updatedBayConfigs[bayIndex],
        rentableSquareFootage: originalSF + increase
      };
      
      result.adjustedBays.push({
        bayNumber: bayIndices[i].bayNumber,
        originalSF,
        adjustedSF: originalSF + increase,
        increase
      });
    }
  }
  
  // Verify final total
  const finalTotal = updatedBayConfigs.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0);
  
  result.success = finalTotal === targetTotal;
  result.finalTotal = finalTotal;
  result.message = result.success 
    ? `Successfully increased ${shortage} SF across ${result.adjustedBays.length} largest bays. Final total: ${finalTotal} SF`
    : `Increase failed. Final total: ${finalTotal} SF does not match target: ${targetTotal} SF`;
  
  return { updatedBayConfigs, result };
}