import puppeteer from "puppeteer";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import type { RfpRequest } from "@shared/schema";
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

export interface ReportData {
  rfps: RfpRequest[];
  filters?: any;
  generatedAt: string;
}

function getStatusBadgeColor(status: string) {
  switch (status) {
    case "received": return "#8B5CF6";
    case "in-progress": return "#F59E0B";
    case "completed": return "#10B981";
    case "on-hold": return "#EF4444";
    default: return "#6B7280";
  }
}

function getPriorityLabel(dueDate: string | Date, status: string) {
  if (status === "completed") return "Completed";
  
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (isNaN(due.getTime())) return "Unknown";
  
  const now = new Date();
  const threeDaysFromNow = addDays(now, 3);
  const sevenDaysFromNow = addDays(now, 7);

  if (isBefore(due, now)) return "Overdue";
  if (isBefore(due, threeDaysFromNow)) return "Critical";
  if (isBefore(due, sevenDaysFromNow)) return "High";
  return "Normal";
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case "Overdue": return "#EF4444";
    case "Critical": return "#F59E0B";
    case "High": return "#F59E0B";
    case "Normal": return "#10B981";
    case "Completed": return "#10B981";
    default: return "#6B7280";
  }
}

export function generateExecutiveReportHtml(data: ReportData): string {
  const { rfps, generatedAt } = data;
  


  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>RFP Detailed Report</title>
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
          font-size: 10px;
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
        
        .company-info {
          text-align: right;
          margin-bottom: 20px;
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
        
        .project-title {
          font-size: 18px;
          color: #666;
          margin-bottom: 20px;
          text-align: center;
        }
        
        .header h1 {
          font-size: 24px;
          font-weight: bold;
          color: white;
          margin: 0 0 5px 0;
        }
        
        .header .subtitle {
          font-size: 11px;
          color: #666;
          margin: 0;
          text-align: center;
        }
        
        .metrics {
          display: flex;
          justify-content: space-around;
          margin-bottom: 20px;
          background: #f9fafb;
          padding: 10px;
          border-radius: 6px;
        }
        
        .metric {
          text-align: center;
          flex: 1;
        }
        
        .metric-value {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 2px;
        }
        
        .metric-label {
          font-size: 9px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .total { color: #3b82f6; }
        .received { color: #8b5cf6; }
        .in-progress { color: #f59e0b; }
        .completed { color: #10b981; }
        .on-hold { color: #ef4444; }
        .due-soon { color: #f59e0b; }
        .overdue { color: #ef4444; }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9px;
          background: white;
          border: 1px solid #e5e7eb;
        }
        
        th {
          background: #f3f4f6;
          padding: 8px 6px;
          text-align: left;
          font-weight: 600;
          color: #374151;
          border-bottom: 1px solid #d1d5db;
          font-size: 9px;
        }
        
        td {
          padding: 6px;
          border-bottom: 1px solid #f3f4f6;
          vertical-align: top;
        }
        
        tr:nth-child(even) {
          background: #fafafa;
        }
        
        .status-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 7px;
          font-weight: 500;
          color: white;
          text-transform: capitalize;
          white-space: nowrap;
        }
        
        .priority-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 8px;
          font-weight: 500;
          color: white;
        }
        
        .days-column {
          font-weight: 500;
        }
        
        .overdue-text {
          color: #ef4444;
          font-weight: 600;
        }
        
        .critical-text {
          color: #f59e0b;
          font-weight: 600;
        }
        
        .footer {
          margin-top: 15px;
          text-align: center;
          font-size: 8px;
          color: #9ca3af;
          border-top: 1px solid #e5e7eb;
          padding-top: 10px;
        }
        
        .rfp-number {
          font-weight: 600;
          color: #1f2937;
        }
        
        .project-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
          <!-- Development Contact -->
          <div class="company-info">
            <div style="font-weight: bold; color: rgb(0,50,130); margin-bottom: 2px;">Development Contact</div>
            <div style="font-size: 11px; color: #666;">
              ${rfps.length > 0 && rfps[0].developmentContact ? rfps[0].developmentContact : 'Contact information available upon request'}
            </div>
          </div>
        </div>
        <div class="document-title">Executive Summary Report</div>
        <p class="subtitle">RFP Status Overview - Generated on ${format(new Date(generatedAt), 'MMMM dd, yyyy \'at\' h:mm a')}</p>
      </div>
      

      
      <table>
        <thead>
          <tr>
            <th style="width: 15%;">RFP Number</th>
            <th style="width: 45%;">Project Name</th>
            <th style="width: 15%;">Due Date</th>
            <th style="width: 15%;">Status</th>
            <th style="width: 10%;">Day(s) Until Due</th>
          </tr>
        </thead>
        <tbody>
          ${rfps.map(rfp => {
            const dueDate = new Date(rfp.internalDueDate);
            const isValidDate = !isNaN(dueDate.getTime());
            const daysUntilDue = isValidDate ? Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0;
            const priority = getPriorityLabel(rfp.internalDueDate, rfp.status);
            const statusColor = getStatusBadgeColor(rfp.status);
            const priorityColor = getPriorityColor(priority);
            
            return `
              <tr>
                <td><span class="rfp-number">${rfp.rfpNumber}</span></td>
                <td class="project-name">${rfp.projectName}</td>
                <td style="white-space: nowrap;">${isValidDate ? format(dueDate, 'MMM dd, yyyy') : 'Invalid Date'}</td>
                <td>
                  <span class="status-badge" style="background-color: ${statusColor};">
                    ${rfp.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </td>
                <td class="days-column">
                  ${rfp.status === 'completed' ? 
                    '<span style="color: #6b7280;">—</span>' : 
                    (isValidDate ? 
                      `<span class="${daysUntilDue < 0 ? 'overdue-text' : daysUntilDue <= 3 ? 'critical-text' : ''}">${daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} day(s) overdue` : `${daysUntilDue} day(s)`}</span>` :
                      '<span style="color: #6b7280;">—</span>'
                    )
                  }
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      
      <div class="footer">
        <p>This report contains ${rfps.length} RFP${rfps.length !== 1 ? 's' : ''}. For detailed information, please refer to the RFP management system.</p>
      </div>
    </body>
    </html>
  `;
}

export async function generateDetailedReportPdf(data: ReportData): Promise<Buffer> {
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
    const html = generateExecutiveReportHtml(data);
    
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
    
    return pdf as Buffer;
  } finally {
    await browser.close();
  }
}

export function generateReportFilename(type: string): string {
  const timestamp = format(new Date(), 'yyyy-MM-dd-HHmm');
  return `rfp-${type}-report-${timestamp}.pdf`;
}