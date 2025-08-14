import { db } from './db';
import { properties, executedLeases } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { formatDateForDisplay } from '../shared/date-utils';

interface PropertySummaryData {
  properties: PropertyDetails[];
  generatedAt: string;
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
  mechanicalRoomSquareFootage?: number;
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

interface ElectricalConfig {
  transformerName: string;
  capacity: number;
  allocated: number;
  available: number;
  utilizationPercentage: number;
}

interface LeaseInfo {
  tenantName: string;
  leaseStartDate: string;
  leaseEndDate: string;
  rentableSquareFootage: number;
  monthlyRent: number;
  rentPerSquareFoot: number;
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

async function getPropertySummaryData(): Promise<PropertySummaryData> {
  const allProperties = await db
    .select()
    .from(properties)
    .orderBy(properties.propertyName);

  const propertyDetails: PropertyDetails[] = [];

  for (const property of allProperties) {
    // Get executed leases
    const leases = await db
      .select()
      .from(executedLeases)
      .where(eq(executedLeases.propertyId, property.id))
      .orderBy(executedLeases.tenantName);

    // Calculate totals from bay configurations stored in JSON
    const bayConfigs = property.bayConfigurations || [];
    const totalRentableArea = bayConfigs.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
    
    // Calculate cost in place (placeholder - you may want to implement actual cost tracking)
    const estimatedCostPerSF = 75; // Placeholder - replace with actual cost data
    const totalCost = totalRentableArea * estimatedCostPerSF;

    propertyDetails.push({
      id: property.id,
      propertyName: property.propertyName,
      address: property.streetAddress || '',
      city: property.city || '',
      state: property.state || '',
      zipCode: property.zip || '',
      totalBuildings: property.isSingleBuilding ? 1 : 2,
      totalWarehouseArea: totalRentableArea.toString(),
      totalOfficeArea: '0', // Not tracked in current schema
      totalRentableArea,
      parkingSpaces: (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0) + (property.trailerParking || 0),
      bayConfigurations: bayConfigs.map((bay: any) => ({
        bayNumber: bay.bayName || bay.id || '',
        rentableSquareFootage: bay.rentableSquareFootage || bay.squareFootage || 0,
        clearHeight: property.clearHeight || '',
        dockDoors: (bay.standardDockDoors || 0) + (bay.oversizedDockDoors || 0),
        gradeLevel: 0, // Not tracked in current schema
        sprinkler: property.fireSprinklerInfo || '',
        office: '',
        notes: ''
      })),
      electricalCapacity: [], // Not implemented in current schema
      executedLeases: leases.map((lease: any) => ({
        tenantName: lease.tenantName,
        leaseStartDate: formatDateForDisplay(lease.leaseStartDate),
        leaseEndDate: formatDateForDisplay(lease.leaseEndDate),
        rentableSquareFootage: lease.rentableSquareFootage || 0,
        monthlyRent: parseFloat(lease.monthlyRent || '0'),
        rentPerSquareFoot: lease.rentableSquareFootage ? 
          (parseFloat(lease.monthlyRent || '0') / (lease.rentableSquareFootage || 1)) : 0,
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
        totalCost,
        costPerSF: estimatedCostPerSF,
        lastUpdated: 'Estimated' // Replace with actual cost tracking date
      }
    });
  }

  return {
    properties: propertyDetails,
    generatedAt: formatDateForDisplay(new Date())
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
        <h1>Property Portfolio Summary Report</h1>
        <div class="subtitle">Comprehensive Property Information & Analysis</div>
        <div class="subtitle">Generated: ${data.generatedAt}</div>
    </div>
`;

  data.properties.forEach(property => {
    html += `
    <div class="property-section">
        <div class="property-header">
            ${property.propertyName} ${property.buildingName ? `- ${property.buildingName}` : ''}
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
                    <p><strong>Vehicular Parking:</strong> ${formatNumber(property.parkingSpaces)}</p>
                    <p><strong>Trailer Parking:</strong> ${formatNumber(property.trailerParkingSpaces || 0)}</p>
                </div>
                <div class="info-card">
                    <h4>Area Summary</h4>
                    <p><strong>Total Rentable SF:</strong> <span class="metric-value">${formatNumber(property.totalRentableArea)}</span></p>
                    <p><strong>Total Bays:</strong> ${property.bayConfigurations.length}</p>
                    <p><strong>Active Leases:</strong> ${property.executedLeases.length}</p>
                </div>
                <div class="info-card">
                    <h4>Costs of Work in Place</h4>
                    <p><strong>Total Cost:</strong> <span class="metric-value">${formatCurrency(property.costInPlace.totalCost)}</span></p>
                    <p><strong>Cost per SF:</strong> <span class="metric-value">${formatCurrency(property.costInPlace.costPerSF)}</span></p>
                    <p><strong>Last Updated:</strong> ${formatDateForDisplay(property.costInPlace.lastUpdated) || 'Not Available'}</p>
                </div>
            </div>
            
            <!-- Cost Breakdown Details (TI/Improvement Costs) -->
            <div class="subsection">
                <h3>Cost Breakdown Details</h3>
                <div class="info-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));">
                    <div class="info-card">
                        <h4>Fire Alarm</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.fireAlarm || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.fireAlarm || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Ventilation</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.ventilation || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.ventilation || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Plumbing</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.plumbing || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.plumbing || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Electrical</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.electrical || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.electrical || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Flooring</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.flooring || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.flooring || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Lighting</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.lighting || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.lighting || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Security</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.security || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.security || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>HVAC</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.hvac || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.hvac || 0) / (property.totalRentableArea || 1))}</p>
                    </div>
                    <div class="info-card">
                        <h4>Other</h4>
                        <p class="metric-value">${formatCurrency(property.costInPlace.other || 0)}</p>
                        <p><strong>Per SF:</strong> ${formatCurrency((property.costInPlace.other || 0) / (property.totalRentableArea || 1))}</p>
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
                        <h4>Average Bay Size</h4>
                        <p class="metric-value">${property.bayConfigurations.length > 0 ? formatNumber(Math.round(property.bayConfigurations.reduce((sum, bay) => sum + bay.rentableSquareFootage, 0) / property.bayConfigurations.length)) : 0} SF</p>
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
                                <td class="metric-value">${formatNumber(elec.capacity)} kW</td>
                                <td>${formatNumber(elec.allocated)} kW</td>
                                <td class="metric-value">${formatNumber(elec.available)} kW</td>
                                <td>${elec.utilizationPercentage}%</td>
                            </tr>
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
                                <th>Monthly Rent</th>
                                <th>Rent/SF</th>
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
                                <td class="metric-value">${formatCurrency(lease.monthlyRent)}</td>
                                <td class="metric-value">${formatCurrency(lease.rentPerSquareFoot)}</td>
                                <td>${lease.bayNumbers}</td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ` : '<div class="no-data">No executed leases available</div>'}
            </div>
            
            <!-- Building Specifications -->
            <div class="subsection">
                <h3>Building Specifications</h3>
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

                    <div class="info-card">
                        <h4>Specifications Status</h4>
                        <p><strong>Last Updated:</strong> ${formatDateForDisplay(property.buildingSpecs.lastUpdated) || 'Not Available'}</p>
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
        <p>© 2025 Bridge Industrial | All Rights Reserved</p>
    </div>
</body>
</html>
`;

  return html;
}

export async function generatePropertySummaryReport(): Promise<string> {
  console.log('Starting property summary report generation...');
  
  const data = await getPropertySummaryData();
  console.log(`Property summary data retrieved: ${data.properties.length} properties`);
  
  const html = generatePropertySummaryHTML(data);
  console.log(`HTML generated, length: ${html.length}`);
  
  return html;
}