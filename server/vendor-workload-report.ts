/**
 * Vendor Workload Report Generator
 * 
 * Generates PDF reports summarizing all Architect and General Contractor RFPs
 * with workload analysis by vendor/firm.
 */

import puppeteer from "puppeteer";
import { storage } from "./storage";
import { readFileSync } from "fs";
import { format } from "date-fns";
import type { RfpRequest } from "@shared/schema";

export interface VendorWorkloadData {
  vendor: string;
  projects: {
    projectName: string;
    rfpNumber: string;
    sentDate: string | null;
    status: string;
    selectedArchitect?: string;
    selectedGC?: string;
  }[];
  totalProjects: number;
}

export interface WorkloadReportData {
  vendors: VendorWorkloadData[];
  totalRfps: number;
  totalVendors: number;
  generatedAt: string;
  dateFilter?: {
    startDate?: string;
    endDate?: string;
  };
}

/**
 * Analyzes RFP data to determine if it's an architect or contractor RFP
 */
function categorizeRfpType(rfp: RfpRequest): 'architect' | 'contractor' | 'unknown' {
  // Check architect field first
  if (rfp.architect && rfp.architect.trim()) {
    return 'architect';
  }
  
  // Check general contractor field
  if (rfp.generalContractor && rfp.generalContractor.trim()) {
    return 'contractor';
  }
  
  // Smart fallback: analyze requestTypes for clues
  const requestTypes = rfp.requestTypes || [];
  const hasArchitectureKeywords = requestTypes.some(type => 
    type.toLowerCase().includes('design') || 
    type.toLowerCase().includes('space-plan') ||
    type.toLowerCase().includes('architecture')
  );
  
  if (hasArchitectureKeywords) {
    return 'architect';
  }
  
  // If we have pricing/schedule requests, assume contractor
  const hasContractorKeywords = requestTypes.some(type =>
    type.toLowerCase().includes('pricing') ||
    type.toLowerCase().includes('schedule')
  );
  
  if (hasContractorKeywords) {
    return 'contractor';
  }
  
  return 'unknown';
}

/**
 * Extracts vendor name from RFP based on type
 */
function getVendorName(rfp: RfpRequest, type: 'architect' | 'contractor'): string {
  if (type === 'architect' && rfp.architect?.trim()) {
    return rfp.architect.trim();
  }
  
  if (type === 'contractor' && rfp.generalContractor?.trim()) {
    return rfp.generalContractor.trim();
  }
  
  return 'Unknown Vendor';
}

/**
 * Processes RFP data to generate vendor workload analysis
 */
export async function generateVendorWorkloadData(options: {
  startDate?: Date;
  endDate?: Date;
  vendors?: string[];
} = {}): Promise<WorkloadReportData> {
  
  // Fetch all RFPs from database
  const allRfps = await storage.getAllRfpRequests();
  
  // Filter RFPs based on date range if provided
  let filteredRfps = allRfps;
  if (options.startDate || options.endDate) {
    filteredRfps = allRfps.filter(rfp => {
      const rfpDate = new Date(rfp.receivedOn);
      if (options.startDate && rfpDate < options.startDate) return false;
      if (options.endDate && rfpDate > options.endDate) return false;
      return true;
    });
  }
  
  // Categorize and filter architect/contractor RFPs
  const vendorRfps: Array<{ rfp: RfpRequest; type: 'architect' | 'contractor'; vendor: string }> = [];
  
  for (const rfp of filteredRfps) {
    const type = categorizeRfpType(rfp);
    if (type === 'architect' || type === 'contractor') {
      const vendor = getVendorName(rfp, type);
      
      // Filter by specific vendors if provided
      if (options.vendors && options.vendors.length > 0) {
        if (!options.vendors.some(v => vendor.toLowerCase().includes(v.toLowerCase()))) {
          continue;
        }
      }
      
      vendorRfps.push({ rfp, type, vendor });
    }
  }
  
  // Group by vendor
  const vendorMap = new Map<string, VendorWorkloadData>();
  
  for (const { rfp, vendor } of vendorRfps) {
    if (!vendorMap.has(vendor)) {
      vendorMap.set(vendor, {
        vendor,
        projects: [],
        totalProjects: 0
      });
    }
    
    const vendorData = vendorMap.get(vendor)!;
    vendorData.projects.push({
      projectName: rfp.projectName || 'Unnamed Project',
      rfpNumber: rfp.rfpNumber,
      sentDate: rfp.receivedOn ? format(new Date(rfp.receivedOn), 'yyyy-MM-dd') : null,
      status: rfp.status || 'Unknown',
      selectedArchitect: rfp.architect || undefined,
      selectedGC: rfp.generalContractor || undefined
    });
    vendorData.totalProjects++;
  }
  
  // Sort vendors alphabetically and sort projects within each vendor
  const vendors: VendorWorkloadData[] = Array.from(vendorMap.values())
    .sort((a, b) => a.vendor.localeCompare(b.vendor))
    .map(vendor => ({
      ...vendor,
      projects: vendor.projects.sort((a, b) => {
        // Sort by sent date first, then by project name
        const dateA = a.sentDate || '9999-12-31';
        const dateB = b.sentDate || '9999-12-31';
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.projectName.localeCompare(b.projectName);
      })
    }));
  
  return {
    vendors,
    totalRfps: vendorRfps.length,
    totalVendors: vendors.length,
    generatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    dateFilter: options.startDate || options.endDate ? {
      startDate: options.startDate ? format(options.startDate, 'yyyy-MM-dd') : undefined,
      endDate: options.endDate ? format(options.endDate, 'yyyy-MM-dd') : undefined
    } : undefined
  };
}

/**
 * Gets Bridge Industrial logo for report header
 */
function getBridgeLogo(): string {
  try {
    return readFileSync('./bridge_logo_new_base64.txt', 'utf8').trim();
  } catch (error) {
    console.error('Error loading Bridge logo:', error);
    return '';
  }
}

/**
 * Generates HTML for the vendor workload report
 */
export function generateVendorWorkloadHtml(data: WorkloadReportData): string {
  const logoBase64 = getBridgeLogo();
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Vendor Workload Report</title>
      <style>
        @page {
          size: A4;
          margin: 0.75in;
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
          line-height: 1.4;
          color: #1f2937;
          margin: 0;
          padding: 0;
        }
        
        .header {
          border-bottom: 3px solid rgb(0,50,130);
          padding-bottom: 20px;
          margin-bottom: 30px;
          position: relative;
        }
        
        .logo-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .document-title {
          font-size: 24px;
          font-weight: bold;
          color: white;
          margin-bottom: 10px;
          background: rgb(0,50,130);
          padding: 10px;
          border-radius: 5px;
          text-align: center;
        }
        
        .report-subtitle {
          font-size: 16px;
          color: #666;
          margin-bottom: 20px;
          text-align: center;
        }
        
        .summary-stats {
          display: flex;
          justify-content: space-around;
          margin-bottom: 30px;
          background: #f9fafb;
          padding: 15px;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
        }
        
        .stat {
          text-align: center;
          flex: 1;
        }
        
        .stat-value {
          font-size: 24px;
          font-weight: bold;
          color: rgb(0,50,130);
          margin-bottom: 5px;
        }
        
        .stat-label {
          font-size: 11px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .vendor-section {
          margin-bottom: 25px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          overflow: hidden;
        }
        
        .vendor-header {
          background: rgb(0,50,130);
          color: white;
          padding: 12px 15px;
          font-weight: 600;
          font-size: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .vendor-project-count {
          background: rgba(255,255,255,0.2);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
        }
        
        .project-list {
          padding: 0;
          margin: 0;
        }
        
        .project-item {
          padding: 10px 15px;
          border-bottom: 1px solid #f3f4f6;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        
        .project-item:last-child {
          border-bottom: none;
        }
        
        .project-item:nth-child(even) {
          background: #f9fafb;
        }
        
        .project-main {
          flex: 1;
        }
        
        .project-name {
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 3px;
        }
        
        .project-details {
          font-size: 10px;
          color: #6b7280;
        }
        
        .project-meta {
          text-align: right;
          min-width: 120px;
          margin-left: 15px;
        }
        
        .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 3px;
        }
        
        .status-received { background: #ddd6fe; color: #7c3aed; }
        .status-in-progress { background: #dbeafe; color: #1d4ed8; }
        .status-completed { background: #d1fae5; color: #16a34a; }
        .status-on-hold { background: #fef3c7; color: #d97706; }
        .status-archived { background: #f3f4f6; color: #6b7280; }
        
        .selected-info {
          font-size: 9px;
          color: #059669;
          margin-top: 2px;
          font-style: italic;
        }
        
        .date-filter-info {
          background: #f0f9ff;
          border: 1px solid #0ea5e9;
          border-radius: 4px;
          padding: 8px 12px;
          margin-bottom: 20px;
          font-size: 10px;
          color: #0c4a6e;
        }
        
        .no-rfps-message {
          text-align: center;
          padding: 40px;
          color: #6b7280;
          font-style: italic;
        }
        
        .footer {
          margin-top: 30px;
          padding-top: 15px;
          border-top: 1px solid #e5e7eb;
          font-size: 9px;
          color: #6b7280;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-container">
          <div style="flex: 1;">
            ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Bridge Industrial" style="height: 30px; max-width: 200px;" />` : ''}
          </div>
          <div style="flex: 1; text-align: right; font-size: 10px; color: #666;">
            <p style="margin: 0;">Generated: ${data.generatedAt}</p>
          </div>
        </div>
        
        <div class="document-title">Vendor Workload Report</div>
        <div class="report-subtitle">
          Architect & General Contractor RFP Summary
        </div>
      </div>
      
      ${data.dateFilter ? `
      <div class="date-filter-info">
        <strong>Date Filter Applied:</strong> 
        ${data.dateFilter.startDate ? `From ${data.dateFilter.startDate}` : 'All dates'} 
        ${data.dateFilter.endDate ? ` to ${data.dateFilter.endDate}` : ''}
      </div>
      ` : ''}
      
      <div class="summary-stats">
        <div class="stat">
          <div class="stat-value">${data.totalRfps}</div>
          <div class="stat-label">Total RFPs</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.totalVendors}</div>
          <div class="stat-label">Unique Vendors</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.totalRfps > 0 ? (data.totalRfps / data.totalVendors).toFixed(1) : '0'}</div>
          <div class="stat-label">Avg RFPs/Vendor</div>
        </div>
      </div>
      
      ${data.vendors.length === 0 ? `
      <div class="no-rfps-message">
        <h3>No matching Architect/Contractor RFPs found</h3>
        <p>There are currently no RFPs matching the specified criteria.</p>
        <p>Please verify that RFPs have architect or general contractor information populated.</p>
      </div>
      ` : ''}
      
      ${data.vendors.map(vendor => `
      <div class="vendor-section">
        <div class="vendor-header">
          <span>${vendor.vendor}</span>
          <span class="vendor-project-count">${vendor.totalProjects} project${vendor.totalProjects !== 1 ? 's' : ''}</span>
        </div>
        <div class="project-list">
          ${vendor.projects.map(project => `
          <div class="project-item">
            <div class="project-main">
              <div class="project-name">${project.projectName}</div>
              <div class="project-details">
                RFP: ${project.rfpNumber}
                ${project.selectedArchitect || project.selectedGC ? `
                <div class="selected-info">
                  Selected: ${[project.selectedArchitect, project.selectedGC].filter(Boolean).join(' / ')}
                </div>
                ` : ''}
              </div>
            </div>
            <div class="project-meta">
              <div class="status-badge status-${project.status.toLowerCase().replace(/\s+/g, '-')}">
                ${project.status}
              </div>
              <div style="font-size: 9px; color: #6b7280;">
                Sent: ${project.sentDate || '—'}
              </div>
            </div>
          </div>
          `).join('')}
        </div>
      </div>
      `).join('')}
      
      <div class="footer">
        <p>Generated from RFP Tracker database on ${data.generatedAt}</p>
        <p>Report includes all Architect and General Contractor RFPs with vendor information</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates PDF from vendor workload data
 */
export async function generateVendorWorkloadPdf(data: WorkloadReportData): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    const html = generateVendorWorkloadHtml(data);
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in'
      },
      printBackground: true
    });
    
    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Generates standardized filename for vendor workload report
 */
export function generateVendorWorkloadFilename(options: {
  startDate?: Date;
  endDate?: Date;
  vendors?: string[];
} = {}): string {
  const timestamp = format(new Date(), 'yyyy-MM-dd-HHmm');
  let filename = `vendor-workload-report-${timestamp}`;
  
  if (options.startDate || options.endDate) {
    const dateRange = [
      options.startDate ? format(options.startDate, 'yyyy-MM-dd') : 'all',
      options.endDate ? format(options.endDate, 'yyyy-MM-dd') : 'all'
    ].join('-to-');
    filename += `-${dateRange}`;
  }
  
  if (options.vendors && options.vendors.length > 0) {
    const vendorSuffix = options.vendors.length === 1 
      ? options.vendors[0].replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
      : `${options.vendors.length}vendors`;
    filename += `-${vendorSuffix}`;
  }
  
  return `${filename}.pdf`;
}