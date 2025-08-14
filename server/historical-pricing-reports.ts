import puppeteer from "puppeteer";
import { db } from "./db";
import { rfpRequests, bidCollections, bidLineItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";

// Get Bridge Industrial logo as base64
function getBridgeLogo(): string {
  try {
    const logoBase64 = readFileSync('./bridge_logo_new_base64.txt', 'utf8').trim();
    return `data:image/png;base64,${logoBase64}`;
  } catch (error) {
    console.error('Error reading Bridge logo:', error);
    return '';
  }
}

export interface HistoricalPricingData {
  completedProjects: CompletedProject[];
  generatedAt: string;
  totalProjects: number;
  totalBids: number;
}

export interface CompletedProject {
  rfpId: number;
  rfpNumber: string;
  projectName: string;
  tenantName: string;
  property: string;
  rentableSquareFootage: number;
  completedDate: string;
  bids: ProjectBid[];
  totalBids: number;
  lowestBid: number;
  highestBid: number;
  averageBid: number;
}

export interface ProjectBid {
  bidId: number;
  contractorName: string;
  contractorCompany: string;
  totalAmount: number;
  lineItems: BidLineItem[];
  submissionDate: string;
}

export interface BidLineItem {
  description: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

function formatCurrency(amount: number): string {
  // Handle NaN, null, undefined, or invalid numbers
  if (isNaN(amount) || amount === null || amount === undefined) {
    return '$0.00';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

function formatNumberWithCommas(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function getCategoryColor(category: string): string {
  const colors: { [key: string]: string } = {
    'Demolition': '#ef4444',
    'Construction': '#3b82f6',
    'Electrical': '#f59e0b',
    'Plumbing': '#06b6d4',
    'HVAC': '#8b5cf6',
    'Flooring': '#10b981',
    'Painting': '#f97316',
    'Other': '#6b7280'
  };
  return colors[category] || '#6b7280';
}

async function getHistoricalPricingData(): Promise<HistoricalPricingData> {
  // Get all completed RFPs with their bids and line items
  const completedRfps = await db
    .select()
    .from(rfpRequests)
    .where(eq(rfpRequests.status, 'completed'))
    .orderBy(rfpRequests.projectName);

  const completedProjects: CompletedProject[] = [];

  for (const rfp of completedRfps) {
    // Get all bids for this RFP
    const bids = await db
      .select()
      .from(bidCollections)
      .where(eq(bidCollections.rfpId, rfp.id))
      .orderBy(bidCollections.totalAmount);

    const projectBids: ProjectBid[] = [];

    for (const bid of bids) {
      const bidTotal = parseFloat(bid.totalAmount || '0');
      
      // Skip $0.00 bids
      if (bidTotal <= 0) {
        continue;
      }

      // Get line items for this bid
      const lineItems = await db
        .select()
        .from(bidLineItems)
        .where(eq(bidLineItems.bidCollectionId, bid.id))
        .orderBy(bidLineItems.category, bidLineItems.description);

      projectBids.push({
        bidId: bid.id,
        contractorName: bid.contractorName,
        contractorCompany: bid.contractorCompany,
        totalAmount: bidTotal,
        lineItems: lineItems.map(item => {
          const quantity = typeof item.quantity === 'string' ? parseInt(item.quantity) : item.quantity || 0;
          const unitPrice = parseFloat(item.unitPrice || '0');
          const totalPrice = parseFloat(item.totalPrice || '0');
          
          // For percentage-based items where unit price is very small (like 0.01, 0.02), 
          // calculate the actual unit price from total/quantity for better display
          const calculatedUnitPrice = quantity > 0 && totalPrice > 0 ? totalPrice / quantity : unitPrice;
          
          // Use calculated unit price if it makes more sense (avoids showing $0.01 when it should be $10.00)
          const displayUnitPrice = (unitPrice < 1 && calculatedUnitPrice > 1) ? calculatedUnitPrice : unitPrice;
          
          return {
            description: item.description,
            category: item.category || 'Other',
            quantity,
            unit: item.unit || 'SF',
            unitPrice: displayUnitPrice,
            totalPrice
          };
        }),
        submissionDate: formatDate(bid.submissionDate)
      });
    }

    if (projectBids.length > 0) {
      const bidAmounts = projectBids.map(b => b.totalAmount);
      const lowestBid = Math.min(...bidAmounts);
      const highestBid = Math.max(...bidAmounts);
      const averageBid = bidAmounts.reduce((sum, amount) => sum + amount, 0) / bidAmounts.length;

      // Calculate rentable square footage from area breakdown or warehouse area
      const areaBreakdown = (rfp as any).areaBreakdown || [];
      const totalBreakdownArea = areaBreakdown.reduce((sum: number, item: any) => sum + (parseInt(item.squareFootage) || 0), 0);
      const warehouseAreaNumber = parseInt(rfp.warehouseArea?.replace(/,/g, '') || '0') || 0;
      const rentableSquareFootage = warehouseAreaNumber || totalBreakdownArea;

      completedProjects.push({
        rfpId: rfp.id,
        rfpNumber: rfp.rfpNumber,
        projectName: rfp.projectName,
        tenantName: rfp.tenantName,
        property: rfp.property,
        rentableSquareFootage,
        completedDate: formatDate(rfp.updatedAt),
        bids: projectBids,
        totalBids: projectBids.length,
        lowestBid,
        highestBid,
        averageBid
      });
    }
  }

  const totalBids = completedProjects.reduce((sum, project) => sum + project.totalBids, 0);

  return {
    completedProjects,
    generatedAt: formatDate(new Date()),
    totalProjects: completedProjects.length,
    totalBids
  };
}

function generateHistoricalPricingHtml(data: HistoricalPricingData): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @page {
          size: A4 portrait;
          margin: 0.5in;
        }
        
        @media print {
          .no-print {
            display: none !important;
          }
          
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
        
        .no-print {
          background: #3b82f6;
          color: white;
          padding: 15px;
          text-align: center;
          margin-bottom: 20px;
          border-radius: 8px;
        }
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          font-size: 11px;
          line-height: 1.3;
          margin: 0;
          color: #333;
        }
        
        .header {
          border-bottom: 3px solid rgb(0,50,130);
          padding-bottom: 20px;
          margin-bottom: 30px;
          position: relative;
        }
        
        .document-title {
          font-size: 24px;
          font-weight: bold;
          color: rgb(0,50,130);
          margin-bottom: 10px;
          background: rgb(0,50,130);
          color: white;
          padding: 10px;
          border-radius: 5px;
          text-align: center;
        }
        
        .header .subtitle {
          color: #666;
          font-size: 12px;
          margin: 5px 0;
          text-align: center;
        }
        
        .summary-stats {
          display: flex;
          justify-content: center;
          gap: 30px;
          margin-bottom: 25px;
          padding: 15px;
          background: #f8fafc;
          border-radius: 8px;
        }
        
        .stat-item {
          text-align: center;
        }
        
        .stat-value {
          font-size: 18px;
          font-weight: 600;
          color: #1e40af;
          margin-bottom: 2px;
        }
        
        .stat-label {
          font-size: 11px;
          color: #6b7280;
          text-transform: uppercase;
          font-weight: 500;
        }
        
        .project-section {
          margin-bottom: 30px;
          break-inside: avoid;
        }
        
        .project-header {
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          color: white;
          padding: 12px 15px;
          border-radius: 8px 8px 0 0;
          margin-bottom: 0;
        }
        
        .project-title {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        
        .project-meta {
          font-size: 11px;
          opacity: 0.9;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .project-stats {
          display: flex;
          gap: 20px;
        }
        
        .project-stat {
          text-align: center;
        }
        
        .project-stat-value {
          font-weight: 600;
          font-size: 12px;
        }
        
        .project-stat-label {
          font-size: 10px;
          opacity: 0.8;
        }
        
        .bids-container {
          border: 1px solid #e5e7eb;
          border-top: none;
          border-radius: 0 0 8px 8px;
        }
        
        .bid-section {
          border-bottom: 1px solid #f3f4f6;
        }
        
        .bid-section:last-child {
          border-bottom: none;
        }
        
        .bid-header {
          background: #f8fafc;
          padding: 10px 15px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .bid-contractor {
          font-weight: 600;
          color: #1f2937;
        }
        
        .bid-company {
          color: #6b7280;
          font-size: 10px;
          margin-top: 2px;
        }
        
        .bid-amount {
          font-size: 14px;
          font-weight: 600;
          color: #059669;
        }
        
        .bid-meta {
          font-size: 10px;
          color: #6b7280;
        }
        
        .line-items {
          padding: 0;
        }
        
        .line-items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }
        
        .line-items-table th {
          background: #f9fafb;
          padding: 8px 10px;
          font-weight: 600;
          color: #374151;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .line-items-table td {
          padding: 6px 10px;
          border-bottom: 1px solid #f3f4f6;
          vertical-align: top;
        }
        
        .category-tag {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 500;
          color: white;
          text-transform: uppercase;
        }
        
        .amount {
          text-align: center;
          font-weight: 500;
        }
        
        .quantity {
          text-align: center;
        }
        
        .unit {
          text-align: center;
          font-style: italic;
          color: #6b7280;
        }
        
        .footer {
          margin-top: 30px;
          text-align: center;
          font-size: 10px;
          color: #6b7280;
          border-top: 1px solid #e5e7eb;
          padding-top: 15px;
        }
        
        .no-projects {
          text-align: center;
          padding: 40px;
          color: #6b7280;
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px;">
        <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
        <br><small>This banner will not appear in the printed version.</small>
      </div>
      
      <div class="header">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <!-- Company logo -->
          <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
        </div>
        <div class="document-title">Historical Pricing Report</div>
        <div class="subtitle">Completed RFP Projects - Pricing Analysis</div>
        <div class="subtitle">Generated on ${data.generatedAt}</div>
      </div>
      
      ${data.completedProjects.length > 0 ? `
        
        ${data.completedProjects.map(project => `
          <div class="project-section">
            <div class="project-header">
              <div>
                <div class="project-title">${project.rfpNumber} - ${project.projectName}</div>
                <div class="project-meta">
                  <span>${project.tenantName} • ${project.property} • RSF: ${formatNumberWithCommas(project.rentableSquareFootage)}</span>
                </div>
              </div>
            </div>
            
            <div class="bids-container">
              ${project.bids.map(bid => `
                <div class="bid-section">
                  <div class="bid-header">
                    <div>
                      <div class="bid-contractor">${bid.contractorCompany}</div>
                    </div>
                    <div style="text-align: right;">
                      <div class="bid-amount">${formatCurrency(bid.totalAmount)}</div>
                      <div class="bid-meta">Submitted: ${bid.submissionDate}</div>
                    </div>
                  </div>
                  
                  ${bid.lineItems.length > 0 ? `
                    <div class="line-items">
                      <table class="line-items-table">
                        <thead>
                          <tr>
                            <th style="width: 40%; text-align: left;">Description</th>
                            <th style="width: 10%; text-align: center;">Qty</th>
                            <th style="width: 10%; text-align: center;">Unit</th>
                            <th style="width: 20%; text-align: center;">Unit Price</th>
                            <th style="width: 20%; text-align: center;">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${bid.lineItems.map(item => `
                            <tr>
                              <td>${item.description}</td>
                              <td class="quantity">${formatNumberWithCommas(item.quantity)}</td>
                              <td class="unit">${item.unit || 'SF'}</td>
                              <td class="amount">${formatCurrency(item.unitPrice)}</td>
                              <td class="amount">${formatCurrency(item.totalPrice)}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      ` : `
        <div class="no-projects">
          <h3>No Completed Projects Found</h3>
          <p>No pricing data available for completed RFP projects.</p>
        </div>
      `}
      
      <div class="footer">
        Historical Pricing Report - Generated ${data.generatedAt} - Page 1
      </div>
    </body>
    </html>
  `;
}

export async function generateHistoricalPricingPdf(): Promise<Buffer> {
  try {
    console.log("Starting historical pricing HTML generation...");
    const data = await getHistoricalPricingData();
    console.log("Historical pricing data retrieved:", { 
      totalProjects: data.totalProjects, 
      totalBids: data.totalBids 
    });
    
    const html = generateHistoricalPricingHtml(data);
    console.log("HTML generated, length:", html.length);

    // Always return HTML for browser-based PDF generation in new window
    return Buffer.from(html, 'utf8');
  } catch (error) {
    console.error("Error in generateHistoricalPricingPdf:", error);
    throw error;
  }
}

export function generateHistoricalPricingFilename(): string {
  const date = new Date();
  const timestamp = date.toISOString().split('T')[0];
  return `historical-pricing-report-${timestamp}.pdf`;
}