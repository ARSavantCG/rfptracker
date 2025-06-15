import puppeteer from "puppeteer";
import { db } from "./db";
import { rfpRequests, bidCollections, bidLineItems } from "@shared/schema";
import { eq } from "drizzle-orm";

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
  unitPrice: number;
  totalPrice: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
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
        totalAmount: parseFloat(bid.totalAmount || '0'),
        lineItems: lineItems.map(item => ({
          description: item.description,
          category: item.category,
          quantity: typeof item.quantity === 'string' ? parseInt(item.quantity) : item.quantity || 0,
          unitPrice: parseFloat(item.unitPrice || '0'),
          totalPrice: parseFloat(item.totalPrice || '0')
        })),
        submissionDate: formatDate(bid.submissionDate)
      });
    }

    if (projectBids.length > 0) {
      const bidAmounts = projectBids.map(b => b.totalAmount);
      const lowestBid = Math.min(...bidAmounts);
      const highestBid = Math.max(...bidAmounts);
      const averageBid = bidAmounts.reduce((sum, amount) => sum + amount, 0) / bidAmounts.length;

      completedProjects.push({
        rfpId: rfp.id,
        rfpNumber: rfp.rfpNumber,
        projectName: rfp.projectName,
        tenantName: rfp.tenantName,
        property: rfp.property,
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
          size: A4 landscape;
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
        
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          font-size: 11px;
          line-height: 1.3;
          margin: 0;
          color: #333;
        }
        
        .header {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #2563eb;
          padding-bottom: 10px;
        }
        
        .header h1 {
          color: #1e40af;
          margin: 0 0 5px 0;
          font-size: 22px;
          font-weight: 600;
        }
        
        .header .subtitle {
          color: #6b7280;
          font-size: 12px;
          margin: 5px 0;
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
          text-align: left;
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
          text-align: right;
          font-weight: 500;
        }
        
        .quantity {
          text-align: center;
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
        <h1>Historical Pricing Report</h1>
        <div class="subtitle">Completed RFP Projects - Pricing Analysis</div>
        <div class="subtitle">Generated on ${data.generatedAt}</div>
      </div>
      
      ${data.completedProjects.length > 0 ? `
        <div class="summary-stats">
          <div class="stat-item">
            <div class="stat-value">${data.totalProjects}</div>
            <div class="stat-label">Completed Projects</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${data.totalBids}</div>
            <div class="stat-label">Total Bids Received</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${(data.totalBids / data.totalProjects).toFixed(1)}</div>
            <div class="stat-label">Avg Bids per Project</div>
          </div>
        </div>
        
        ${data.completedProjects.map(project => `
          <div class="project-section">
            <div class="project-header">
              <div>
                <div class="project-title">${project.rfpNumber} - ${project.projectName}</div>
                <div class="project-meta">
                  <span>${project.tenantName} • ${project.property} • Completed: ${project.completedDate}</span>
                  <div class="project-stats">
                    <div class="project-stat">
                      <div class="project-stat-value">${formatCurrency(project.lowestBid)}</div>
                      <div class="project-stat-label">Lowest Bid</div>
                    </div>
                    <div class="project-stat">
                      <div class="project-stat-value">${formatCurrency(project.highestBid)}</div>
                      <div class="project-stat-label">Highest Bid</div>
                    </div>
                    <div class="project-stat">
                      <div class="project-stat-value">${formatCurrency(project.averageBid)}</div>
                      <div class="project-stat-label">Average Bid</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="bids-container">
              ${project.bids.map(bid => `
                <div class="bid-section">
                  <div class="bid-header">
                    <div>
                      <div class="bid-contractor">${bid.contractorName}</div>
                      <div class="bid-company">${bid.contractorCompany}</div>
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
                            <th style="width: 30%;">Description</th>
                            <th style="width: 15%;">Category</th>
                            <th style="width: 10%;">Qty</th>
                            <th style="width: 15%;">Unit Price</th>
                            <th style="width: 15%;">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${bid.lineItems.map(item => `
                            <tr>
                              <td>${item.description}</td>
                              <td>
                                <span class="category-tag" style="background-color: ${getCategoryColor(item.category)};">
                                  ${item.category}
                                </span>
                              </td>
                              <td class="quantity">${item.quantity}</td>
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
    console.log("Starting historical pricing PDF generation...");
    const data = await getHistoricalPricingData();
    console.log("Historical pricing data retrieved:", { 
      totalProjects: data.totalProjects, 
      totalBids: data.totalBids 
    });
    
    const html = generateHistoricalPricingHtml(data);
    console.log("HTML generated, length:", html.length);

    // Try puppeteer first, fall back to HTML if it fails
    try {
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-web-security']
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        },
        printBackground: true
      });

      await browser.close();
      console.log("PDF generated successfully, size:", pdf.length);
      return Buffer.from(pdf);
    } catch (puppeteerError: any) {
      console.log("Puppeteer failed, falling back to HTML:", puppeteerError?.message || 'Unknown error');
      // Return HTML as buffer for browser-based PDF generation
      return Buffer.from(html, 'utf8');
    }
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