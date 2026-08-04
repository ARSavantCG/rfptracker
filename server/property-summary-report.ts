import { COMPANY_NAME } from './lib/branding';
import { db } from './db';
import { properties, executedLeases, propertyExistingImprovements, rfpRequests, transformers, mainPanels } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { formatDateForDisplay } from '../shared/date-utils';
import { defaultElectricalAllocation } from "@shared/electrical-utils";
import { sumBayArea } from "@shared/area-utils";

// Helper function to calculate per-bay cost for spec office (bay-specific items)
function getSpecOfficePerBayCost(improvements: any[], relevantBays: any[], totalSpecOfficeCost: number): number {
  if (totalSpecOfficeCost === 0) return 0;
  
  // Find spec office improvements that are bay-specific
  const specOfficeImprovements = improvements.filter(
    improvement => improvement.category === 'spec-office' && 
    improvement.allocationType === 'bay-specific'
  );
  
  if (specOfficeImprovements.length === 0) {
    // If no bay-specific spec office, fall back to total bays (prorated)
    return totalSpecOfficeCost / Math.max(relevantBays.length, 1);
  }
  
  // Count total applicable bays for all bay-specific spec office improvements
  const totalApplicableBays = specOfficeImprovements.reduce((count, improvement) => {
    return count + (improvement.applicableBays ? improvement.applicableBays.length : 0);
  }, 0);
  
  // Return cost per applicable bay
  return totalApplicableBays > 0 ? totalSpecOfficeCost / totalApplicableBays : totalSpecOfficeCost;
}

// Helper function to calculate cost per SF based on allocation types
function calculateWeightedCostPerSF(improvements: any[], relevantBays: any[], totalRentableArea: number): number {
  if (totalRentableArea === 0 || improvements.length === 0) return 0;
  
  // Calculate weighted cost based on each improvement's allocation method
  let weightedSum = 0;
  let totalWeight = 0;
  
  improvements.forEach(improvement => {
    const costInDollars = improvement.totalCost / 100; // Convert from cents
    let applicableArea = 0;
    
    if (improvement.allocationType === 'bay-specific' && improvement.applicableBays && improvement.applicableBays.length > 0) {
      // For bay-specific improvements, use only the applicable bay area
      applicableArea = relevantBays
        .filter(bay => improvement.applicableBays.includes(bay.id))
        .reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    } else {
      // For prorated/whole-property improvements, use total area
      applicableArea = totalRentableArea;
    }
    
    if (applicableArea > 0) {
      const costPerSF = costInDollars / applicableArea;
      weightedSum += costPerSF * applicableArea;
      totalWeight += applicableArea;
    }
  });
  
  // Return weighted average cost per SF
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// Helper function to format bay numbers with count in parentheses and italics
function formatBayNumbersWithCount(bayNumbers: string): string {
  if (!bayNumbers) return '';
  
  // Extract bay numbers by looking for patterns like "Bay 14-15" or "Bay 1" 
  // and taking only the first number (the starting column line)
  const bayMatches = bayNumbers.match(/Bay\s+(\d+)(?:-\d+)?/g);
  if (!bayMatches || bayMatches.length === 0) {
    // Fallback: extract just the first number from each "Bay X" or "X" pattern
    const simpleMatches = bayNumbers.match(/\b(\d+)\b/g);
    if (!simpleMatches) return bayNumbers;
    
    const numbers = simpleMatches.map(Number).sort((a, b) => a - b);
    const uniqueNumbers = [...new Set(numbers)]; // Remove duplicates
    
    if (uniqueNumbers.length === 1) {
      return `Bay ${uniqueNumbers[0]} <em>(1 bay)</em>`;
    } else if (uniqueNumbers.length === 2) {
      return `Bays ${uniqueNumbers[0]}, ${uniqueNumbers[1]} <em>(2 bays)</em>`;
    } else {
      return `Bays ${uniqueNumbers[0]}-${uniqueNumbers[uniqueNumbers.length - 1]} <em>(${uniqueNumbers.length} bays)</em>`;
    }
  }
  
  // Extract the starting bay number from each "Bay X-Y" pattern
  const startingNumbers = bayMatches.map(match => {
    const numberMatch = match.match(/Bay\s+(\d+)/);
    return numberMatch ? parseInt(numberMatch[1]) : null;
  }).filter(num => num !== null).sort((a, b) => a - b);
  
  const uniqueNumbers = [...new Set(startingNumbers)]; // Remove duplicates
  const bayCount = uniqueNumbers.length;
  
  if (bayCount === 1) {
    return `Bay ${uniqueNumbers[0]} <em>(1 bay)</em>`;
  } else if (bayCount === 2) {
    return `Bays ${uniqueNumbers[0]}, ${uniqueNumbers[1]} <em>(2 bays)</em>`;
  } else {
    // For 3 or more bays, show first through last starting numbers
    return `Bays ${uniqueNumbers[0]}-${uniqueNumbers[uniqueNumbers.length - 1]} <em>(${bayCount} bays)</em>`;
  }
}

interface PropertySummaryData {
  properties: PropertyDetails[];
  generatedAt: string;
  rfpContext?: {
    rfpNumber: string;
    projectName: string;
    tenantName: string;
  };
}

interface RfpOptions {
  rfpId: number;
  propertyId?: number;
}

interface PropertyDetails {
  id: number;
  propertyName: string;
  buildingName?: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  totalBuildings: number;
  totalWarehouseArea: string;
  totalOfficeArea: string;
  totalRentableArea: number;
  parkingSpaces: number;
  trailerParkingSpaces?: number;
  electricalAllocationAmps?: number;
  mechanicalRoomSquareFootage?: number;
  doorCounts?: { standard: number; oversized: number; total: number } | null;
  selectedBayCount?: number;
  bayConfigurations: BayConfig[];
  electricalCapacity: ElectricalConfig[];
  executedLeases: LeaseInfo[];
  buildingSpecs: BuildingSpecsInfo;
  costInPlace: {
    totalCost: number;
    costPerSF: number;
    lastUpdated: string;
    fireAlarm?: number;
    ventilation?: number;
    plumbing?: number;
    electrical?: number;
    flooring?: number;
    lighting?: number;
    security?: number;
    hvac?: number;
    other?: number;
    specOfficePerBay?: number;
  };
}

interface BayConfig {
  bayNumber: string;
  rentableSquareFootage: number;
  clearHeight: string;
  dockDoors: number;
  gradeLevel: number;
  sprinkler: string;
  office: string;
  notes: string;
}

interface PanelInfo {
  panelName: string;
  voltage: string;
  capacityAmps: number;
  capacityKva: number;
  location: string;
}

interface ElectricalConfig {
  transformerName: string;
  capacity: number;
  allocated: number;
  available: number;
  utilizationPercentage: number;
  panels: PanelInfo[];
}

interface LeaseInfo {
  tenantName: string;
  leaseStartDate: string;
  leaseEndDate: string;
  rentableSquareFootage: number;
  bayNumbers: string;
}

interface BuildingSpecsInfo {
  structuralSpecs: any;
  operationalSpecs: any;
  safetySpecs: any;
  lastUpdated: string;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

async function getPropertySummaryData(options?: RfpOptions): Promise<PropertySummaryData> {
  let rfpContext;
  let targetPropertyId;
  let selectedBayConfigurations;
  
  // Fetch RFP data if in RFP mode
  if (options?.rfpId) {
    const rfp = await db
      .select()
      .from(rfpRequests)
      .where(eq(rfpRequests.id, options.rfpId))
      .limit(1);
      
    if (rfp.length > 0) {
      rfpContext = {
        rfpNumber: rfp[0].rfpNumber,
        projectName: rfp[0].projectName,
        tenantName: rfp[0].tenantName
      };
      selectedBayConfigurations = rfp[0].selectedBayConfigurations || [];
      targetPropertyId = options.propertyId || parseInt(rfp[0].property);
    }
  }
  
  // Filter properties based on RFP context or get all
  const allProperties = targetPropertyId
    ? await db
        .select()
        .from(properties)
        .where(eq(properties.id, targetPropertyId))
    : await db
        .select()
        .from(properties)
        .orderBy(properties.displayOrder);

  const propertyDetails: PropertyDetails[] = [];

  // Calculate actual building counts per property name
  const buildingCounts: { [propertyName: string]: number } = {};
  allProperties.forEach(property => {
    const name = property.propertyName;
    buildingCounts[name] = (buildingCounts[name] || 0) + 1;
  });
  
  
  // Calculate door counts from selected bay configurations (RFP mode only)
  const calculateDoorCounts = (selectedBays: any[]) => {
    if (!selectedBays || selectedBays.length === 0) return { standard: 0, oversized: 0, total: 0 };
    
    const standard = selectedBays.reduce((sum, bay) => sum + (bay.standardDockDoors || 0), 0);
    const oversized = selectedBays.reduce((sum, bay) => sum + (bay.oversizedDockDoors || 0), 0);
    
    return { standard, oversized, total: standard + oversized };
  };
  
  // Calculate parking allocation from selected bay configurations (RFP mode only)
  const calculateParkingAllocation = (property: any, selectedBays: any[]) => {
    if (!selectedBays || selectedBays.length === 0) {
      return { vehicular: 0, trailer: 0 };
    }
    
    // Calculate tenant's rentable area
    const tenantArea = selectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
    // Total property area from bay configurations, via shared/area-utils.
    //
    // WAS: parseFloat(property.rentableSquareFootage || '0'). There is no
    // rentableSquareFootage column on the properties table, so this was always
    // parseFloat('0') === 0, the guard below always fired, and this function
    // ALWAYS returned zero parking. Every proportional line beneath it was
    // unreachable, and the printed summary reported 0 vehicular and 0 trailer
    // parking for every tenant on every property.
    //
    // calculateElectricalAllocation, immediately below, already derived its
    // denominator from bayConfigurations correctly - the two adjacent functions
    // disagreed.
    const totalPropertyArea = sumBayArea(property.bayConfigurations || []);
    
    if (totalPropertyArea === 0 || tenantArea === 0) {
      return { vehicular: 0, trailer: 0 };
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = tenantArea / totalPropertyArea;
    
    // Calculate proportional parking allocation
    const totalVehicular = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalTrailer = property.trailerParking || 0;
    
    return {
      vehicular: Math.round(totalVehicular * tenantPercentage),
      trailer: Math.round(totalTrailer * tenantPercentage)
    };
  };
  
  // Calculate electrical allocation from selected bay configurations (RFP mode only)
  // When selectedBays is empty array, returns 0 (tenant has no allocation)
  // For full property view (no RFP), pass null to get full property allocation
  const calculateElectricalAllocation = (property: any, selectedBays: any[] | null) => {
    // If null is passed, return full property allocation (non-RFP mode)
    if (selectedBays === null) {
      return property.electricalAllocation || 0;
    }
    
    // If empty array, tenant has no selected bays = 0 allocation (RFP mode)
    if (selectedBays.length === 0) {
      return 0;
    }
    
    // Calculate tenant's rentable area
    const tenantArea = selectedBays.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
    // Get total property area from bay configurations
    const bayConfigs = property.bayConfigurations || [];
    const totalPropertyArea = bayConfigs.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
    if (totalPropertyArea === 0 || tenantArea === 0) {
      return 0;
    }
    
    // Calculate tenant's percentage of the property
    const tenantPercentage = tenantArea / totalPropertyArea;
    
    // Shared helper - see shared/electrical-utils. Previously a fifth independent
    // copy of this calculation, and one that rounded UP where the client surfaces
    // now round DOWN, so a printed property summary could disagree with the
    // evaluation and lease screens for the same tenant.
    // tenantPercentage is a 0-1 fraction here; the helper takes 0-100.
    return defaultElectricalAllocation({
      buildingTotalAmps: property.electricalAllocation || 0,
      tenantSharePercent: tenantPercentage * 100,
      increment: property.electricalAllocationIncrement || 200,
      minimum: property.electricalAllocationMinimum ?? 200,
    });
  };

  for (const property of allProperties) {
    // Get executed leases
    const leases = await db
      .select()
      .from(executedLeases)
      .where(eq(executedLeases.propertyId, property.id))
      .orderBy(executedLeases.tenantName);

    // Get existing improvements (cost data)
    const improvements = await db
      .select()
      .from(propertyExistingImprovements)
      .where(eq(propertyExistingImprovements.propertyId, property.id));

    // Get electrical capacity data - transformers and panels
    const propertyTransformers = await db
      .select()
      .from(transformers)
      .where(eq(transformers.propertyId, property.id));
    
    const allPanels = await db
      .select()
      .from(mainPanels);
    
    // Helper function to normalize voltage string to base number
    const normalizeVoltage = (voltage: string): string => {
      // Handle various formats: "480", "480V", "208/120V", "208", "240V", "240"
      const v = (voltage || '480').replace(/[Vv]/g, '').trim();
      if (v.startsWith('208') || v === '120') return '208';
      if (v.startsWith('240')) return '240';
      if (v.startsWith('480')) return '480';
      return '480'; // Default fallback
    };
    
    // Helper function to convert kVA to AMPS based on voltage (3-phase systems)
    const kvaToAmps = (kva: number, voltage: string = '480'): number => {
      const normalizedVoltage = normalizeVoltage(voltage);
      const voltageMultipliers: Record<string, number> = {
        '480': 480 * Math.sqrt(3),
        '208': 208 * Math.sqrt(3),
        '240': 240 * Math.sqrt(3)
      };
      const multiplier = voltageMultipliers[normalizedVoltage] || voltageMultipliers['480'];
      return Math.round((kva * 1000) / multiplier);
    };
    
    // Build electrical capacity with panels grouped by transformer
    const electricalCapacity: ElectricalConfig[] = propertyTransformers.map(transformer => {
      const transformerPanels = allPanels.filter(p => p.transformerId === transformer.id);
      const allocatedKva = transformerPanels.reduce((sum, p) => sum + p.maxCapacityKva, 0);
      
      return {
        transformerName: transformer.transformerName,
        capacity: transformer.totalCapacityKva,
        allocated: allocatedKva,
        available: Math.max(0, transformer.totalCapacityKva - allocatedKva),
        utilizationPercentage: transformer.totalCapacityKva > 0 ? (allocatedKva / transformer.totalCapacityKva) * 100 : 0,
        panels: transformerPanels.map(panel => {
          const voltage = panel.voltage || '480';
          return {
            panelName: panel.panelName,
            voltage: voltage,
            capacityAmps: panel.capacityAmps || kvaToAmps(panel.maxCapacityKva, voltage),
            capacityKva: panel.maxCapacityKva,
            location: panel.panelLocation || ''
          };
        })
      };
    });

    // Calculate totals - use selected bays in RFP mode, all bays otherwise
    const bayConfigs = property.bayConfigurations || [];
    const relevantBays = selectedBayConfigurations && selectedBayConfigurations.length > 0 ? selectedBayConfigurations : bayConfigs;
    const totalRentableArea = relevantBays.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
    // Calculate door counts, parking allocation, and electrical allocation for RFP mode
    const doorCounts = selectedBayConfigurations ? calculateDoorCounts(selectedBayConfigurations) : null;
    const parkingAllocation = selectedBayConfigurations ? calculateParkingAllocation(property, selectedBayConfigurations) : null;
    // Pass null for non-RFP mode (shows full property allocation), or the actual array for RFP mode
    const electricalAllocation = calculateElectricalAllocation(property, selectedBayConfigurations || null);
    
    // Calculate cost breakdown from actual data
    const costBreakdown = {
      fireAlarm: 0,
      ventilation: 0,
      plumbing: 0, // Restrooms
      lighting: 0, // LED Warehouse Lighting
      other: 0 // Speculative Office
    };

    let totalImprovementCost = 0;
    let baySpecificCostTotal = 0; // Track bay-specific costs separately
    let baySpecificAreaTotal = 0; // Track area for bay-specific improvements
    
    improvements.forEach(improvement => {
      const costInDollars = improvement.totalCost / 100; // Convert from cents
      totalImprovementCost += costInDollars;
      
      // If it's bay-specific, calculate area for only applicable bays
      if (improvement.allocationType === 'bay-specific' && improvement.applicableBays && improvement.applicableBays.length > 0) {
        baySpecificCostTotal += costInDollars;
        
        // Calculate area for only the applicable bays
        const applicableBayArea = relevantBays
          .filter(bay => improvement.applicableBays.includes(bay.id))
          .reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
        
        baySpecificAreaTotal += applicableBayArea;
      }
      
      switch (improvement.category) {
        case 'fire-alarm':
          costBreakdown.fireAlarm += costInDollars;
          break;
        case 'hvac':
          costBreakdown.ventilation += costInDollars;
          break;
        case 'restrooms':
          costBreakdown.plumbing += costInDollars;
          break;
        case 'lighting':
          costBreakdown.lighting += costInDollars;
          break;
        case 'spec-office':
          costBreakdown.other += costInDollars;
          break;
      }
    });

    // Assign building names/numbers dynamically based on database building field
    let buildingName = '';
    
    // Use the building field from database if available
    if (property.building) {
      buildingName = property.building.toString();
    }
    
    // Special case for Bridge 595 Building A (only override if it's Bridge 595 specifically)
    if (property.propertyName === 'Bridge 595') {
      buildingName = 'A';
    }
    
    // Note: Single building properties (isSingleBuilding=true) don't show building numbers

    propertyDetails.push({
      id: property.id,
      propertyName: property.propertyName,
      buildingName: buildingName,
      address: property.streetAddress || '',
      city: property.city || '',
      state: property.state || '',
      zipCode: property.zip || '',
      totalBuildings: buildingCounts[property.propertyName] || 1,
      totalWarehouseArea: totalRentableArea.toString(),
      totalOfficeArea: (property.mechanicalRoomSquareFootage || 0).toString(), // Use mechanical room as office proxy if available
      totalRentableArea,
      parkingSpaces: parkingAllocation ? parkingAllocation.vehicular : ((property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0)),
      trailerParkingSpaces: parkingAllocation ? parkingAllocation.trailer : (property.trailerParking || 0),
      electricalAllocationAmps: electricalAllocation,
      doorCounts: doorCounts,
      selectedBayCount: selectedBayConfigurations ? selectedBayConfigurations.length : bayConfigs.length,
      mechanicalRoomSquareFootage: property.mechanicalRoomSquareFootage || 0,
      bayConfigurations: relevantBays.map((bay: any) => ({
        bayNumber: bay.bayName || bay.id || '',
        rentableSquareFootage: bay.rentableSquareFootage || bay.squareFootage || 0,
        clearHeight: property.clearHeight || '',
        dockDoors: (bay.standardDockDoors || 0) + (bay.oversizedDockDoors || 0),
        gradeLevel: 0, // Not tracked in current schema
        sprinkler: property.fireSprinklerInfo || '',
        office: property.mechanicalRoomSquareFootage ? 'Office space available' : 'Warehouse only',
        notes: bay.notes || ''
      })),
      electricalCapacity: electricalCapacity, // Real data from transformers and panels tables
      executedLeases: leases.map((lease: any) => ({
        tenantName: lease.tenantName,
        leaseStartDate: formatDateForDisplay(lease.leaseStartDate),
        leaseEndDate: formatDateForDisplay(lease.leaseEndDate),
        rentableSquareFootage: lease.rentableSquareFootage || 0,
        bayNumbers: lease.bayNumbers || ''
      })),
      buildingSpecs: {
        structuralSpecs: {
          'Slab Thickness': property.slabThickness || 'Not specified',
          'Clear Height': property.clearHeight || 'Not specified',
          'Floor Flatness': property.floorFlatness || 'Not specified',
          'Truck Apron Slab': property.truckApronSlab || 'Not specified',
          'Ramp Capacity': property.rampCapacity || 'Not specified'
        },
        operationalSpecs: {
          'Roof R-Value': property.roofRValue || 'Not specified',
          'Fire Pump': property.firePumpInfo || 'Not specified',
          'Fire Sprinkler': property.fireSprinklerInfo || 'Not specified'
        },
        safetySpecs: {
          'Fire Protection': property.fireSprinklerInfo || 'Not specified'
        },
        lastUpdated: formatDateForDisplay(property.updatedAt)
      },
      costInPlace: {
        totalCost: totalImprovementCost,
        costPerSF: calculateWeightedCostPerSF(improvements, relevantBays, totalRentableArea),
        lastUpdated: improvements.length > 0 ? formatDateForDisplay(Math.max(...improvements.map(i => new Date(i.updatedAt).getTime()))) : 'No data',
        fireAlarm: costBreakdown.fireAlarm,
        ventilation: costBreakdown.ventilation,
        plumbing: costBreakdown.plumbing,
        lighting: costBreakdown.lighting,
        other: costBreakdown.other,
        specOfficePerBay: getSpecOfficePerBayCost(improvements, relevantBays, costBreakdown.other)
      }
    });
  }

  return {
    properties: propertyDetails,
    generatedAt: formatDateForDisplay(new Date()),
    rfpContext
  };
}

function generatePropertySummaryHTML(data: PropertySummaryData): string {
  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Property Summary Report - All Properties</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f7fa;
            color: #333;
        }
        
        .header {
            background: linear-gradient(135deg, #003282 0%, #0056b3 100%);
            color: white;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            box-shadow: 0 2px 8px rgba(0, 50, 130, 0.2);
        }
        
        .header h1 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 300;
            text-align: center;
        }
        
        .header .subtitle {
            text-align: center;
            margin-top: 5px;
            opacity: 0.9;
            font-size: 0.55rem;
        }
        
        .property-section {
            background: white;
            border-radius: 6px;
            margin-bottom: 20px;
            box-shadow: 0 1px 5px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .property-header {
            background: #003282;
            color: white;
            padding: 10px 15px;
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .property-content {
            padding: 15px;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(125px, 1fr));
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .info-card {
            background: #f8f9fa;
            border-radius: 4px;
            padding: 10px;
            border-left: 2px solid #003282;
        }
        
        .info-card h4 {
            margin: 0 0 5px 0;
            color: #003282;
            font-size: 0.55rem;
        }
        
        .info-card p {
            margin: 2px 0;
            font-size: 0.475rem;
        }
        
        .subsection {
            margin-bottom: 20px;
        }
        
        .subsection h3 {
            color: #003282;
            border-bottom: 1px solid #e9ecef;
            padding-bottom: 5px;
            margin-bottom: 10px;
            font-size: 0.7rem;
        }
        
        .table-container {
            overflow-x: auto;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
        }
        
        th {
            background: #003282;
            color: white;
            padding: 6px 5px;
            text-align: left;
            font-weight: 600;
            font-size: 0.45rem;
            border: none;
        }
        
        td {
            padding: 5px;
            border-bottom: 1px solid #e9ecef;
            font-size: 0.45rem;
        }
        
        tr:hover {
            background-color: #f8f9fa;
        }
        
        .metric-value {
            font-weight: 600;
            color: #003282;
        }
        
        .footer {
            text-align: center;
            padding: 30px;
            color: #666;
            font-size: 0.9rem;
            border-top: 1px solid #e9ecef;
            margin-top: 40px;
        }
        
        .no-data {
            text-align: center;
            color: #666;
            font-style: italic;
            padding: 20px;
        }
        
        @media print {
            body { background: white; }
            .property-section { page-break-after: always; }
            .header { background: #003282 !important; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${data.rfpContext ? `RFP Property Summary - ${data.rfpContext.rfpNumber}` : 'Property Portfolio Summary Report'}</h1>
        <div class="subtitle">${data.rfpContext ? `${data.rfpContext.projectName} | Tenant: ${data.rfpContext.tenantName}` : 'Comprehensive Property Information & Analysis'}</div>
        <div class="subtitle">Generated: ${data.generatedAt}</div>
    </div>
`;

  data.properties.forEach(property => {
    html += `
    <div class="property-section">
        <div class="property-header">
            ${property.propertyName} ${property.building ? `- Building ${property.building}` : ''}
        </div>
        <div class="property-content">
            <!-- Property Overview -->
            <div class="info-grid">
                <div class="info-card">
                    <h4>Location</h4>
                    <p><strong>Address:</strong> ${property.address}</p>
                    <p><strong>City:</strong> ${property.city}</p>
                    <p><strong>State:</strong> ${property.state}</p>
                    <p><strong>ZIP:</strong> ${property.zipCode}</p>
                </div>
                <div class="info-card">
                    <h4>Building Information</h4>
                    <p><strong>Total Buildings:</strong> ${property.totalBuildings}</p>
                    <p><strong>Warehouse Area:</strong> ${formatNumber(parseInt(property.totalWarehouseArea))} SF</p>
                    <p><strong>Mechanical Room:</strong> ${formatNumber(property.mechanicalRoomSquareFootage || 0)} SF</p>
                    ${property.doorCounts ? `
                    <p><strong>Standard Dock Doors:</strong> ${property.doorCounts.standard}</p>
                    <p><strong>Oversized Dock Doors:</strong> ${property.doorCounts.oversized}</p>
                    <p><strong>Total Dock Doors:</strong> ${property.doorCounts.total}</p>
                    ` : ''}
                    <p><strong>Vehicular Parking:</strong> ${formatNumber(property.parkingSpaces)}${property.doorCounts ? ' (tenant allocation)' : ''}</p>
                    <p><strong>Trailer Parking:</strong> ${formatNumber(property.trailerParkingSpaces || 0)}${property.doorCounts ? ' (tenant allocation)' : ''}</p>
                    <p><strong>Electrical Allocation:</strong> ${formatNumber(property.electricalAllocationAmps || 0)} AMPS${property.doorCounts ? ' (tenant allocation)' : ''}</p>
                </div>
                <div class="info-card">
                    <h4>Area Summary</h4>
                    <p><strong>${property.doorCounts ? 'Tenant' : 'Total'} Rentable SF:</strong> <span class="metric-value">${formatNumber(property.totalRentableArea)}</span></p>
                    <p><strong>${property.doorCounts ? 'Selected' : 'Total'} Bays:</strong> ${property.selectedBayCount || property.bayConfigurations.length}</p>
                    <p><strong>Active Leases:</strong> ${property.executedLeases.length}</p>
                </div>
                <div class="info-card">
                    <h4>Costs of Work in Place</h4>
                    <p><strong>Total Cost:</strong> <span class="metric-value">${formatCurrency(property.costInPlace.totalCost)}</span></p>
                    <p><strong>Cost per SF:</strong> <span class="metric-value">${formatCurrency(property.costInPlace.costPerSF)}</span></p>
                    <p><strong>Last Updated:</strong> ${property.costInPlace.lastUpdated}</p>
                </div>
            </div>
            
            <!-- Cost Breakdown Details (TI/Improvement Costs) -->
            <div class="subsection">
                <h3>Cost Breakdown Details</h3>
                <div class="info-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
                    <div class="info-card">
                        <h4>Restrooms</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.plumbing || 0)}</p>
                        <p><strong>Per Bay:</strong> ${formatCurrency((property.costInPlace.plumbing || 0) / Math.max(property.bayConfigurations.length, 1))}</p>
                    </div>

                    <div class="info-card">
                        <h4>LED Warehouse Lighting</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.lighting || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.lighting || 0) / (property.totalRentableArea || 1))}</p>
                    </div>

                    <div class="info-card">
                        <h4>Speculative Office</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.other || 0)}</p>
                        <p><strong>Per Bay:</strong> ${formatCurrency(property.costInPlace.specOfficePerBay || 0)}</p>
                    </div>
                </div>
            </div>
            
            <!-- Bay Summary -->
            <div class="subsection">
                <h3>Bay Summary</h3>
                <div class="info-grid" style="grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));">
                    <div class="info-card">
                        <h4>Total Bays</h4>
                        <p class="metric-value">${property.bayConfigurations.length}</p>
                    </div>
                    <div class="info-card">
                        <h4>Largest Bay</h4>
                        <p class="metric-value">${property.bayConfigurations.length > 0 ? formatNumber(Math.max(...property.bayConfigurations.map(bay => bay.rentableSquareFootage))) : 0} SF</p>
                    </div>
                    <div class="info-card">
                        <h4>Smallest Bay</h4>
                        <p class="metric-value">${property.bayConfigurations.length > 0 ? formatNumber(Math.min(...property.bayConfigurations.map(bay => bay.rentableSquareFootage))) : 0} SF</p>
                    </div>
                </div>
            </div>
            
            <!-- Electrical Capacity -->
            <div class="subsection">
                <h3>Electrical Capacity</h3>
                ${property.electricalCapacity.length > 0 ? `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Transformer</th>
                                <th>Total Capacity</th>
                                <th>Allocated</th>
                                <th>Available</th>
                                <th>Utilization</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${property.electricalCapacity.map(elec => `
                            <tr>
                                <td><strong>${elec.transformerName}</strong></td>
                                <td class="metric-value">${formatNumber(elec.capacity)} kVA</td>
                                <td>${formatNumber(elec.allocated)} kVA</td>
                                <td class="metric-value">${formatNumber(elec.available)} kVA</td>
                                <td>${elec.utilizationPercentage.toFixed(1)}%</td>
                            </tr>
                            ${elec.panels.length > 0 ? `
                            <tr>
                                <td colspan="5" style="padding: 0; background: #f8f9fa;">
                                    <table style="width: 100%; margin: 0; border: none;">
                                        <thead>
                                            <tr style="background: #e9ecef;">
                                                <th style="padding: 4px 8px; font-size: 11px;">Panel</th>
                                                <th style="padding: 4px 8px; font-size: 11px;">Voltage</th>
                                                <th style="padding: 4px 8px; font-size: 11px;">Capacity (AMPS)</th>
                                                <th style="padding: 4px 8px; font-size: 11px;">Capacity (kVA)</th>
                                                <th style="padding: 4px 8px; font-size: 11px;">Location</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${elec.panels.map(panel => `
                                            <tr>
                                                <td style="padding: 4px 8px; font-size: 11px;">${panel.panelName}</td>
                                                <td style="padding: 4px 8px; font-size: 11px;">${panel.voltage}V</td>
                                                <td style="padding: 4px 8px; font-size: 11px;">${formatNumber(panel.capacityAmps)} AMPS</td>
                                                <td style="padding: 4px 8px; font-size: 11px;">${panel.capacityKva.toFixed(1)} kVA</td>
                                                <td style="padding: 4px 8px; font-size: 11px;">${panel.location || 'N/A'}</td>
                                            </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </td>
                            </tr>
                            ` : ''}
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ` : '<div class="no-data">No electrical capacity data available</div>'}
            </div>
            
            <!-- Executed Leases -->
            <div class="subsection">
                <h3>Executed Leases</h3>
                ${property.executedLeases.length > 0 ? `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Tenant</th>
                                <th>Lease Start</th>
                                <th>Lease End</th>
                                <th>Rentable SF</th>
                                <th>Bay Numbers</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${property.executedLeases.map(lease => `
                            <tr>
                                <td><strong>${lease.tenantName}</strong></td>
                                <td>${lease.leaseStartDate}</td>
                                <td>${lease.leaseEndDate}</td>
                                <td class="metric-value">${formatNumber(lease.rentableSquareFootage)}</td>
                                <td>${formatBayNumbersWithCount(lease.bayNumbers)}</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ` : '<div class="no-data">No executed leases available</div>'}
            </div>

            <!-- Building Specifications -->
            <div class="subsection">
                <h3>Building Specifications <span style="font-size: 50%;">(Last Updated: ${formatDateForDisplay(property.buildingSpecs.lastUpdated) || 'Not Available'})</span></h3>
                <div class="info-grid">
                    <div class="info-card">
                        <h4>Structural Specifications</h4>
                        ${Object.keys(property.buildingSpecs.structuralSpecs).length > 0 ? 
                            Object.entries(property.buildingSpecs.structuralSpecs).map(([key, value]) => 
                                `<p><strong>${key}:</strong> ${value}</p>`
                            ).join('') : 
                            '<p class="no-data">No structural specifications available</p>'
                        }
                    </div>
                    <div class="info-card">
                        <h4>Operational Specifications</h4>
                        ${Object.keys(property.buildingSpecs.operationalSpecs).length > 0 ? 
                            Object.entries(property.buildingSpecs.operationalSpecs).map(([key, value]) => 
                                `<p><strong>${key}:</strong> ${value}</p>`
                            ).join('') : 
                            '<p class="no-data">No operational specifications available</p>'
                        }
                        ${Object.keys(property.buildingSpecs.safetySpecs).length > 0 ? 
                            Object.entries(property.buildingSpecs.safetySpecs).map(([key, value]) => 
                                `<p><strong>${key}:</strong> ${value}</p>`
                            ).join('') : 
                            ''
                        }
                    </div>


                </div>
            </div>
        </div>
    </div>
    `;
  });

  html += `
    <div class="footer">
        <p>Property Portfolio Summary Report | Generated: ${data.generatedAt}</p>
        <p>© 2026 ${COMPANY_NAME} | All Rights Reserved</p>
    </div>
</body>
</html>
`;

  return html;
}

export async function generatePropertySummaryReport(options?: RfpOptions): Promise<string> {
  console.log('Starting property summary report generation...', options ? 'in RFP mode' : 'for all properties');
  
  const data = await getPropertySummaryData(options);
  console.log(`Property summary data retrieved: ${data.properties.length} properties`);
  
  const html = generatePropertySummaryHTML(data);
  console.log(`HTML generated, length: ${html.length}`);
  
  return html;
}