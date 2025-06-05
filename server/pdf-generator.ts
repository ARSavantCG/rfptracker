import { createWriteStream } from "fs";
import { promisify } from "util";

function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}

export interface PdfGenerationOptions {
  rfp: any;
  invitationToBid?: any;
  recipientType: "architect" | "contractor";
  recipientName?: string;
  recipientCompany?: string;
}

export async function generateRfpPdf(options: PdfGenerationOptions): Promise<Buffer> {
  const html = generateRfpHtml(options);
  
  // For now, return HTML as text in a buffer for testing
  // This will allow the download to work while we fix the PDF generation
  const textContent = `
INVITATION TO BID
${options.rfp.projectName}

DATE: ${formatDate(new Date())}
PROJECT NAME: ${options.rfp.projectName}
PROJECT LOCATION: ${options.rfp.property}

TO: ${options.recipientCompany || options.recipientName || 'Bridge Industrial'}
Contact: ${options.rfp.developmentContact || 'Adolfo Reutlinger'}
Email: areutlinger@bridgeindustrial.com
Phone: (305) 747-7057

Dear Mr. ${options.rfp.developmentContact || 'Reutlinger'}:

Your firm has been selected to provide a proposal for the ${options.rfp.projectName} project.

PROJECT DESCRIPTION:
The project consists of ${options.rfp.warehouseArea || options.rfp.projectArea} sq ft of space.

SUBMISSION REQUIREMENTS:
- Bid Cost Breakdown (Excel File)
- Preliminary Construction Schedule
- Affidavit

BID MANAGER:
${options.rfp.developmentContact || 'Adolfo Reutlinger'}
areutlinger@bridgeindustrial.com
(305) 747-7057
`;

  return Buffer.from(textContent, 'utf8');
}

function generateRfpHtml(options: PdfGenerationOptions): string {
  const { rfp, invitationToBid, recipientType, recipientName, recipientCompany } = options;
  
  const today = formatDate(new Date());
  const dueDate = invitationToBid?.dueDate ? formatDate(invitationToBid.dueDate) : 'Thursday, September 19, 2024';
  
  // Calculate areas for display
  const totalArea = parseInt(rfp.warehouseArea?.replace(/,/g, '') || '0');
  const existingOffice = parseInt(rfp.officeAreaExisting?.replace(/,/g, '') || '0');
  const newOffice = parseInt(rfp.officeAreaNew?.replace(/,/g, '') || '0');
  const warehouseArea = totalArea - existingOffice - newOffice;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invitation to Bid - ${rfp.rfpNumber}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 11px;
          line-height: 1.3;
          color: #000;
          margin: 0;
          padding: 20px;
        }
        
        .header {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #000;
          padding-bottom: 10px;
        }
        
        .header h1 {
          font-size: 16px;
          font-weight: bold;
          margin: 0;
          text-transform: uppercase;
        }
        
        .header h2 {
          font-size: 14px;
          font-weight: normal;
          margin: 5px 0 0 0;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        
        td {
          border: 1px solid #000;
          padding: 5px;
          vertical-align: top;
        }
        
        .label-cell {
          font-weight: bold;
          background-color: #f0f0f0;
          width: 120px;
        }
        
        .content-cell {
          background-color: white;
        }
        
        .full-width {
          width: 100%;
        }
        
        .description-box {
          min-height: 100px;
          padding: 8px;
        }
        
        .bullet-points {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
          margin: 10px 0;
        }
        
        .bullet-item {
          margin: 3px 0;
        }
        
        .dates-section td {
          padding: 3px 5px;
        }
        
        .submission-req {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        
        .req-column {
          margin: 0;
        }
        
        .req-column li {
          margin: 2px 0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>INVITATION TO BID</h1>
        <h2>${rfp.projectName}</h2>
      </div>

      <!-- Basic Info Table -->
      <table>
        <tr>
          <td class="label-cell">DATE:</td>
          <td class="content-cell">${today}</td>
        </tr>
        <tr>
          <td class="label-cell">PROJECT NAME:</td>
          <td class="content-cell">${rfp.projectName}</td>
        </tr>
        <tr>
          <td class="label-cell">PROJECT LOCATION:</td>
          <td class="content-cell">${rfp.property}<br>Miami Gardens, FL 33056</td>
        </tr>
      </table>

      <!-- TO Section -->
      <table>
        <tr>
          <td class="label-cell">TO:</td>
          <td class="content-cell">
            ${recipientCompany || recipientName || 'Bridge Industrial'}<br>
            ${rfp.developmentContact || 'Adolfo Reutlinger'}<br>
            (305) 747-7057<br>
            areutlinger@bridgeindustrial.com<br>
            200 South Biscayne Boulevard, Suite 4400<br>
            Miami, FL 33131
          </td>
        </tr>
      </table>

      <!-- Letter Content -->
      <table>
        <tr>
          <td class="content-cell full-width" style="padding: 15px;">
            <p>Dear Mr. ${rfp.developmentContact || 'Reutlinger'}:</p>
            
            <p>Your firm (Bridge Industrial) has been selected to provide a proposal for the ${rfp.projectName} 
            project. I kindly request that you notify us of your intent to provide a bid no later 
            than close of business on the date outlined below. Below you will also find a series of 
            information to assist you throughout the pricing exercise.</p>
            
            <p>In the event you have any questions, please feel free to contact 
            Areutlinger@bridgeindustrial.com at your earliest convenience.</p>
          </td>
        </tr>
      </table>

      <!-- Project Description -->
      <table>
        <tr>
          <td class="label-cell">PROJECT DESCRIPTION:</td>
          <td class="content-cell description-box">
            <p>The project consists of ${totalArea.toLocaleString()} sf of ${existingOffice > 0 ? 'office' : 'office'} and ${warehouseArea > 0 ? warehouseArea.toLocaleString() : '2000'} sf of warehouse. The scope of work 
            includes, however is not limited to the following:</p>
            
            <div class="bullet-points">
              <div>
                <div class="bullet-item">• Box in a box freezer</div>
                <div class="bullet-item">• HVAC Installation</div>
                <div class="bullet-item">• New Drive-up Ramp</div>
                <div class="bullet-item">• Racking</div>
              </div>
              <div>
                <div class="bullet-item">• Scope 5</div>
                <div class="bullet-item">• Scope 6</div>
                <div class="bullet-item">• Scope 7</div>
                <div class="bullet-item">• Scope 8</div>
              </div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Document Link -->
      <table>
        <tr>
          <td class="label-cell">DOCUMENT(S) LINK:</td>
          <td class="content-cell">www.testlinkdoc.com</td>
        </tr>
      </table>

      <!-- Key Dates -->
      <table>
        <tr>
          <td class="label-cell">KEY DATES:</td>
          <td class="content-cell">
            <table style="border: none; width: 100%;" class="dates-section">
              <tr>
                <td style="border: none; width: 60%;">Accept / Reject Invitation to Bid</td>
                <td style="border: none;">Thursday, ${today}</td>
              </tr>
              <tr>
                <td style="border: none;">Site Visit</td>
                <td style="border: none;">Saturday, ${today}</td>
              </tr>
              <tr>
                <td style="border: none;">Request(s) for Information Due</td>
                <td style="border: none;">Monday, ${today}</td>
              </tr>
              <tr>
                <td style="border: none;">Bid Packages Due</td>
                <td style="border: none;">${dueDate}</td>
              </tr>
              <tr>
                <td style="border: none;">Anticipated Start Date</td>
                <td style="border: none;">Monday, December 2, 2024</td>
              </tr>
              <tr>
                <td style="border: none;">Anticipated Construction Completion Date</td>
                <td style="border: none;">Saturday, June 6, 2026</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Bid Manager -->
      <table>
        <tr>
          <td class="label-cell">BID MANAGER:</td>
          <td class="content-cell">
            ${rfp.developmentContact || 'Adolfo Reutlinger'}<br>
            Areutlinger@bridgeindustrial.com<br>
            (305) 747-7057
          </td>
        </tr>
      </table>

      <!-- Submission Requirements -->
      <table>
        <tr>
          <td class="label-cell">SUBMISSION REQUIREMENTS:</td>
          <td class="content-cell">
            <div class="submission-req">
              <div class="req-column">
                <ul style="margin: 0; padding-left: 15px;">
                  <li>Bid Cost Breakdown (Excel File)</li>
                  <li>Preliminary Construction Schedule (w/ Long Lead Items)</li>
                  <li>Affidavit</li>
                </ul>
              </div>
              <div class="req-column">
                <ul style="margin: 0; padding-left: 15px;">
                  <li>Bid Req. 4</li>
                  <li>Bid Req. 5</li>
                  <li>Bid Req. 6</li>
                </ul>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

export function generatePdfFilename(rfp: any, recipientType: string): string {
  const cleanProjectName = rfp.projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  return `ITB_${cleanProjectName}_${recipientType}_${timestamp}.pdf`;
}