import puppeteer from "puppeteer";
import { format, parseISO, isAfter, isBefore, addDays } from "date-fns";
import type { RfpRequest } from "@shared/schema";

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

function generateExecutiveReportHtml(data: ReportData): string {
  const { rfps, generatedAt } = data;
  
  // Calculate metrics
  const metrics = {
    total: rfps.length,
    received: rfps.filter(rfp => rfp.status === "received").length,
    inProgress: rfps.filter(rfp => rfp.status === "in-progress").length,
    completed: rfps.filter(rfp => rfp.status === "completed").length,
    onHold: rfps.filter(rfp => rfp.status === "on-hold").length,
    dueSoon: rfps.filter(rfp => {
      const dueDate = parseISO(rfp.dueOn.toString());
      const sevenDaysFromNow = addDays(new Date(), 7);
      return isBefore(dueDate, sevenDaysFromNow) && rfp.status !== "completed";
    }).length,
    overdue: rfps.filter(rfp => {
      const dueDate = parseISO(rfp.dueOn.toString());
      return isBefore(dueDate, new Date()) && rfp.status !== "completed";
    }).length
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>RFP Executive Summary Report</title>
      <style>
        @page {
          size: A4 landscape;
          margin: 0.5in;
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
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 15px;
        }
        
        .header h1 {
          font-size: 18px;
          font-weight: bold;
          color: #1f2937;
          margin: 0 0 5px 0;
        }
        
        .header .subtitle {
          font-size: 11px;
          color: #6b7280;
          margin: 0;
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
          font-size: 8px;
          font-weight: 500;
          color: white;
          text-transform: capitalize;
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
      <div class="header">
        <h1>RFP Executive Summary Report</h1>
        <p class="subtitle">Generated on ${format(new Date(generatedAt), 'MMMM dd, yyyy \'at\' h:mm a')}</p>
      </div>
      
      <div class="metrics">
        <div class="metric">
          <div class="metric-value total">${metrics.total}</div>
          <div class="metric-label">Total RFPs</div>
        </div>
        <div class="metric">
          <div class="metric-value received">${metrics.received}</div>
          <div class="metric-label">Received</div>
        </div>
        <div class="metric">
          <div class="metric-value in-progress">${metrics.inProgress}</div>
          <div class="metric-label">In Progress</div>
        </div>
        <div class="metric">
          <div class="metric-value completed">${metrics.completed}</div>
          <div class="metric-label">Completed</div>
        </div>
        <div class="metric">
          <div class="metric-value on-hold">${metrics.onHold}</div>
          <div class="metric-label">On Hold</div>
        </div>
        <div class="metric">
          <div class="metric-value due-soon">${metrics.dueSoon}</div>
          <div class="metric-label">Due Soon</div>
        </div>
        <div class="metric">
          <div class="metric-value overdue">${metrics.overdue}</div>
          <div class="metric-label">Overdue</div>
        </div>
      </div>
      
      <table>
        <thead>
          <tr>
            <th style="width: 15%;">RFP Number</th>
            <th style="width: 35%;">Project Name</th>
            <th style="width: 15%;">Due Date</th>
            <th style="width: 15%;">Status</th>
            <th style="width: 20%;">Days Until Due</th>
          </tr>
        </thead>
        <tbody>
          ${rfps.map(rfp => {
            const dueDate = new Date(rfp.dueOn);
            const isValidDate = !isNaN(dueDate.getTime());
            const daysUntilDue = isValidDate ? Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0;
            const priority = getPriorityLabel(rfp.dueOn, rfp.status);
            const statusColor = getStatusBadgeColor(rfp.status);
            const priorityColor = getPriorityColor(priority);
            
            return `
              <tr>
                <td><span class="rfp-number">${rfp.rfpNumber}</span></td>
                <td class="project-name">${rfp.projectName}</td>
                <td>${isValidDate ? format(dueDate, 'MMM dd, yyyy') : 'Invalid Date'}</td>
                <td>
                  <span class="status-badge" style="background-color: ${statusColor};">
                    ${rfp.status.replace('-', ' ')}
                  </span>
                </td>
                <td class="days-column">
                  ${rfp.status === 'completed' ? 
                    '<span style="color: #6b7280;">—</span>' : 
                    `<span class="${daysUntilDue < 0 ? 'overdue-text' : daysUntilDue <= 3 ? 'critical-text' : ''}">${daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} days overdue` : `${daysUntilDue} days`}</span>`
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

export async function generateExecutiveReportPdf(data: ReportData): Promise<Buffer> {
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