/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import fs, { readFileSync } from "fs";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import jwt from "jsonwebtoken";
import { 
  insertRfpRequestSchema, 
  updateRfpRequestSchema,
  insertContactSchema,
  updateContactSchema,
  insertInvitationSchema,
  updateInvitationSchema,
  insertInvitationToBidSchema,
  updateInvitationToBidSchema,
  insertBidCollectionSchema,
  updateBidCollectionSchema,
  insertBidLineItemSchema,
  updateBidLineItemSchema,
  insertPropertySchema,
  updatePropertySchema,
  insertRomScopeItemSchema,
  updateRomScopeItemSchema,
  insertPdfTemplateSchema,
  insertTransformerSchema,
  updateTransformerSchema,
  insertMainPanelSchema,
  updateMainPanelSchema,
  insertBayPanelAssignmentSchema,
  insertElectricalReservationSchema,
  updateElectricalReservationSchema
} from "@shared/schema";
import { convertFormDateToDbDate } from "@shared/date-utils";
import { properties, rfpRequests } from "@shared/schema";
import { validateRfpForProgression, canAdvanceToPhase } from "./validation";
import { AuthService } from "./auth";
import { users, contacts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { tokenStore } from "./token-auth";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { generateRfpPdf, generatePdfFilename } from "./pdf-generator";
import { 
  enforceAllPropertiesLegalCompliance, 
  enforcePropertyLegalCompliance,
  autoEnforceLegalComplianceMiddleware,
  LEGAL_PROPERTY_TOTALS,
  fixBIALeaseTotal,
  applySymmetricalLegalCompliance
} from "./property-legal-compliance";
import { applyLegalRounding, validateLegalCompliance, LEGAL_TOTALS } from "./legal-rounding-system";
import { deleteEntityFiles, cleanupOrphanedFiles, getCleanupStats, findOrphanedFiles } from "./file-cleanup";
import Templates from "./lib/rfp-templates";
import { sendWorkflowCompletionEmail, sendTestStatusReportEmail } from "./email-service";
import { startEmailScheduler, sendStatusReportNow } from "./email-scheduler";

// Helper function to clean invalid values like "$NaN", "NaN", etc.
function cleanInvalidValue(value: any): string {
  if (!value) return '';
  const strValue = String(value);
  if (strValue.includes('$NaN') || strValue === 'NaN' || strValue.includes('Error:')) {
    return '';
  }
  return strValue;
}

// Permission checking middleware
const checkPermission = (permission: string) => {
  return async (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user || !user.permissions?.includes(permission)) {
      return res.status(403).json({ message: `Access denied. ${permission} permission required.` });
    }
    next();
  };
};

// Generate RFP preview HTML with custom formatting
function generateRfpPreviewHtml(documentType: string, formatSettings: any): string {
  const { tableColumns, fonts, colors, spacing } = formatSettings;
  const scopeColumns = tableColumns.scopeOfWork;
  const spaceColumns = tableColumns.spaceRequirements;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; font-size: ${fonts.bodySize}px; margin: ${spacing.sectionMargin}px; }
        .header { font-size: ${fonts.headerSize}px; font-weight: bold; text-align: ${formatSettings.layout.headerAlignment}; margin-bottom: ${spacing.sectionMargin}px; }
        .section-title { font-size: 16px; font-weight: bold; margin: ${spacing.sectionMargin}px 0 10px 0; }
        table { border-collapse: collapse; width: 100%; margin: ${spacing.tableMargin}px 0; table-layout: fixed; }
        th { background-color: ${colors.tableHeaderBackground}; border: 1px solid ${colors.tableBorderColor}; padding: ${spacing.cellPadding}px; font-size: ${fonts.tableHeaderSize}px; font-weight: bold; }
        td { border: 1px solid ${colors.tableBorderColor}; padding: ${spacing.cellPadding}px; font-size: ${fonts.tableBodySize}px; }
        .scope-table th:nth-child(1), .scope-table td:nth-child(1) { width: ${scopeColumns.description}%; }
        .scope-table th:nth-child(2), .scope-table td:nth-child(2) { width: ${scopeColumns.quantity}%; text-align: center; }
        .scope-table th:nth-child(3), .scope-table td:nth-child(3) { width: ${scopeColumns.unit}%; text-align: center; }
        .scope-table th:nth-child(4), .scope-table td:nth-child(4) { width: ${scopeColumns.notes}%; }
        .space-table th:nth-child(1), .space-table td:nth-child(1) { width: ${spaceColumns.spaceType}%; }
        .space-table th:nth-child(2), .space-table td:nth-child(2) { width: ${spaceColumns.area}%; }
        .space-table th:nth-child(3), .space-table td:nth-child(3) { width: ${spaceColumns.notes}%; }
      </style>
    </head>
    <body>
      <div class="header">REQUEST FOR PROPOSAL</div>
      <div class="header" style="font-size: 18px;">${documentType.toUpperCase().replace('-', ' ')} SERVICES</div>
      
      <div class="section-title">PROJECT OVERVIEW</div>
      <p>This is a preview of your RFP formatting. The settings you customize will be applied to all generated RFP documents.</p>
      
      <div class="section-title">SCOPE OF WORK</div>
      <table class="scope-table">
        <tr>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Notes</th>
        </tr>
        <tr>
          <td>Sample work item description</td>
          <td>1,000</td>
          <td>sf</td>
          <td>This is a sample note showing how the Notes column will display with your current width settings and formatting.</td>
        </tr>
        <tr>
          <td>Another scope item with longer description text</td>
          <td>25</td>
          <td>ea</td>
          <td>Sample notes for testing</td>
        </tr>
      </table>
      
      <div class="section-title">SPACE REQUIREMENTS</div>
      <table class="space-table">
        <tr>
          <th>Space Type</th>
          <th>Area (sq ft)</th>
          <th>Notes</th>
        </tr>
        <tr>
          <td>Office Space</td>
          <td>5,000</td>
          <td>Executive offices and conference rooms</td>
        </tr>
        <tr>
          <td>Warehouse</td>
          <td>25,000</td>
          <td>High-ceiling storage area with loading docks</td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// Generate HTML for bid collection PDF
function generateBidCollectionHtml(bidCollection: any, rfp: any, lineItems: any[]) {
  const totalAmount = lineItems.reduce((sum, item) => {
    if (!item.totalPrice) return sum;
    let value = item.totalPrice;
    // If it's a formula, evaluate it
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        const { evaluateFormula } = require('../shared/formula-utils');
        const result = evaluateFormula(value);
        if (result.success) {
          value = result.value;
        } else {
          value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
        }
      } catch {
        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
      }
    }
    return sum + (parseFloat(value) || 0);
  }, 0);
  
  const currentDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Bid Collection - ${bidCollection.contractorCompany}</title>
      <style>
        @page { size: A4; margin: 0.75in; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; line-height: 1.4; }
        .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
        .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
        .header .subtitle { font-size: 14px; color: #6b7280; margin: 10px 0; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: 600; color: #1f2937; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 8px; }
        .info-label { font-weight: 600; color: #374151; }
        .info-value { color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; }
        .currency { text-align: right; }
        .total-row { background: #f3f4f6; font-weight: 600; }
        .attachments { margin-top: 20px; }
        .attachment-item { padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; margin: 5px 0; }
      </style>
    </head>
    <body>
      <div class="no-print">
        <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
        <br><small>This banner will not appear in the printed version.</small>
      </div>
      
      <div class="header">
        <h1>Bid Collection</h1>
        <div class="subtitle">RFP ${rfp.rfpNumber} - ${rfp.projectName}</div>
        <div class="subtitle">Generated on ${currentDate}</div>
      </div>

      <div class="section">
        <div class="section-title">Project Information</div>
        <div class="info-grid">
          <div>
            <div class="info-item">
              <span class="info-label">RFP Number:</span> ${rfp.rfpNumber}
            </div>
            <div class="info-item">
              <span class="info-label">Project Name:</span> ${rfp.projectName}
            </div>
            <div class="info-item">
              <span class="info-label">Tenant:</span> ${rfp.tenantName}
            </div>
          </div>
          <div>
            <div class="info-item">
              <span class="info-label">Company:</span> ${bidCollection.contractorCompany}
            </div>
            <div class="info-item">
              <span class="info-label">Submission Date:</span> ${(() => {
                if (!bidCollection.submissionDate) return 'N/A';
                try {
                  // Log the date value for debugging
                  console.log('PDF Date Debug - Original value:', bidCollection.submissionDate, 'Type:', typeof bidCollection.submissionDate);
                  
                  const dateValue = bidCollection.submissionDate;
                  let date;
                  
                  if (typeof dateValue === 'string') {
                    // If it's already in YYYY-MM-DD format, parse directly
                    if (dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
                      date = new Date(dateValue + 'T00:00:00');
                    } else {
                      date = new Date(dateValue);
                    }
                  } else if (dateValue instanceof Date) {
                    date = dateValue;
                  } else {
                    date = new Date(dateValue);
                  }
                  
                  console.log('PDF Date Debug - Parsed date:', date, 'Valid:', !isNaN(date.getTime()));
                  
                  // Check if date is valid
                  if (isNaN(date.getTime())) {
                    return 'Invalid Date';
                  }
                  
                  return date.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
                } catch (error) {
                  console.error('Date parsing error:', error, 'Original value:', bidCollection.submissionDate);
                  return 'Invalid Date';
                }
              })()}
            </div>
            <div class="info-item">
              <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Bid Line Items</div>
        <table>
          <thead>
            <tr>
              <th style="width: 40%;">Description</th>
              <th style="width: 15%;">Quantity</th>
              <th style="width: 10%;">Unit</th>
              <th style="width: 15%;">Unit Price</th>
              <th style="width: 20%;">Total Price</th>
            </tr>
          </thead>
          <tbody>
            ${lineItems.map(item => `
              <tr>
                <td>${item.description || ''}</td>
                <td class="currency">${item.quantity ? parseFloat(item.quantity).toLocaleString('en-US') : ''}</td>
                <td>${item.unit || ''}</td>
                <td class="currency">${(() => {
                  if (!item.unitPrice) return '';
                  let value = item.unitPrice;
                  // If it's a formula, evaluate it
                  if (typeof value === 'string' && value.startsWith('=')) {
                    try {
                      // Import and use the evaluateFormula function
                      const { evaluateFormula } = require('../shared/formula-utils');
                      const result = evaluateFormula(value);
                      if (result.value !== null && !result.error) {
                        value = result.value;
                      } else {
                        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                      }
                    } catch {
                      value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                    }
                  }
                  const numValue = parseFloat(value);
                  return isNaN(numValue) ? '' : '$' + numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}</td>
                <td class="currency">${(() => {
                  if (!item.totalPrice) return '';
                  let value = item.totalPrice;
                  // If it's a formula, evaluate it
                  if (typeof value === 'string' && value.startsWith('=')) {
                    try {
                      const { evaluateFormula } = require('../shared/formula-utils');
                      const result = evaluateFormula(value);
                      if (result.value !== null && !result.error) {
                        value = result.value;
                      } else {
                        value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                      }
                    } catch {
                      value = parseFloat(value.substring(1)) || 0; // fallback: try parsing after removing =
                    }
                  }
                  const numValue = parseFloat(value);
                  return isNaN(numValue) ? '' : '$' + numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                })()}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="4" style="text-align: right;"><strong>Total Bid Amount:</strong></td>
              <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      ${bidCollection.notes ? `
        <div class="section">
          <div class="section-title">Notes</div>
          <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb;">
            ${bidCollection.notes.replace(/\n/g, '<br>')}
          </div>
        </div>
      ` : ''}

      ${bidCollection.attachments && bidCollection.attachments.length > 0 ? `
        <div class="section">
          <div class="section-title">Attachments</div>
          <div class="attachments">
            ${bidCollection.attachments.map((file: any) => `
              <div class="attachment-item">
                <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

    </body>
    </html>
  `;
}

// Generate HTML for all bid collections PDF
function generateAllBidCollectionsHtml(rfp: any, allBidsData: any[]) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Categorize bids by contractor vs architect type
  const contractorBids = allBidsData.filter(({ contact }) => contact?.type === 'contractor');
  const architectBids = allBidsData.filter(({ contact }) => contact?.type === 'architect');

  // Calculate bid comparison data for contractors
  const contractorSummary = contractorBids.map(({ bid, lineItems }) => {
    const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
    return {
      company: bid.contractorCompany,
      totalAmount,
      status: bid.status,
      submissionDate: bid.submissionDate,
      lineItemCount: lineItems.length,
      type: 'contractor'
    };
  }).sort((a, b) => a.totalAmount - b.totalAmount);

  // Calculate bid comparison data for architects
  const architectSummary = architectBids.map(({ bid, lineItems }) => {
    const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
    return {
      company: bid.contractorCompany,
      totalAmount,
      status: bid.status,
      submissionDate: bid.submissionDate,
      lineItemCount: lineItems.length,
      type: 'architect'
    };
  }).sort((a, b) => a.totalAmount - b.totalAmount);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>All Bid Collections - ${rfp.rfpNumber}</title>
      <style>
        @page { size: A4; margin: 0.75in; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; line-height: 1.4; }
        .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
        .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
        .header .subtitle { font-size: 14px; color: #6b7280; margin: 10px 0; }
        .section { margin-bottom: 30px; page-break-inside: avoid; }
        .section-title { font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 15px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
        .subsection-title { font-size: 16px; font-weight: 600; color: #1f2937; margin: 20px 0 10px 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .info-item { margin-bottom: 8px; }
        .info-label { font-weight: 600; color: #374151; }
        .info-value { color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
        th { background: #f9fafb; font-weight: 600; font-size: 11px; }
        td { font-size: 11px; }
        .currency { text-align: right; }
        .total-row { background: #f3f4f6; font-weight: 600; }
        .bid-section { margin-bottom: 40px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; }
        .bid-header { background: #f9fafb; margin: -20px -20px 20px -20px; padding: 15px 20px; border-radius: 8px 8px 0 0; }
        .summary-table th { background: #1f2937; color: white; }
        .rank-1 { background: #dcfce7; }
        .rank-2 { background: #fef3c7; }
        .rank-3 { background: #fecaca; }
      </style>
    </head>
    <body>
      <div class="no-print">
        <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
        <br><small>This banner will not appear in the printed version.</small>
      </div>
      
      <div class="header">
        <h1>Bid Collection Summary</h1>
        <div class="subtitle">RFP ${rfp.rfpNumber} - ${rfp.projectName}</div>
        <div class="subtitle">Generated on ${currentDate} • ${contractorBids.length} contractor bids • ${architectBids.length} architect bids</div>
      </div>

      <div class="section">
        <div class="section-title">Project Information</div>
        <div class="info-grid">
          <div>
            <div class="info-item">
              <span class="info-label">RFP Number:</span> ${rfp.rfpNumber}
            </div>
            <div class="info-item">
              <span class="info-label">Project Name:</span> ${rfp.projectName}
            </div>
            <div class="info-item">
              <span class="info-label">Tenant:</span> ${rfp.tenantName}
            </div>
          </div>
          <div>
            <div class="info-item">
              <span class="info-label">Contractor Bids:</span> ${contractorBids.length}
            </div>
            <div class="info-item">
              <span class="info-label">Architect Bids:</span> ${architectBids.length}
            </div>
            ${contractorSummary.length > 0 ? `
            <div class="info-item">
              <span class="info-label">Lowest Contractor Bid:</span> $${contractorSummary[0]?.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) || 'N/A'}
            </div>
            ` : ''}
            ${architectSummary.length > 0 ? `
            <div class="info-item">
              <span class="info-label">Lowest Architect Bid:</span> $${architectSummary[0]?.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 }) || 'N/A'}
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      ${contractorSummary.length > 0 ? `
      <div class="section">
        <div class="section-title">Contractor Bid Comparison</div>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Company</th>
              <th>Total Amount</th>
              <th>Submission Date</th>
              <th>Line Items</th>
            </tr>
          </thead>
          <tbody>
            ${contractorSummary.map((bid, index) => `
              <tr class="${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}">
                <td style="text-align: center; font-weight: 600;">${index + 1}</td>
                <td><strong>${bid.company}</strong></td>
                <td class="currency"><strong>$${bid.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
                <td>${(() => {
                  if (!bid.submissionDate) return 'N/A';
                  try {
                    let date;
                    if (typeof bid.submissionDate === 'string') {
                      if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        date = new Date(bid.submissionDate + 'T00:00:00');
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                    } else {
                      date = new Date(bid.submissionDate);
                    }
                    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                  } catch (error) {
                    return 'Invalid Date';
                  }
                })()}</td>
                <td style="text-align: center;">${bid.lineItemCount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      ${architectSummary.length > 0 ? `
      <div class="section">
        <div class="section-title">Architect Bid Comparison</div>
        <table class="summary-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Company</th>
              <th>Total Amount</th>
              <th>Submission Date</th>
              <th>Line Items</th>
            </tr>
          </thead>
          <tbody>
            ${architectSummary.map((bid, index) => `
              <tr class="${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}">
                <td style="text-align: center; font-weight: 600;">${index + 1}</td>
                <td><strong>${bid.company}</strong></td>
                <td class="currency"><strong>$${bid.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></td>
                <td>${(() => {
                  if (!bid.submissionDate) return 'N/A';
                  try {
                    let date;
                    if (typeof bid.submissionDate === 'string') {
                      if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        date = new Date(bid.submissionDate + 'T00:00:00');
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                    } else {
                      date = new Date(bid.submissionDate);
                    }
                    return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                  } catch (error) {
                    return 'Invalid Date';
                  }
                })()}</td>
                <td style="text-align: center;">${bid.lineItemCount}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}

      ${contractorBids.length > 0 ? `<div class="section-title">Contractor Bid Details</div>` : ''}
      ${contractorBids.map(({ bid, lineItems, contact }, index) => {
        const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
        const rank = contractorSummary.findIndex(b => b.company === bid.contractorCompany) + 1;
        
        return `
          <div class="bid-section">
            <div class="bid-header">
              <h3 style="margin: 0; color: #1f2937;">Contractor Bid #${index + 1} - ${bid.contractorCompany} (Rank #${rank})</h3>
              <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">Total: $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>

            <div class="subsection-title">Company Information</div>
            <div class="info-grid">
              <div>
                <div class="info-item">
                  <span class="info-label">Company:</span> ${bid.contractorCompany}
                </div>
                <div class="info-item">
                  <span class="info-label">Submission Date:</span> ${(() => {
                    if (!bid.submissionDate) return 'N/A';
                    try {
                      let date;
                      if (typeof bid.submissionDate === 'string') {
                        if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(bid.submissionDate + 'T00:00:00');
                        } else {
                          date = new Date(bid.submissionDate);
                        }
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                      return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                    } catch (error) {
                      return 'Invalid Date';
                    }
                  })()}
                </div>
              </div>
              <div>
                <div class="info-item">
                  <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div class="subsection-title">Line Items Breakdown</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40%;">Description</th>
                  <th style="width: 15%;">Quantity</th>
                  <th style="width: 10%;">Unit</th>
                  <th style="width: 15%;">Unit Price</th>
                  <th style="width: 20%;">Total Price</th>
                </tr>
              </thead>
              <tbody>
                ${lineItems.map((item: any) => `
                  <tr>
                    <td>${item.description || ''}</td>
                    <td class="currency">${item.quantity ? parseFloat(item.quantity).toLocaleString('en-US') : ''}</td>
                    <td>${item.unit || ''}</td>
                    <td class="currency">${item.unitPrice ? '$' + parseFloat(item.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                    <td class="currency">${item.totalPrice ? '$' + parseFloat(item.totalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td colspan="4" style="text-align: right;"><strong>Bid Total:</strong></td>
                  <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </tbody>
            </table>

            ${bid.notes ? `
              <div class="subsection-title">Notes</div>
              <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; margin-bottom: 15px;">
                ${bid.notes.replace(/\n/g, '<br>')}
              </div>
            ` : ''}

            ${bid.attachments && bid.attachments.length > 0 ? `
              <div class="subsection-title">Attachments</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                ${bid.attachments.map((file: any) => `
                  <div style="padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
                    <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}

      ${architectBids.length > 0 ? `<div class="section-title">Architect Bid Details</div>` : ''}
      ${architectBids.map(({ bid, lineItems, contact }, index) => {
        const totalAmount = lineItems.reduce((sum: number, item: any) => sum + parseFloat(item.totalPrice || '0'), 0);
        const rank = architectSummary.findIndex(b => b.company === bid.contractorCompany) + 1;
        
        return `
          <div class="bid-section">
            <div class="bid-header">
              <h3 style="margin: 0; color: #1f2937;">Architect Bid #${index + 1} - ${bid.contractorCompany} (Rank #${rank})</h3>
              <div style="color: #6b7280; font-size: 12px; margin-top: 5px;">Total: $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>

            <div class="subsection-title">Company Information</div>
            <div class="info-grid">
              <div>
                <div class="info-item">
                  <span class="info-label">Company:</span> ${bid.contractorCompany}
                </div>
                <div class="info-item">
                  <span class="info-label">Submission Date:</span> ${(() => {
                    if (!bid.submissionDate) return 'N/A';
                    try {
                      let date;
                      if (typeof bid.submissionDate === 'string') {
                        if (bid.submissionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                          date = new Date(bid.submissionDate + 'T00:00:00');
                        } else {
                          date = new Date(bid.submissionDate);
                        }
                      } else {
                        date = new Date(bid.submissionDate);
                      }
                      return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString('en-US');
                    } catch (error) {
                      return 'Invalid Date';
                    }
                  })()}
                </div>
              </div>
              <div>
                <div class="info-item">
                  <span class="info-label">Total Amount:</span> $${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div class="subsection-title">Pricing Breakdown</div>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>Unit Price</th>
                  <th>Total Price</th>
                </tr>
              </thead>
              <tbody>
                ${lineItems.map((item: any) => `
                  <tr>
                    <td>${item.description}</td>
                    <td style="text-align: center;">${item.quantity || ''}</td>
                    <td>${item.unit || ''}</td>
                    <td class="currency">${item.unitPrice ? '$' + parseFloat(item.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                    <td class="currency">${item.totalPrice ? '$' + parseFloat(item.totalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                  </tr>
                `).join('')}
                <tr class="total-row">
                  <td colspan="4" style="text-align: right;"><strong>Bid Total:</strong></td>
                  <td class="currency"><strong>$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                </tr>
              </tbody>
            </table>

            ${bid.notes ? `
              <div class="subsection-title">Notes</div>
              <div style="background: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #e5e7eb; margin-bottom: 15px;">
                ${bid.notes.replace(/\n/g, '<br>')}
              </div>
            ` : ''}

            ${bid.attachments && bid.attachments.length > 0 ? `
              <div class="subsection-title">Attachments</div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                ${bid.attachments.map((file: any) => `
                  <div style="padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
                    <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}

    </body>
    </html>
  `;
}
import { generateDetailedReportPdf, generateReportFilename } from "./pdf-reports";
import { generateHistoricalPricingPdf, generateHistoricalPricingFilename } from "./historical-pricing-reports";
import { readFileSync } from "fs";
import multer from "multer";

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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage_multer = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${nanoid()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage: storage_multer,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/jpg",
      "image/png",
      "application/vnd.ms-outlook", // .msg files
      "application/octet-stream", // Generic binary files including .msg
      "text/plain", // .txt files
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

// No session middleware - pure token-based authentication
function setupSession(app: Express) {
  app.set('trust proxy', 1);
  // Sessions disabled - using token-only authentication
}

// Pure token-based authentication for reliable Replit deployment
async function requireAuth(req: any, res: any, next: any) {
  console.log(`Auth check for ${req.method} ${req.path}`);
  
  // Check for token in Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : null;

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: "Authentication required" });
  }

  const userId = await tokenStore.getUserFromToken(token);
  if (!userId) {
    console.log('Invalid token');
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  // Get user information
  try {
    let user;
    if (userId.startsWith('contact_')) {
      const contact = await storage.getContact(parseInt(userId.replace('contact_', '')));
      if (contact) {
        user = {
          id: userId,
          username: contact.email,
          firstName: contact.name.split(' ')[0],
          lastName: contact.name.split(' ').slice(1).join(' '),
          email: contact.email,
          name: contact.name,
          isAdmin: false,
          isContact: true,
          permissions: contact.permissions,
          role: 'contact'
        };
      }
    } else {
      user = await AuthService.getUserById(userId);
    }
    
    if (user) {
      req.user = user;
      req.userId = userId;
      console.log(`Token authenticated user: ${user.username}`);
      return next();
    } else {
      console.log('User not found for token');
      return res.status(401).json({ message: "User not found" });
    }
  } catch (error) {
    console.error("Error getting user in auth middleware:", error);
    return res.status(500).json({ message: "Authentication error" });
  }
}

async function requireAdmin(req: any, res: any, next: any) {
  console.log('requireAdmin middleware hit, userId:', req.userId);
  
  if (!req.userId) {
    console.log('No userId found in requireAdmin');
    return res.status(401).json({ message: "Authentication required" });
  }
  
  try {
    // Get user from database to check admin permissions
    const user = await storage.getUser(req.userId);
    console.log('User found for admin check:', user?.username, 'role:', user?.role);
    
    if (!user || (user.role !== 'admin' && !(user.permissions && user.permissions.includes('admin.access')))) {
      console.log('Admin access denied for user:', user?.username, 'role:', user?.role, 'permissions:', user?.permissions);
      return res.status(403).json({ message: "Admin access required" });
    }
    
    console.log('Admin authorization successful for user:', user.username);
    next();
  } catch (error) {
    console.error('Error in requireAdmin middleware:', error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

export async function registerRoutes(app: Express): Promise<Server> {
  // Auto-enforce legal compliance on startup for ALL properties
  // Temporarily disabled to fix database connection issue during startup
  console.log('🏛️ STARTUP: Skipping legal compliance enforcement to allow server startup...');

  // Setup session middleware
  setupSession(app);
  // Authentication routes - supports both admin users and contact emails
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // First try admin user login
      const user = await AuthService.authenticateUser({ username, password });
      if (user) {
        const token = await tokenStore.generateToken(user.id);
        console.log("Admin login successful - Token created for user:", user.username);
        
        return res.json({ 
          user, 
          token,
          message: "Login successful" 
        });
      }

      // Try contact email login
      // Try contact email login (case-insensitive)
      const [contact] = await db.select().from(contacts).where(eq(sql`LOWER(${contacts.email})`, username.toLowerCase()));
      
      if (!contact || !contact.hasSystemAccess || !contact.passwordHash) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const isValidPassword = await bcrypt.compare(password, contact.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Update last login
      await db.update(contacts)
        .set({ lastLogin: new Date() })
        .where(eq(contacts.id, contact.id));

      const userObj = {
        id: `contact_${contact.id}`,
        username: contact.email,
        name: contact.name,
        isAdmin: false,
        isContact: true,
        permissions: contact.permissions,
        role: 'contact'
      };
      
      const token = await tokenStore.generateToken(`contact_${contact.id}`);
      console.log("Contact login successful - Token created for:", contact.email);

      res.json({ 
        user: userObj,
        token,
        message: "Login successful" 
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Admin reset password endpoint
  app.post('/api/admin/reset-password', requireAuth, async (req, res) => {
    try {
      const { contactId, newPassword } = req.body;
      const user = req.user;
      
      // Check if user has admin permissions
      if (!user.permissions?.includes('admin.access')) {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      if (!contactId || !newPassword) {
        return res.status(400).json({ message: "Contact ID and new password are required" });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long" });
      }
      
      // Find the contact
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
      
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      
      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      
      // Update password
      await db.update(contacts)
        .set({ passwordHash: newPasswordHash })
        .where(eq(contacts.id, contactId));
        
      console.log(`Admin ${user.username} reset password for contact: ${contact.email}`);
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Admin reset password error:', error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Change password endpoint
  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = req.user;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long" });
      }
      
      // For contact users
      if (user.isContact) {
        const contactId = parseInt(user.id.replace('contact_', ''));
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
        
        if (!contact || !contact.passwordHash) {
          return res.status(400).json({ message: "Current password not set" });
        }
        
        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, contact.passwordHash);
        if (!isValidPassword) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
        
        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);
        
        // Update password
        await db.update(contacts)
          .set({ passwordHash: newPasswordHash })
          .where(eq(contacts.id, contactId));
          
        console.log(`Password changed for contact: ${contact.email}`);
        res.json({ message: "Password changed successfully" });
      } else {
        // For admin users
        const adminUser = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        
        if (adminUser.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }
        
        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, adminUser[0].passwordHash);
        if (!isValidPassword) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
        
        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);
        
        // Update password
        await db.update(users)
          .set({ passwordHash: newPasswordHash })
          .where(eq(users.id, user.id));
          
        console.log(`Password changed for admin user: ${adminUser[0].username}`);
        res.json({ message: "Password changed successfully" });
      }
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (token) {
      await tokenStore.removeToken(token);
    }

    // Destroy session
    if (req.session) {
      req.session.destroy((err: any) => {
        if (err) {
          console.error('Session destruction error:', err);
        }
      });
    }

    res.json({ message: "Logout successful" });
  });

  app.get('/api/auth/user', async (req, res) => {
    try {
      // Check authentication first
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      if (!token) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Validate token
      const userId = await tokenStore.getUserFromToken(token);
      if (!userId) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      // Get actual user data based on token
      if (userId.startsWith('contact_')) {
        const contactId = parseInt(userId.replace('contact_', ''));
        const contact = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
        
        if (contact.length === 0) {
          return res.status(401).json({ message: "User not found" });
        }
        
        const user = contact[0];
        res.json({
          id: userId,
          username: user.email,
          firstName: user.name.split(' ')[0],
          lastName: user.name.split(' ').slice(1).join(' '),
          email: user.email,
          name: user.name,
          isAdmin: user.permissions?.includes('admin.access') || false,
          isContact: true,
          permissions: user.permissions || [],
          role: user.permissions?.includes('admin.access') ? 'admin' : 'contact'
        });
      } else {
        // Regular user from users table
        const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        
        if (user.length === 0) {
          return res.status(401).json({ message: "User not found" });
        }
        
        const userData = user[0];
        res.json({
          id: userData.id,
          username: userData.username,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          name: `${userData.firstName} ${userData.lastName}`,
          isAdmin: userData.role === 'admin',
          isContact: false,
          permissions: userData.permissions || [],
          role: userData.role
        });
      }
    } catch (error) {
      console.error('Auth user error:', error);
      res.status(401).json({ message: "Authentication failed" });
    }
  });

  app.post('/api/auth/init-admin', async (req, res) => {
    try {
      const existingAdmin = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
      
      if (existingAdmin.length > 0) {
        return res.status(400).json({ message: "Admin user already exists" });
      }

      const adminUser = await AuthService.createUser({
        username: 'admin',
        password: 'admin123',
        email: 'admin@rfptracker.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        permissions: [
          'admin.access',
          'users.view', 'users.edit', 'users.create', 'users.delete',
          'rfp.create', 'rfp.edit', 'rfp.view', 'rfp.delete',
          'properties.create', 'properties.edit', 'properties.view', 'properties.delete',
          'contacts.create', 'contacts.edit', 'contacts.view', 'contacts.delete',
          'reports.view', 'reports.generate'
        ]
      });

      res.json({ message: "Admin user created successfully", user: adminUser });
    } catch (error) {
      console.error("Init admin error:", error);
      res.status(500).json({ message: "Failed to create admin user" });
    }
  });
  // Test route to debug multer
  app.post("/api/test-upload", upload.array("files"), (req, res) => {
    console.log("Test upload route hit");
    console.log("Body:", req.body);
    console.log("Files:", req.files);
    res.json({ body: req.body, files: req.files });
  });

  // Generic upload endpoint for single files
  app.post("/api/upload", upload.single("file"), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      res.json({
        message: "File uploaded successfully",
        filePath: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Get RFP statistics (must come before /:id route)
  app.get("/api/rfp-requests/stats", async (req, res) => {
    try {
      const allRequests = await storage.getAllRfpRequests();
      const activeRequests = allRequests.filter(r => r.status !== "archived");
      
      const stats = {
        total: activeRequests.length, // Total of active RFPs only
        received: allRequests.filter(r => r.status === "received").length,
        inProgress: allRequests.filter(r => r.status === "in-progress").length,
        completed: allRequests.filter(r => r.status === "completed").length,
        onHold: allRequests.filter(r => r.status === "on-hold").length,
        archived: allRequests.filter(r => r.status === "archived").length,
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Helper function to hydrate live bay configurations from properties
  const hydrateLiveBayConfigurations = async (rfp: any) => {
    console.log(`🔍 Hydration called for RFP ${rfp.rfpNumber}: propertyId=${rfp.propertyId}, selectedBayIds=${rfp.selectedBayIds}, property=${rfp.property}, bayConfigsLength=${rfp.selectedBayConfigurations?.length}`);
    
    try {
      // Single building RFP with bay IDs (new approach)
      if (rfp.propertyId && rfp.selectedBayIds && rfp.selectedBayIds.length > 0) {
        const property = await storage.getProperty(rfp.propertyId);
        if (property && property.bayConfigurations) {
          const liveBays = property.bayConfigurations.filter((bay: any) => 
            rfp.selectedBayIds.includes(bay.id)
          );
          return {
            ...rfp,
            selectedBayConfigurations: liveBays,
            _originalBaySnapshot: rfp.selectedBayConfigurations
          };
        }
      }
      
      // Multi-building RFP with bay IDs (new approach)
      if (rfp.isMultiBuilding && rfp.bayIdsPerBuilding && rfp.propertyIdsPerBuilding) {
        const selectedBaysPerBuilding: {[propertyName: string]: any[]} = {};
        
        for (const [propertyName, propertyId] of Object.entries(rfp.propertyIdsPerBuilding)) {
          const property = await storage.getProperty(propertyId as number);
          const bayIds = rfp.bayIdsPerBuilding[propertyName];
          
          if (property && property.bayConfigurations && bayIds) {
            const liveBays = property.bayConfigurations.filter((bay: any) => 
              bayIds.includes(bay.id)
            );
            selectedBaysPerBuilding[propertyName] = liveBays;
          }
        }
        
        return {
          ...rfp,
          selectedBaysPerBuilding: selectedBaysPerBuilding,
          _originalBaySnapshot: rfp.selectedBaysPerBuilding
        };
      }
      
      // LEGACY SUPPORT: Try to infer bay data for old RFPs by matching bay names
      // This handles existing RFPs that don't have bay IDs
      if (rfp.property && rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
        let property;
        
        // Try to parse property field as ID first (old RFPs store numeric ID as string)
        const propertyIdFromString = parseInt(rfp.property);
        if (!isNaN(propertyIdFromString)) {
          property = await storage.getProperty(propertyIdFromString);
          console.log(`🔍 Legacy RFP ${rfp.rfpNumber}: Found property by ID ${propertyIdFromString}`);
        }
        
        // If that didn't work, try matching by name
        if (!property) {
          const allProperties = await storage.getAllProperties();
          property = allProperties.find((p: any) => 
            rfp.property.includes(p.propertyName) || 
            rfp.property === p.displayName
          );
          if (property) {
            console.log(`🔍 Legacy RFP ${rfp.rfpNumber}: Found property by name match`);
          }
        }
        
        if (property && property.bayConfigurations) {
          // Match bays by bay name
          const liveBays = rfp.selectedBayConfigurations.map((snapshotBay: any) => {
            const liveBay = property.bayConfigurations.find((bay: any) => 
              bay.bayName === snapshotBay.bayName
            );
            // Use live bay data if found, otherwise keep snapshot
            return liveBay || snapshotBay;
          });
          
          const hydratedCount = liveBays.filter((b: any, i: number) => b !== rfp.selectedBayConfigurations[i]).length;
          console.log(`🔄 Legacy RFP ${rfp.rfpNumber}: Hydrated ${hydratedCount} of ${rfp.selectedBayConfigurations.length} bays with live data`);
          
          return {
            ...rfp,
            selectedBayConfigurations: liveBays,
            _wasLegacyHydrated: true,
            _originalBaySnapshot: rfp.selectedBayConfigurations
          };
        }
      }
      
      // Fallback to original snapshot data
      return rfp;
    } catch (error) {
      console.error('Error hydrating live bay data:', error);
      // On error, return original RFP with snapshot data
      return rfp;
    }
  };

  // Get all RFP requests
  app.get("/api/rfp-requests", async (req, res) => {
    // Prevent caching to ensure fresh data with hydration
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      const { search, status, include_archived } = req.query;
      
      let requests;
      if (search) {
        requests = await storage.searchRfpRequests(search as string);
        // Exclude archived from search results unless specifically searching for archived
        if (status !== "archived" && !include_archived) {
          requests = requests.filter(r => r.status !== "archived");
        }
      } else if (status) {
        requests = await storage.filterRfpRequestsByStatus(status as string);
      } else {
        // Default view: get all RFPs except archived (unless include_archived is true)
        requests = await storage.getAllRfpRequests();
        if (!include_archived) {
          requests = requests.filter(r => r.status !== "archived");
        }
      }
      
      // Fetch LIVE bay data from properties for all RFPs (single source of truth)
      const requestsWithLiveData = await Promise.all(
        requests.map(async (rfp) => {
          // Single building with bay IDs
          if (rfp.propertyId && rfp.selectedBayIds && rfp.selectedBayIds.length > 0) {
            const property = await storage.getProperty(rfp.propertyId);
            if (property?.bayConfigurations) {
              rfp.selectedBayConfigurations = property.bayConfigurations.filter((bay: any) => 
                rfp.selectedBayIds!.includes(bay.id)
              );
            }
          }
          // Multi-building with bay IDs per building
          else if (rfp.bayIdsPerBuilding && Object.keys(rfp.bayIdsPerBuilding).length > 0) {
            const allLiveBays: any[] = [];
            for (const [propertyIdStr, bayIds] of Object.entries(rfp.bayIdsPerBuilding)) {
              const propId = parseInt(propertyIdStr);
              const property = await storage.getProperty(propId);
              if (property?.bayConfigurations) {
                const baysForProperty = property.bayConfigurations.filter((bay: any) => 
                  bayIds.includes(bay.id)
                );
                allLiveBays.push(...baysForProperty);
              }
            }
            rfp.selectedBayConfigurations = allLiveBays;
          }
          // Legacy: property field contains property ID
          else if (rfp.property) {
            const propertyId = parseInt(String(rfp.property));
            if (!isNaN(propertyId)) {
              const property = await storage.getProperty(propertyId);
              if (property?.bayConfigurations && rfp.selectedBayConfigurations) {
                rfp.selectedBayConfigurations = rfp.selectedBayConfigurations.map((selectedBay: any) => {
                  const matchedBay = property.bayConfigurations.find((pb: any) => 
                    pb.bayName === selectedBay.bayName
                  );
                  return matchedBay || selectedBay;
                });
              }
            }
          }
          return rfp;
        })
      );
      
      res.json(requestsWithLiveData);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch RFP requests" });
    }
  });

  // Helper function to find the root RFP ID by walking up the parent chain
  const findRootRfpId = (rfp: any, rfpMap: Map<number, any>): number => {
    let current = rfp;
    const visited = new Set<number>();
    
    // Handle both camelCase and snake_case field names
    const getParentId = (obj: any) => obj.parentRfpId || obj.parent_rfp_id;
    
    while (getParentId(current) && !visited.has(current.id)) {
      visited.add(current.id);
      const parentId = getParentId(current);
      const parent = rfpMap.get(parentId);
      if (!parent) {
        console.log(`⚠️ WARNING: Parent RFP ${parentId} not found in map for RFP ${current.id}`);
        break;
      }
      current = parent;
    }
    
    return current.id;
  };

  // Get top 5 completed RFPs by cost (only completed RFPs have evaluation workflow and costs)
  app.get("/api/rfp-requests/top-open-by-cost", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      
      // Get completed RFPs (only completed RFPs have evaluation workflow and cost calculations)
      const allRfps = await storage.getAllRfpRequests();
      const filteredRfps = allRfps.filter(rfp => 
        rfp.status === 'completed'
      );
      
      // Create a map for efficient parent lookup
      const rfpMap = new Map(filteredRfps.map(rfp => [rfp.id, rfp]));
      
      // Transform RFPs to include cost and area data
      const enrichedRfps = await Promise.all(filteredRfps.map(async (rfp) => {
        let improvementCostTotal = null;
        let areaSf = null;
        
        // Try to get cost from evaluation budget first
        try {
          const budget = await storage.getEvaluationBudget(rfp.id);
          if (budget && budget.grandTotal) {
            improvementCostTotal = parseFloat(budget.grandTotal.toString()) || null;
          }
        } catch (error) {
          // Evaluation budget might not exist, continue
        }
        
        // Fallback to estimatedValue if no budget data
        if (!improvementCostTotal && rfp.estimatedValue) {
          const cleanValue = rfp.estimatedValue.replace(/[$,]/g, '');
          improvementCostTotal = parseFloat(cleanValue) || null;
        }
        
        // Calculate area from projectArea or bay configurations
        if (rfp.projectArea) {
          const cleanArea = rfp.projectArea.replace(/[,]/g, '');
          areaSf = parseFloat(cleanArea) || null;
        } else if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
          areaSf = rfp.selectedBayConfigurations.reduce((total, bay) => 
            total + (bay.rentableSquareFootage || bay.squareFootage || 0), 0
          );
        } else if (rfp.isMultiBuilding && rfp.selectedBaysPerBuilding) {
          // Calculate total area for multi-building RFPs
          areaSf = Object.values(rfp.selectedBaysPerBuilding).flat().reduce((total, bay: any) => 
            total + (bay.rentableSquareFootage || bay.squareFootage || 0), 0
          );
        }
        
        // Calculate cost per SF - handle edge case: area_sf <= 0 should return null
        const costPerSf = (improvementCostTotal && areaSf && areaSf > 0) 
          ? improvementCostTotal / areaSf 
          : null;
        
        // Get proper property display name
        let propertyDisplayName = '';
        if (rfp.isMultiBuilding && rfp.properties && rfp.properties.length > 0) {
          propertyDisplayName = rfp.properties.join(', ');
        } else if (rfp.property) {
          // Try to get the full property details by property ID
          try {
            const propertyId = parseInt(rfp.property);
            if (!isNaN(propertyId)) {
              const allProperties = await storage.getAllProperties();
              const matchingProperty = allProperties.find(p => p.id === propertyId);
              if (matchingProperty) {
                // Use property name and building number (if applicable) without full address
                if (matchingProperty.building) {
                  propertyDisplayName = `${matchingProperty.propertyName} - Building ${matchingProperty.building}`;
                } else {
                  propertyDisplayName = matchingProperty.propertyName;
                }
              } else {
                propertyDisplayName = rfp.property;
              }
            } else {
              propertyDisplayName = rfp.property;
            }
          } catch (error) {
            propertyDisplayName = rfp.property;
          }
        } else {
          propertyDisplayName = 'Unknown Property';
        }

        return {
          id: rfp.id.toString(),
          originalRfp: rfp,  // Keep reference for family grouping
          tenant_name: rfp.tenantName,
          property_name: propertyDisplayName,
          status: rfp.status,
          area_sf: areaSf,
          improvement_cost_total: improvementCostTotal,
          cost_per_sf: costPerSf
        };
      }));
      
      // Group RFPs by family (root RFP) and pick the highest cost one from each family
      const familyBestRfps = new Map<number, any>();
      
      enrichedRfps.forEach(enrichedRfp => {
        // Skip RFPs without cost data
        if (enrichedRfp.improvement_cost_total === null || enrichedRfp.improvement_cost_total <= 0) {
          return;
        }
        
        const rootRfpId = findRootRfpId(enrichedRfp.originalRfp, rfpMap);
        const existingBest = familyBestRfps.get(rootRfpId);
        
        
        if (!existingBest || 
            enrichedRfp.improvement_cost_total > existingBest.improvement_cost_total ||
            (enrichedRfp.improvement_cost_total === existingBest.improvement_cost_total && 
             new Date(enrichedRfp.originalRfp.completedDate || enrichedRfp.originalRfp.updatedAt) > 
             new Date(existingBest.originalRfp.completedDate || existingBest.originalRfp.updatedAt))) {
          familyBestRfps.set(rootRfpId, enrichedRfp);
        }
      });
      
      // Get the best RFPs from each family and remove the original RFP reference
      const deduplicatedRfps = Array.from(familyBestRfps.values()).map(rfp => {
        const { originalRfp, ...cleanRfp } = rfp;
        return cleanRfp;
      });
      
      // Sort by cost descending and take top results
      deduplicatedRfps.sort((a, b) => (b.improvement_cost_total || 0) - (a.improvement_cost_total || 0));
      const result = deduplicatedRfps.slice(0, limit);
      
      
      res.json(result);
    } catch (error) {
      console.error('Error fetching top active RFPs by cost:', error);
      res.status(500).json({ message: "Failed to fetch top active RFPs by cost" });
    }
  });

  // Get single RFP request with LIVE property bay data (single source of truth)
  app.get("/api/rfp-requests/:id", async (req, res) => {
    // Prevent caching to ensure fresh data
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // ALWAYS fetch live bay data from properties (single source of truth)
      // Single building with bay IDs (new approach)
      if (rfp.propertyId && rfp.selectedBayIds && rfp.selectedBayIds.length > 0) {
        const property = await storage.getProperty(rfp.propertyId);
        if (property?.bayConfigurations) {
          const liveBays = property.bayConfigurations.filter((bay: any) => 
            rfp.selectedBayIds!.includes(bay.id)
          );
          rfp.selectedBayConfigurations = liveBays;
        }
      }
      // Multi-building with bay IDs per building
      else if (rfp.bayIdsPerBuilding && Object.keys(rfp.bayIdsPerBuilding).length > 0) {
        const allLiveBays: any[] = [];
        for (const [propertyIdStr, bayIds] of Object.entries(rfp.bayIdsPerBuilding)) {
          const propId = parseInt(propertyIdStr);
          const property = await storage.getProperty(propId);
          if (property?.bayConfigurations) {
            const baysForProperty = property.bayConfigurations.filter((bay: any) => 
              bayIds.includes(bay.id)
            );
            allLiveBays.push(...baysForProperty);
          }
        }
        rfp.selectedBayConfigurations = allLiveBays;
      }
      // Legacy: property field contains property ID as string/number
      else if (rfp.property) {
        const propertyId = parseInt(String(rfp.property));
        if (!isNaN(propertyId)) {
          const property = await storage.getProperty(propertyId);
          if (property?.bayConfigurations && rfp.selectedBayConfigurations) {
            // Match by bay name for legacy RFPs to get current data
            const liveBays = rfp.selectedBayConfigurations.map((selectedBay: any) => {
              const matchedBay = property.bayConfigurations.find((pb: any) => 
                pb.bayName === selectedBay.bayName
              );
              return matchedBay || selectedBay;
            });
            rfp.selectedBayConfigurations = liveBays;
          }
        }
      }

      res.json(rfp);
    } catch (error) {
      console.error('Error fetching RFP:', error);
      res.status(500).json({ message: "Failed to fetch RFP request" });
    }
  });

  // Create new RFP request
  app.post("/api/rfp-requests", upload.array("files"), async (req, res) => {
    try {
      
      const formData = { ...req.body };
      
      // Convert string boolean to actual boolean for multi-building support
      if (formData.isMultiBuilding === 'true') {
        formData.isMultiBuilding = true;
      } else if (formData.isMultiBuilding === 'false') {
        formData.isMultiBuilding = false;
      } else {
        formData.isMultiBuilding = false; // default to false
      }
      
      // Convert propertyId from string to number if present (schema expects number)
      if (formData.propertyId && typeof formData.propertyId === 'string') {
        formData.propertyId = parseInt(formData.propertyId);
      }
      
      const parsed = insertRfpRequestSchema.parse(formData);
      
      // Create RFP without files initially
      const requestData = {
        ...parsed,
        files: [],
        dueDate: parsed.internalDueDate, // Map internalDueDate to dueDate for validation
      };

      const newRequest = await storage.createRfpRequest(requestData);
      
      // Automatically advance workflow from "rfp-entry" to "rfp-validation" after creation
      // Step 1 (RFP Entry) is now complete, move to Step 2 (RFP Validation)
      // Keep status as "received" (purple) until validation team completes Step 2
      console.log('Auto-advancing RFP workflow from rfp-entry to rfp-validation');
      const advancedRequest = await storage.updateRfpRequest(newRequest.id, {
        workflowPhase: "rfp-validation"
        // status remains "received" until Step 2 validation is completed
      });
      
      // Send Step 1 completion email (RFP Entry complete) with attachments
      try {
        const rfpForEmail = advancedRequest || newRequest;
        await sendWorkflowCompletionEmail(rfpForEmail, 'rfp-entry');
      } catch (emailError) {
        console.error('Failed to send RFP entry completion email:', emailError);
        // Don't fail the request if email fails
      }
      
      res.status(201).json(advancedRequest || newRequest);
    } catch (error) {
      console.error('RFP creation error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Invalid request data" 
      });
    }
  });

  // Create new RFP request with files
  app.post("/api/rfp-requests/with-files", upload.array("files"), async (req, res) => {
    try {
      console.log('Creating RFP with files - body:', req.body);
      console.log('Creating RFP with files - user ID:', (req as any).userId);
      console.log('Creating RFP with files - projectArea specifically:', req.body.projectArea);
      
      // Parse form data properly
      const formData = { ...req.body };
      
      // Parse requestTypes JSON array
      if (formData.requestTypes && typeof formData.requestTypes === 'string') {
        try {
          formData.requestTypes = JSON.parse(formData.requestTypes);
        } catch {
          formData.requestTypes = [];
        }
      }

      // Parse areaBreakdown JSON array
      if (formData.areaBreakdown && typeof formData.areaBreakdown === 'string') {
        try {
          formData.areaBreakdown = JSON.parse(formData.areaBreakdown);
        } catch {
          formData.areaBreakdown = [];
        }
      }

      // Convert string boolean to actual boolean
      if (formData.confidential === 'true') {
        formData.confidential = true;
      } else if (formData.confidential === 'false') {
        formData.confidential = false;
      } else {
        formData.confidential = false; // default to false
      }

      // Parse multi-building fields
      if (formData.isMultiBuilding === 'true') {
        formData.isMultiBuilding = true;
      } else if (formData.isMultiBuilding === 'false') {
        formData.isMultiBuilding = false;
      } else {
        formData.isMultiBuilding = false; // default to false
      }

      // Parse selectedBaysPerBuilding JSON object
      if (formData.selectedBaysPerBuilding && typeof formData.selectedBaysPerBuilding === 'string') {
        try {
          formData.selectedBaysPerBuilding = JSON.parse(formData.selectedBaysPerBuilding);
        } catch {
          formData.selectedBaysPerBuilding = {};
        }
      }

      // Parse costsPerBuilding JSON object and convert numeric strings to numbers
      if (formData.costsPerBuilding && typeof formData.costsPerBuilding === 'string') {
        try {
          const parsedCosts = JSON.parse(formData.costsPerBuilding);
          // Convert all numeric cost values from strings to numbers
          formData.costsPerBuilding = Object.entries(parsedCosts).reduce((acc: any, [key, value]: [string, any]) => {
            acc[key] = {
              existing: Number(value.existing) || 0,
              improvements: Number(value.improvements) || 0,
              rom: Number(value.rom) || 0,
              notes: value.notes || ''
            };
            return acc;
          }, {});
        } catch {
          formData.costsPerBuilding = {};
        }
      }

      // Convert propertyId from string to number if present (schema expects number)
      if (formData.propertyId && typeof formData.propertyId === 'string') {
        formData.propertyId = parseInt(formData.propertyId);
      }

      // Ensure sentBy field is present (frontend should send this directly now)

      // Parse with schema first, then convert dates for database
      const parsed = insertRfpRequestSchema.parse(formData);
      
      // Convert date strings to Date objects for database storage using centralized utility
      if (parsed.receivedOn && typeof parsed.receivedOn === 'string') {
        parsed.receivedOn = convertFormDateToDbDate(parsed.receivedOn);
      }
      if (parsed.internalDueDate && typeof parsed.internalDueDate === 'string') {
        parsed.internalDueDate = convertFormDateToDbDate(parsed.internalDueDate);
      }
      if (parsed.contractorDueDate && typeof parsed.contractorDueDate === 'string') {
        parsed.contractorDueDate = convertFormDateToDbDate(parsed.contractorDueDate);
      }
      if (parsed.architectDueDate && typeof parsed.architectDueDate === 'string') {
        parsed.architectDueDate = convertFormDateToDbDate(parsed.architectDueDate);
      }
      
      // Handle uploaded files
      const uploadedFiles = (req.files as Express.Multer.File[] || []).map(file => ({
        id: nanoid(),
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: file.filename,
      }));

      // Handle selected bay configurations
      let selectedBayConfigurations: any[] = [];
      if (req.body.selectedBayConfigurations) {
        try {
          selectedBayConfigurations = JSON.parse(req.body.selectedBayConfigurations);
          console.log('Parsed selectedBayConfigurations:', selectedBayConfigurations.length, 'bays');
        } catch (e) {
          console.error('Failed to parse selectedBayConfigurations:', e);
        }
      }
      
      // Handle bay configuration IDs for real-time synchronization
      let propertyId: number | undefined = undefined;
      let selectedBayIds: string[] | undefined = undefined;
      let propertyIdsPerBuilding: {[propertyName: string]: number} | undefined = undefined;
      let bayIdsPerBuilding: {[propertyName: string]: string[]} | undefined = undefined;
      
      if (req.body.propertyId) {
        propertyId = parseInt(req.body.propertyId);
      }
      
      if (req.body.selectedBayIds) {
        try {
          selectedBayIds = JSON.parse(req.body.selectedBayIds);
          console.log('Parsed selectedBayIds:', selectedBayIds?.length || 0, 'bay IDs');
        } catch (e) {
          console.error('Failed to parse selectedBayIds:', e);
        }
      }

      // If we have propertyId and selectedBayIds but no selectedBayConfigurations,
      // fetch the property and extract the matching bay configurations
      if (propertyId && selectedBayIds && selectedBayIds.length > 0 && selectedBayConfigurations.length === 0) {
        try {
          const property = await storage.getProperty(propertyId);
          if (property && property.bayConfigurations) {
            selectedBayConfigurations = property.bayConfigurations.filter(bay => 
              selectedBayIds.includes(bay.id)
            );
            console.log('Retrieved', selectedBayConfigurations.length, 'bay configurations from property', propertyId);
          }
        } catch (e) {
          console.error('Failed to retrieve bay configurations from property:', e);
        }
      }
      
      if (req.body.propertyIdsPerBuilding) {
        try {
          propertyIdsPerBuilding = JSON.parse(req.body.propertyIdsPerBuilding);
          console.log('Parsed propertyIdsPerBuilding:', Object.keys(propertyIdsPerBuilding || {}).length, 'properties');
        } catch (e) {
          console.error('Failed to parse propertyIdsPerBuilding:', e);
        }
      }
      
      if (req.body.bayIdsPerBuilding) {
        try {
          bayIdsPerBuilding = JSON.parse(req.body.bayIdsPerBuilding);
          console.log('Parsed bayIdsPerBuilding:', Object.keys(bayIdsPerBuilding || {}).length, 'buildings');
        } catch (e) {
          console.error('Failed to parse bayIdsPerBuilding:', e);
        }
      }

      const requestWithFiles = {
        ...parsed,
        files: uploadedFiles,
        selectedBayConfigurations: selectedBayConfigurations,
        propertyId: propertyId,
        selectedBayIds: selectedBayIds,
        propertyIdsPerBuilding: propertyIdsPerBuilding,
        bayIdsPerBuilding: bayIdsPerBuilding,
        dueDate: parsed.internalDueDate, // Map internalDueDate to dueDate for validation
      };

      console.log('🔍 RFP Creation Debug:');
      console.log('  - selectedBayConfigurations:', requestWithFiles.selectedBayConfigurations?.length || 0, 'bays');
      console.log('  - propertyId:', requestWithFiles.propertyId);
      console.log('  - selectedBayIds:', requestWithFiles.selectedBayIds?.length || 0, 'IDs');
      console.log('About to create RFP with selectedBayConfigurations:', requestWithFiles.selectedBayConfigurations?.length || 0);

      const newRequest = await storage.createRfpRequest(requestWithFiles);
      
      // Automatically advance workflow from "rfp-entry" to "rfp-validation" after creation
      // Step 1 (RFP Entry) is now complete, move to Step 2 (RFP Validation)
      // Keep status as "received" (purple) until validation team completes Step 2
      console.log('Auto-advancing RFP workflow from rfp-entry to rfp-validation');
      const advancedRequest = await storage.updateRfpRequest(newRequest.id, {
        workflowPhase: "rfp-validation"
        // status remains "received" until Step 2 validation is completed
      });
      
      // Send Step 1 completion email (RFP Entry complete) with attachments
      try {
        const rfpForEmail = advancedRequest || newRequest;
        await sendWorkflowCompletionEmail(rfpForEmail, 'rfp-entry');
      } catch (emailError) {
        console.error('Failed to send RFP entry completion email:', emailError);
        // Don't fail the request if email fails
      }
      
      res.status(201).json(advancedRequest || newRequest);
    } catch (error) {
      console.error('RFP creation error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Invalid request data" 
      });
    }
  });

  // Update RFP request
  app.patch("/api/rfp-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const updates = updateRfpRequestSchema.parse({ ...req.body, id });
      const updatedRequest = await storage.updateRfpRequest(id, updates);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Invalid update data" 
      });
    }
  });

  // Advance workflow phase
  app.post("/api/rfp-requests/:id/advance-phase", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const { newPhase } = req.body;
      if (!newPhase) {
        return res.status(400).json({ message: "New phase is required" });
      }

      const updatedRequest = await storage.advanceWorkflowPhase(id, newPhase);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Send Step 6 completion email when advancing to publish phase
      if (newPhase === 'publish') {
        try {
          await sendWorkflowCompletionEmail(updatedRequest, 'publish');
        } catch (emailError) {
          console.error('Failed to send publish completion email:', emailError);
        }
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to advance workflow phase" 
      });
    }
  });

  // Archive RFP
  app.patch("/api/rfp-requests/:id/archive", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      if (rfp.status !== 'completed') {
        return res.status(400).json({ message: "Only completed RFPs can be archived" });
      }

      const updatedRequest = await storage.updateRfpRequest(id, { status: 'archived' });
      res.json(updatedRequest);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to archive RFP" 
      });
    }
  });

  // Reopen RFP (move from completed back to in-progress)
  app.patch("/api/rfp-requests/:id/reopen", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      if (rfp.status !== 'completed') {
        return res.status(400).json({ message: "Only completed RFPs can be reopened" });
      }

      // Clear completion date when reopening
      const updatedRequest = await storage.updateRfpRequest(id, { 
        status: 'in-progress',
        completedDate: null
      });
      res.json(updatedRequest);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to reopen RFP" 
      });
    }
  });


  // Create RFP Option (alternative design/scope for same project)
  app.post("/api/rfp-requests/:id/create-option", async (req, res) => {
    console.log("Auth check for POST /api/rfp-requests/:id/create-option");
    
    // Token-based authentication (sessions are disabled)
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      console.log("No token provided");
      return res.status(401).json({ message: "No token provided" });
    }

    const userId = await tokenStore.getUserFromToken(token);
    if (!userId) {
      console.log("Invalid or expired token");
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    console.log("Token authenticated user:", userId);
    try {
      const id = parseInt(req.params.id);
      const { optionType, optionTitle, formData } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      if (!optionType || !optionTitle) {
        return res.status(400).json({ message: "Option type and title are required" });
      }

      const originalRfp = await storage.getRfpRequest(id);
      if (!originalRfp) {
        return res.status(404).json({ message: "Original RFP request not found" });
      }

      // RFP options can be created at any time during the workflow
      // Generate option number (add .A, .B, .C suffix to original RFP number)
      const baseRfpNumber = originalRfp.rfpNumber;
      
      // Check for existing options to increment letter
      const existingOptions = await storage.getRfpRequestsByParentId(id);
      const optionCount = existingOptions.filter(rfp => rfp.isOption).length;
      const optionLetter = String.fromCharCode(65 + optionCount); // A, B, C, etc.
      
      const optionRfpNumber = `${baseRfpNumber}.${optionLetter}`;

      // Create option as minimal draft for independent workflow
      let optionData = {
        rfpNumber: optionRfpNumber,
        parentRfpId: id,
        isOption: true,
        optionType: optionType,
        // Only copy essential tenant information - keep tenant name for reference
        tenantName: originalRfp.tenantName,
        projectName: `${originalRfp.projectName} (${optionTitle})`,
        confidential: originalRfp.confidential,
        sentBy: originalRfp.sentBy,
        // Use current date as placeholder for workflow to modify
        receivedOn: new Date(),
        internalDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now as placeholder
        contractorDueDate: null,
        architectDueDate: null,
        // Leave property/space selection empty for workflow - use placeholder to avoid constraint
        property: "Select property...",
        projectArea: null,
        selectedBayConfigurations: [],
        // Start fresh for independent configuration
        developmentContact: null,
        requestTypes: ["pricing"], // Default request type to prevent validation issues
        status: 'in-progress',
        workflowPhase: 'rfp-entry', // Start at Step 1
        notes: `RFP alternate (${optionTitle}) - configure independently`,
        files: [],
        // Clear all validation fields for fresh start
        generalContractor: null,
        architect: null,
        officeAreaExisting: null,
        officeAreaNew: null,
        warehouseArea: null,
        warehouseAreaOverride: null,
        warehouseNotes: null,
        areaBreakdown: [],
        projectAddress: null,
        projectSize: null,
        estimatedValue: null,
        timelineRequirements: null,
        specialRequirements: null,
        contactPerson: null,
        contactEmail: null,
        dueDate: null,
        projectDescription: null,
        documentsLink: null,
      };

      // If formData is provided, override with user's form input
      if (formData) {
        optionData = {
          ...optionData,
          tenantName: formData.tenantName || optionData.tenantName,
          projectName: formData.projectName || optionData.projectName,
          property: formData.property || optionData.property,
          receivedOn: formData.receivedOn ? new Date(formData.receivedOn) : optionData.receivedOn,
          internalDueDate: formData.internalDueDate ? new Date(formData.internalDueDate) : optionData.internalDueDate,
          developmentContact: formData.developmentContact || optionData.developmentContact,
          projectArea: formData.projectArea || optionData.projectArea,
          requestTypes: formData.requestTypes || optionData.requestTypes,
          notes: formData.notes || optionData.notes,
          selectedBayConfigurations: formData.selectedBayConfigurations || optionData.selectedBayConfigurations,
          confidential: formData.confidential !== undefined ? formData.confidential : optionData.confidential,
        };
      }

      // Create the option RFP using storage method
      const option = await storage.createRfpRequest({
        ...optionData,
        overrides: originalRfp.overrides || {},
        metadata: {}
      });

      res.status(201).json(option);
    } catch (error) {
      console.error('Create RFP option error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create RFP option" 
      });
    }
  });

  // Create Counter Offer (duplicate RFP with versioned ID)
  app.post("/api/rfp-requests/:id/counter-offer", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const originalRfp = await storage.getRfpRequest(id);
      if (!originalRfp) {
        return res.status(404).json({ message: "Original RFP request not found" });
      }

      if (originalRfp.status !== 'completed' && originalRfp.status !== 'archived') {
        return res.status(400).json({ message: "Only completed or archived RFPs can have counter offers" });
      }

      // Generate versioned RFP number (add .01 suffix to original RFP number)
      const baseRfpNumber = originalRfp.rfpNumber; // Keep the full original RFP number
      
      // Check for existing counter offers to increment version
      const existingCounterOffers = await storage.getRfpRequestsByParentId(id);
      let versionNumber = existingCounterOffers.length + 1;
      
      const versionedRfpNumber = `${baseRfpNumber}.${versionNumber.toString().padStart(2, '0')}`;

      // Create counter offer by duplicating original RFP data
      const counterOfferData = {
        rfpNumber: versionedRfpNumber,
        parentRfpId: id,
        isCounterOffer: true,
        property: originalRfp.property,
        tenantName: originalRfp.tenantName,
        projectName: `${originalRfp.projectName} (Counter Offer ${versionNumber})`,
        confidential: originalRfp.confidential,
        sentBy: originalRfp.sentBy,
        receivedOn: new Date(), // Use current date for counter offer
        internalDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days from now
        contractorDueDate: originalRfp.contractorDueDate,
        architectDueDate: originalRfp.architectDueDate,
        developmentContact: originalRfp.developmentContact,
        projectArea: originalRfp.projectArea,
        requestTypes: originalRfp.requestTypes,
        status: 'in-progress', // Start as in-progress
        workflowPhase: 'rfp-entry', // Always start counter offers at step 1
        notes: `Counter offer created from RFP ${originalRfp.rfpNumber}`,
        files: [], // Start with no files
        selectedBayConfigurations: originalRfp.selectedBayConfigurations || [],
        // Copy validation fields
        generalContractor: originalRfp.generalContractor,
        architect: originalRfp.architect,
        officeAreaExisting: originalRfp.officeAreaExisting,
        officeAreaNew: originalRfp.officeAreaNew,
        warehouseArea: originalRfp.warehouseArea,
        warehouseAreaOverride: originalRfp.warehouseAreaOverride,
        warehouseNotes: originalRfp.warehouseNotes,
        areaBreakdown: originalRfp.areaBreakdown || [],
        projectAddress: originalRfp.projectAddress,
        projectSize: originalRfp.projectSize,
        estimatedValue: originalRfp.estimatedValue,
        timelineRequirements: originalRfp.timelineRequirements,
        specialRequirements: originalRfp.specialRequirements,
        contactPerson: originalRfp.contactPerson,
        contactEmail: originalRfp.contactEmail,
        dueDate: originalRfp.dueDate,
        projectDescription: originalRfp.projectDescription,
        documentsLink: originalRfp.documentsLink
      };

      // Create the counter offer RFP using storage method
      const counterOffer = await storage.createRfpRequest({
        ...counterOfferData,
        areaBreakdown: originalRfp.areaBreakdown || [],
        overrides: originalRfp.overrides || {},
        metadata: {}
      });

      res.status(201).json(counterOffer);
    } catch (error) {
      console.error('Create counter offer error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create counter offer" 
      });
    }
  });

  // Delete RFP request - with permission checking
  app.delete("/api/rfp-requests/:id", async (req, res) => {
    console.log(`=== DELETE START ===`);
    console.log(`Delete request for RFP ID: ${req.params.id}`);
    
    try {
      // First check authentication
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      if (!token) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      // Validate token and get user
      const userId = await tokenStore.getUserFromToken(token);
      if (!userId) {
        return res.status(401).json({ success: false, message: "Invalid or expired token" });
      }

      // Get user permissions
      let userPermissions = [];
      if (userId.startsWith('contact_')) {
        const contactId = parseInt(userId.replace('contact_', ''));
        const contact = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
        
        if (contact.length === 0) {
          return res.status(401).json({ success: false, message: "User not found" });
        }
        
        userPermissions = contact[0].permissions || [];
      } else {
        // Regular user from users table
        const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        
        if (user.length === 0) {
          return res.status(401).json({ success: false, message: "User not found" });
        }
        
        userPermissions = user[0].permissions || [];
      }

      // Check if user has rfp.delete permission
      if (!userPermissions.includes('rfp.delete')) {
        console.log(`PERMISSION DENIED: User ${userId} lacks rfp.delete permission`);
        return res.status(403).json({ success: false, message: "You don't have permission to delete RFPs" });
      }

      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        console.log(`Invalid ID: ${req.params.id}`);
        return res.status(400).json({ success: false, message: "Invalid ID" });
      }

      console.log(`User has permission - calling storage.deleteRfpRequest(${id})`);
      const deleted = await storage.deleteRfpRequest(id);
      
      if (deleted) {
        console.log(`SUCCESS: RFP ${id} deleted by user ${userId}`);
        console.log(`=== DELETE SUCCESS ===`);
        res.status(200).json({ success: true, message: "RFP deleted successfully" });
      } else {
        console.log(`FAILED: RFP ${id} not found or couldn't delete`);
        res.status(404).json({ success: false, message: "RFP not found" });
      }
    } catch (error) {
      console.error('DELETE ERROR:', error);
      console.log(`=== DELETE ERROR ===`);
      res.status(500).json({ success: false, message: "Delete failed", error: String(error) });
    }
  });

  // Upload files for publish workflow
  app.post("/api/rfp-requests/upload-files", upload.array("files"), async (req, res) => {
    try {
      const rfpId = parseInt(req.body.rfpId);
      const stage = req.body.stage || 'general';
      
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const uploadedFiles = (req.files as Express.Multer.File[] || []).map(file => ({
        id: nanoid(),
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: file.filename,
        stage: stage,
      }));

      let updatedRequest = await storage.getRfpRequest(rfpId);
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      for (const file of uploadedFiles) {
        updatedRequest = await storage.addFileToRfp(rfpId, file);
      }

      res.json({ 
        success: true, 
        message: `${uploadedFiles.length} file(s) uploaded successfully`,
        files: uploadedFiles 
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: "Failed to upload files", error: error.message });
    }
  });

  // Upload additional files to existing RFP
  app.post("/api/rfp-requests/:id/files", upload.array("files"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const uploadedFiles = (req.files as Express.Multer.File[] || []).map(file => ({
        id: nanoid(),
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: file.filename,
      }));

      let updatedRequest = await storage.getRfpRequest(id);
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      for (const file of uploadedFiles) {
        updatedRequest = await storage.addFileToRfp(id, file);
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to upload files" });
    }
  });

  // Download file
  app.get("/api/rfp-requests/:id/files/:fileId", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const fileId = req.params.fileId;

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const request = await storage.getRfpRequest(id);
      if (!request) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      const file = request.files.find(f => f.id === fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const filePath = path.join(uploadsDir, file.path || file.name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.download(filePath, file.name);
    } catch (error) {
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Delete file
  app.delete("/api/rfp-requests/:id/files/:fileId", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const fileId = req.params.fileId;

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const request = await storage.getRfpRequest(id);
      if (!request) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      const file = request.files.find(f => f.id === fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      // Remove file from filesystem
      const filePath = path.join(uploadsDir, file.path || file.name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Remove file from database
      const updatedRequest = await storage.removeFileFromRfp(id, fileId);
      
      res.json({ success: true, message: "File deleted successfully" });
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // Download all published files as zip
  app.post("/api/rfp-requests/:id/files/download-all", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { fileIds } = req.body;

      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const request = await storage.getRfpRequest(id);
      if (!request) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Filter files by provided fileIds (or get all files if no specific IDs provided)
      const filesToDownload = fileIds && fileIds.length > 0 
        ? request.files.filter(f => fileIds.includes(f.id))
        : request.files || [];

      if (filesToDownload.length === 0) {
        return res.status(404).json({ message: "No files found to download" });
      }

      // Use archiver module (already imported at top of file)
      
      // Create zip archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // compression level
      });

      // Set response headers
      const zipFilename = `${request.rfpNumber}_Published_Files.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      
      // Pipe archive to response
      archive.pipe(res);

      let hasFiles = false;

      // Add each file to the archive
      for (const file of filesToDownload) {
        const filePath = path.join(uploadsDir, file.path || file.name);
        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: file.name });
          hasFiles = true;
        }
      }

      if (!hasFiles) {
        return res.status(404).json({ message: "No files found on disk" });
      }

      // Finalize the archive
      archive.finalize();
    } catch (error) {
      console.error('Error creating zip download:', error);
      res.status(500).json({ message: "Failed to create download archive" });
    }
  });

  // Update RFP request with files
  app.patch("/api/rfp-requests/:id/update-with-files", upload.array("files"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Parse form data properly
      const formData = { ...req.body };
      
      // Parse requestTypes JSON array
      if (formData.requestTypes && typeof formData.requestTypes === 'string') {
        try {
          formData.requestTypes = JSON.parse(formData.requestTypes);
        } catch {
          formData.requestTypes = [];
        }
      }

      // Convert string boolean to actual boolean for confidential
      if (formData.confidential === 'true') {
        formData.confidential = true;
      } else if (formData.confidential === 'false') {
        formData.confidential = false;
      } else {
        formData.confidential = Boolean(formData.confidential);
      }

      // Convert isMultiBuilding boolean - handle arrays and strings
      if (Array.isArray(formData.isMultiBuilding)) {
        // If it's an array, take the first value or convert all to a single boolean
        formData.isMultiBuilding = formData.isMultiBuilding[0] === 'true' || formData.isMultiBuilding[0] === true;
      } else if (formData.isMultiBuilding === 'true') {
        formData.isMultiBuilding = true;
      } else if (formData.isMultiBuilding === 'false') {
        formData.isMultiBuilding = false;
      } else if (formData.isMultiBuilding !== undefined) {
        formData.isMultiBuilding = Boolean(formData.isMultiBuilding);
      }

      // Convert date strings to Date objects for database using centralized utility
      // Handle receivedOn date
      if (formData.receivedOn && typeof formData.receivedOn === 'string' && formData.receivedOn.trim() !== '') {
        try {
          formData.receivedOn = convertFormDateToDbDate(formData.receivedOn);
        } catch (error) {
          console.error('Error converting receivedOn date:', error);
          formData.receivedOn = null;
        }
      } else {
        formData.receivedOn = null;
      }
      
      // Handle internalDueDate date
      if (formData.internalDueDate && typeof formData.internalDueDate === 'string' && formData.internalDueDate.trim() !== '') {
        try {
          formData.internalDueDate = convertFormDateToDbDate(formData.internalDueDate);
        } catch (error) {
          console.error('Error converting internalDueDate date:', error);
          formData.internalDueDate = null;
        }
      } else {
        formData.internalDueDate = null;
      }
      
      // Handle responseToBrokerDue date
      if (formData.responseToBrokerDue && typeof formData.responseToBrokerDue === 'string' && formData.responseToBrokerDue.trim() !== '') {
        try {
          formData.responseToBrokerDue = convertFormDateToDbDate(formData.responseToBrokerDue);
        } catch (error) {
          console.error('Error converting responseToBrokerDue date:', error);
          formData.responseToBrokerDue = null;
        }
      } else {
        formData.responseToBrokerDue = null;
      }
      
      // Handle contractorDueDate date
      if (formData.contractorDueDate && typeof formData.contractorDueDate === 'string' && formData.contractorDueDate.trim() !== '') {
        try {
          formData.contractorDueDate = convertFormDateToDbDate(formData.contractorDueDate);
        } catch (error) {
          console.error('Error converting contractorDueDate date:', error);
          formData.contractorDueDate = null;
        }
      } else {
        formData.contractorDueDate = null;
      }
      
      // Handle architectDueDate date
      if (formData.architectDueDate && typeof formData.architectDueDate === 'string' && formData.architectDueDate.trim() !== '') {
        try {
          formData.architectDueDate = convertFormDateToDbDate(formData.architectDueDate);
        } catch (error) {
          console.error('Error converting architectDueDate date:', error);
          formData.architectDueDate = null;
        }
      } else {
        formData.architectDueDate = null;
      }

      // Handle selected bay configurations
      if (formData.selectedBayConfigurations && typeof formData.selectedBayConfigurations === 'string') {
        try {
          formData.selectedBayConfigurations = JSON.parse(formData.selectedBayConfigurations);
        } catch (e) {
          console.error('Failed to parse selectedBayConfigurations:', e);
          formData.selectedBayConfigurations = [];
        }
      }

      // Handle multi-building JSON fields - properties
      if (formData.properties && typeof formData.properties === 'string') {
        try {
          formData.properties = JSON.parse(formData.properties);
        } catch (e) {
          console.error('Failed to parse properties:', e);
          formData.properties = [];
        }
      }

      // Handle selectedBaysPerBuilding
      if (formData.selectedBaysPerBuilding && typeof formData.selectedBaysPerBuilding === 'string') {
        try {
          formData.selectedBaysPerBuilding = JSON.parse(formData.selectedBaysPerBuilding);
        } catch (e) {
          console.error('Failed to parse selectedBaysPerBuilding:', e);
          formData.selectedBaysPerBuilding = {};
        }
      }

      // Handle costsPerBuilding
      if (formData.costsPerBuilding && typeof formData.costsPerBuilding === 'string') {
        try {
          formData.costsPerBuilding = JSON.parse(formData.costsPerBuilding);
        } catch (e) {
          console.error('Failed to parse costsPerBuilding:', e);
          formData.costsPerBuilding = {};
        }
      }


      // Update the RFP request first
      try {
        const updatedRequest = await storage.updateRfpRequest(id, formData);
        if (!updatedRequest) {
          return res.status(404).json({ message: "RFP request not found" });
        }
      } catch (error) {
        console.error('Update RFP with files error:', error);
        return res.status(400).json({ message: `Update failed: ${error.message}` });
      }

      // Handle file uploads if any
      const files = req.files as Express.Multer.File[];
      if (files && files.length > 0) {
        for (const file of files) {
          const rfpFile = {
            id: nanoid(),
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
            uploadedAt: new Date().toISOString(),
            path: file.filename,
          };

          await storage.addFileToRfp(id, rfpFile);
        }
      }

      // Get the updated request with files
      const finalRequest = await storage.getRfpRequest(id);
      res.json(finalRequest);
    } catch (error) {
      console.error('Update RFP with files error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to update RFP request" 
      });
    }
  });

  // Contact routes
  app.get("/api/contacts", async (req, res) => {
    try {
      const contacts = await storage.getAllContacts();
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.get("/api/contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const contact = await storage.getContact(id);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contact" });
    }
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const parsed = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(parsed);
      res.status(201).json(contact);
    } catch (error) {
      res.status(400).json({ message: "Invalid contact data" });
    }
  });

  app.patch("/api/contacts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      console.log("Updating contact with data:", JSON.stringify(req.body, null, 2));
      const parsed = updateContactSchema.parse(req.body);
      console.log("Parsed contact data:", JSON.stringify(parsed, null, 2));
      const contact = await storage.updateContact(id, parsed);
      
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.json(contact);
    } catch (error) {
      console.error("Contact update error:", error);
      res.status(400).json({ message: "Invalid contact data", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/contacts/:id", requireAuth, checkPermission('contacts.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteContact(id);
      if (!deleted) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // Invitation routes
  app.get("/api/invitations", async (req, res) => {
    try {
      const invitations = await storage.getAllInvitations();
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.get("/api/rfp-requests/:id/invitations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const invitations = await storage.getInvitationsByRfp(id);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.post("/api/invitations", async (req, res) => {
    try {
      const parsed = insertInvitationSchema.parse(req.body);
      const invitation = await storage.createInvitation(parsed);
      res.status(201).json(invitation);
    } catch (error) {
      res.status(400).json({ message: "Invalid invitation data" });
    }
  });

  app.patch("/api/invitations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const parsed = updateInvitationSchema.parse(req.body);
      const invitation = await storage.updateInvitation(id, parsed);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      res.json(invitation);
    } catch (error) {
      res.status(400).json({ message: "Invalid invitation data" });
    }
  });

  app.delete("/api/invitations/:id", requireAuth, checkPermission('rfp.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteInvitation(id);
      if (!deleted) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete invitation" });
    }
  });

  // Workflow phase management routes
  app.patch("/api/rfp-requests/:id/workflow-phase", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const { phase } = req.body;
      if (!phase || !["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"].includes(phase)) {
        return res.status(400).json({ message: "Invalid workflow phase" });
      }

      const updated = await storage.advanceWorkflowPhase(id, phase);
      if (!updated) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Send Step 6 completion email when advancing to publish phase
      if (phase === 'publish') {
        try {
          await sendWorkflowCompletionEmail(updated, 'publish');
        } catch (emailError) {
          console.error('Failed to send publish completion email:', emailError);
        }
      }

      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update workflow phase" });
    }
  });

  app.get("/api/projects/phase/:phase", async (req, res) => {
    try {
      const { phase } = req.params;
      if (!["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "publish"].includes(phase)) {
        return res.status(400).json({ message: "Invalid workflow phase" });
      }

      const projects = await storage.getProjectsByPhase(phase);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects by phase" });
    }
  });

  // Advance workflow phase route
  app.post("/api/rfp-requests/:id/advance-workflow", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const { newPhase } = req.body;
      if (!newPhase || !["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "publish"].includes(newPhase)) {
        return res.status(400).json({ message: "Invalid workflow phase" });
      }

      const updated = await storage.advanceWorkflowPhase(id, newPhase);
      if (!updated) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Send Step 6 completion email when advancing to publish phase
      if (newPhase === 'publish') {
        try {
          await sendWorkflowCompletionEmail(updated, 'publish');
        } catch (emailError) {
          console.error('Failed to send publish completion email:', emailError);
        }
      }

      res.json(updated);
    } catch (error) {
      console.error('Error advancing workflow:', error);
      res.status(500).json({ message: "Failed to advance workflow phase" });
    }
  });

  // Invitation to Bid routes
  app.post("/api/invitation-to-bid", async (req, res) => {
    try {
      console.log('Invitation to bid request body:', JSON.stringify(req.body, null, 2));
      const parsed = insertInvitationToBidSchema.parse(req.body);
      const invitation = await storage.createInvitationToBid(parsed);
      res.status(201).json(invitation);
    } catch (error) {
      console.error('Invitation to bid validation error:', error);
      res.status(400).json({ 
        message: "Invalid invitation to bid data",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Save additional areas for invitation to bid (Step 3)
  app.post("/api/rfp-requests/:id/additional-areas", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const { description, squareFootage, notes } = req.body;
      
      if (!description || !description.trim()) {
        return res.status(400).json({ message: "Area description is required" });
      }

      // Get current RFP to access existing area breakdown
      const currentRfp = await storage.getRfpRequest(id);
      if (!currentRfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      // Create new area object
      const newArea = {
        id: `area-${Date.now()}`,
        description: description.trim(),
        squareFootage: squareFootage.toString(),
        notes: notes || ''
      };

      // Add to existing area breakdown or create new array
      const currentAreas = Array.isArray(currentRfp.areaBreakdown) ? currentRfp.areaBreakdown : [];
      const updatedAreas = [...currentAreas, newArea];

      // Update RFP with new area breakdown
      const updatedRfp = await storage.updateRfpRequest(id, {
        areaBreakdown: updatedAreas
      });
      
      console.log(`Successfully saved additional area for RFP ${id}:`, newArea);
      
      res.status(201).json({
        id: newArea.id,
        rfpId: id,
        description: newArea.description,
        squareFootage: parseInt(newArea.squareFootage) || 0,
        notes: newArea.notes,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Additional area save error:', error);
      res.status(500).json({ 
        message: "Failed to save additional area",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/rfp-requests/:id/invitation-to-bid", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const invitation = await storage.getInvitationToBid(id);
      if (!invitation) {
        return res.status(404).json({ message: "Invitation to bid not found" });
      }

      res.json(invitation);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invitation to bid" });
    }
  });

  app.patch("/api/rfp-requests/:id/invitation-to-bid", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const parsed = updateInvitationToBidSchema.parse(req.body);
      const invitation = await storage.updateInvitationToBid(id, parsed);
      
      if (!invitation) {
        return res.status(404).json({ message: "Invitation to bid not found" });
      }

      res.json(invitation);
    } catch (error) {
      console.error("Update invitation error:", error);
      res.status(400).json({ 
        message: "Failed to update invitation to bid",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.delete("/api/rfp-requests/:id/invitation-to-bid", requireAuth, checkPermission('rfp.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteInvitationToBid(id);
      if (!deleted) {
        return res.status(404).json({ message: "Invitation to bid not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete invitation to bid" });
    }
  });

  // RFP Validation routes
  app.post("/api/rfp-requests/validate", async (req, res) => {
    try {
      const { rfpId, ...validationData } = req.body;
      console.log("Validation request received for RFP:", rfpId);
      console.log("Validation data:", validationData);
      
      // Get the existing RFP
      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        console.log("RFP not found:", rfpId);
        return res.status(404).json({ message: "RFP request not found" });
      }
      
      // Combine RFP data with validation data
      const combinedData = { ...rfp, ...validationData };
      console.log("Combined data for validation:", JSON.stringify(combinedData, null, 2));
      
      const validationResult = validateRfpForProgression(combinedData);
      console.log("Validation result:", validationResult);
      
      res.json(validationResult);
    } catch (error) {
      console.error("Validation error details:", error);
      res.status(500).json({ 
        message: "Failed to validate RFP",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.patch("/api/rfp-requests/:id/workflow-phase", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { phase } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Validate if RFP can advance to the target phase
      if (!canAdvanceToPhase(rfp, phase)) {
        return res.status(400).json({ 
          message: "RFP validation failed. Complete all required fields before advancing." 
        });
      }

      const updatedRfp = await storage.advanceWorkflowPhase(id, phase);
      if (!updatedRfp) {
        return res.status(404).json({ message: "Failed to advance workflow phase" });
      }

      res.json(updatedRfp);
    } catch (error) {
      res.status(500).json({ message: "Failed to advance workflow phase" });
    }
  });

  // PDF Generation routes  
  app.get("/api/rfp-requests/:id/generate-pdf/:type", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { type } = req.params;
      const { preview } = req.query;
      
      console.log("PDF generation request:", { id, type, preview });
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      if (!type || !["architect", "contractor", "broker-architect", "broker-contractor"].includes(type)) {
        return res.status(400).json({ message: "Valid recipient type is required" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Get property data to include full address
      const property = await storage.getProperty(parseInt(rfp.property));
      const rfpWithAddress = {
        ...rfp,
        propertyAddress: property ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}` : rfp.property
      };

      // Get invitation to bid data if available
      const invitationToBid = await storage.getInvitationToBid(id);

      // Get user email for contact information
      const user = (req as any).user;
      const userEmail = user?.email || user?.username || 'AReutlinger@bridgeindustrial.com';

      const pdfOptions = {
        rfp: rfpWithAddress,
        invitationToBid,
        recipientType: type as "architect" | "contractor" | "broker-architect" | "broker-contractor",
        recipientName: "Preview User",
        recipientCompany: "Preview Company",
        userEmail  // Pass the authenticated user's email
      };

      // Generate HTML
      const htmlBuffer = await generateRfpPdf(pdfOptions);
      const htmlContent = htmlBuffer.toString('utf8');
      
      // For preview mode, don't save to history
      if (!preview) {
        try {
          const user = (req as any).user;
          const generatedBy = user?.email || user?.username || 'Unknown';
          
          const historyItem = {
            rfpId: id,
            generationType: type === "architect" || type === "broker-architect" ? "architect" : "contractor",
            generatedBy,
            invitationData: invitationToBid || null,
            generatedContent: htmlContent,
            title: `${type === "architect" || type === "broker-architect" ? "Architect" : "Contractor"} RFP - ${rfp.projectName} - ${new Date().toLocaleDateString()}`,
            notes: "Document Editor Preview"
          };
          
          await storage.createGenerationHistoryItem(historyItem);
        } catch (historyError) {
          console.error("Failed to save generation history:", historyError);
        }
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(htmlContent);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  app.post("/api/rfp-requests/:id/generate-pdf", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { recipientType, recipientName, recipientCompany, returnType = "html" } = req.body;
      
      console.log("PDF generation request:", { id, recipientType, returnType });
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      if (!recipientType || !["architect", "contractor", "broker-architect", "broker-contractor"].includes(recipientType)) {
        return res.status(400).json({ message: "Valid recipient type is required" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Get property data to include full address
      const property = await storage.getProperty(parseInt(rfp.property));
      const rfpWithAddress = {
        ...rfp,
        propertyAddress: property ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}` : rfp.property
      };

      // Get invitation to bid data if available
      const invitationToBid = await storage.getInvitationToBid(id);

      // Get user email for contact information
      const user = (req as any).user;
      const userEmail = user?.email || user?.username || 'AReutlinger@bridgeindustrial.com';

      const pdfOptions = {
        rfp: rfpWithAddress,
        invitationToBid,
        recipientType: recipientType as "architect" | "contractor" | "broker-architect" | "broker-contractor",
        recipientName,
        recipientCompany,
        userEmail  // Pass the authenticated user's email
      };

      // Always return HTML for now to avoid encoding issues
      const htmlBuffer = await generateRfpPdf(pdfOptions);
      const htmlContent = htmlBuffer.toString('utf8');
      
      console.log("Generated HTML length:", htmlContent.length);
      console.log("HTML starts with:", htmlContent.substring(0, 100));
      
      // Save to generation history
      try {
        const user = (req as any).user;
        const generatedBy = user?.email || user?.username || 'Unknown';
        
        const historyItem = {
          rfpId: id,
          generationType: recipientType === "architect" || recipientType === "broker-architect" ? "architect" : "contractor",
          generatedBy,
          invitationData: invitationToBid || null,
          generatedContent: htmlContent,
          title: `${recipientType === "architect" || recipientType === "broker-architect" ? "Architect" : "Contractor"} RFP - ${rfp.projectName} - ${new Date().toLocaleDateString()}`,
          notes: recipientName && recipientCompany ? `${recipientName} (${recipientCompany})` : recipientName || recipientCompany || null
        };
        
        console.log("Attempting to save generation history item:", {
          rfpId: historyItem.rfpId,
          generationType: historyItem.generationType,
          generatedBy: historyItem.generatedBy,
          title: historyItem.title
        });
        
        const saved = await storage.createGenerationHistoryItem(historyItem);
        console.log("Successfully saved generation history item with ID:", saved.id);
      } catch (historyError) {
        console.error("Failed to save generation history:", historyError);
        console.error("Error details:", historyError.message, historyError.stack);
        // Don't fail the request if history saving fails
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(htmlContent);
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  // Bid Collection routes
  app.get("/api/rfp-requests/:id/bid-collections", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const bidCollections = await storage.getBidCollectionsByRfp(id);
      
      // Fetch line items and alternates for each bid collection
      const enhancedBidCollections = await Promise.all(
        bidCollections.map(async (bidCollection) => {
          const [lineItems, alternates] = await Promise.all([
            storage.getBidLineItemsByBid(bidCollection.id),
            storage.getBidAlternatesByBid(bidCollection.id)
          ]);
          
          return {
            ...bidCollection,
            lineItems,
            alternates
          };
        })
      );
      
      res.json(enhancedBidCollections);
    } catch (error) {
      console.error("Error fetching bid collections:", error);
      res.status(500).json({ message: "Failed to fetch bid collections" });
    }
  });

  app.post("/api/rfp-requests/:id/bid-collections", upload.any(), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Handle both JSON and form-data formats
      let bidData, lineItems, alternates;
      
      if (req.body.bidData) {
        // Original JSON format
        bidData = JSON.parse(req.body.bidData);
        lineItems = JSON.parse(req.body.lineItems || '[]');
        alternates = JSON.parse(req.body.alternates || '[]');
      } else {
        // New form-data format
        bidData = {
          contractorId: parseInt(req.body.contractorId),
          contractorName: req.body.contractorName,
          contractorCompany: req.body.contractorCompany,
          contractorEmail: req.body.contractorEmail,
          submissionDate: req.body.submissionDate,
          totalAmount: req.body.totalAmount,
          costCategory: req.body.costCategory || 'construction',
          status: req.body.status || 'received',
          notes: req.body.notes || ''
        };
        lineItems = JSON.parse(req.body.lineItems || '[]');
        alternates = JSON.parse(req.body.alternates || '[]');
      }
      
      // Convert date string back to Date object
      if (bidData.submissionDate) {
        bidData.submissionDate = new Date(bidData.submissionDate);
      }
      
      // Handle file attachments - filter for attachment fields only
      const fileArray = req.files as Express.Multer.File[] || [];
      const attachments = fileArray
        .filter(file => file.fieldname.startsWith('attachment_'))
        .map(file => ({
          id: nanoid(),
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          uploadedAt: new Date().toISOString(),
          path: file.filename,
        }));

      const bidCollection = await storage.createBidCollection({
        ...bidData,
        rfpId: id,
        attachments
      });

      // Create line items if provided
      if (lineItems.length > 0) {
        for (const item of lineItems) {
          await storage.createBidLineItem({
            ...item,
            bidCollectionId: bidCollection.id
          });
        }
      }

      // Create alternates if provided
      if (alternates && alternates.length > 0) {
        for (const alternate of alternates) {
          await storage.createBidAlternate({
            ...alternate,
            bidCollectionId: bidCollection.id
          });
        }
      }

      res.status(201).json(bidCollection);
    } catch (error) {
      console.error("Bid collection creation error:", error);
      res.status(400).json({ message: "Failed to create bid collection" });
    }
  });

  app.patch("/api/rfp-requests/:rfpId/bid-collections/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const updates = req.body;
      console.log("Updating bid collection with data:", updates);
      
      // Convert submissionDate string to Date object if present
      if (updates.submissionDate && typeof updates.submissionDate === 'string') {
        updates.submissionDate = new Date(updates.submissionDate);
      }
      
      const bidCollection = await storage.updateBidCollection(id, updates);
      
      if (!bidCollection) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      res.json(bidCollection);
    } catch (error) {
      console.error("Error updating bid collection:", error);
      res.status(400).json({ message: "Failed to update bid collection", error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/rfp-requests/:rfpId/bid-collections/:id", upload.any(), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Extract bid data from individual form fields
      const bidData = {
        contractorId: parseInt(req.body.contractorId),
        contractorName: req.body.contractorName,
        contractorCompany: req.body.contractorCompany,
        contractorEmail: req.body.contractorEmail,
        submissionDate: req.body.submissionDate,
        totalAmount: req.body.totalAmount,
        costCategory: req.body.costCategory || 'construction',
        status: req.body.status,
        notes: req.body.notes || ''
      };
      
      const lineItems = JSON.parse(req.body.lineItems || '[]');
      const alternates = JSON.parse(req.body.alternates || '[]');
      
      // Convert date string back to Date object
      if (bidData.submissionDate) {
        bidData.submissionDate = new Date(bidData.submissionDate);
      }
      
      // Handle file attachments - filter for attachment fields only
      const fileArray = req.files as Express.Multer.File[] || [];
      const newAttachments = fileArray
        .filter(file => file.fieldname.startsWith('attachment_'))
        .map(file => ({
          id: nanoid(),
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          uploadedAt: new Date().toISOString(),
          path: file.filename,
        }));

      // Handle existing attachments - only keep the ones sent from frontend
      let existingAttachmentsToKeep: any[] = [];
      try {
        existingAttachmentsToKeep = JSON.parse(req.body.existingAttachments || '[]');
      } catch (e) {
        console.log('No existing attachments to keep');
      }
      
      // Combine kept existing attachments and new attachments
      const allAttachments = [...existingAttachmentsToKeep, ...newAttachments];

      const bidCollection = await storage.updateBidCollection(id, {
        ...bidData,
        attachments: allAttachments
      });

      if (!bidCollection) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      // Update line items - first delete existing ones, then create new ones
      await storage.deleteBidLineItemsByBidCollection(id);
      if (lineItems.length > 0) {
        for (const item of lineItems) {
          await storage.createBidLineItem({
            ...item,
            bidCollectionId: id
          });
        }
      }

      // Update alternates - first delete existing ones, then create new ones
      await storage.deleteBidAlternatesByBidCollection(id);
      if (alternates && alternates.length > 0) {
        for (const alternate of alternates) {
          await storage.createBidAlternate({
            ...alternate,
            bidCollectionId: id
          });
        }
      }

      res.json(bidCollection);
    } catch (error) {
      console.error("Bid collection update error:", error);
      res.status(400).json({ message: "Failed to update bid collection" });
    }
  });

  app.delete("/api/rfp-requests/:rfpId/bid-collections/:id", requireAuth, checkPermission('rfp.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteBidCollection(id);
      if (!deleted) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bid collection" });
    }
  });

  // Get line items for a bid collection
  app.get("/api/bid-collections/:id/line-items", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const lineItems = await storage.getBidLineItemsByBid(id);
      
      // Clean up any invalid values like "$NaN" before returning
      const cleanedLineItems = lineItems.map(item => ({
        ...item,
        unitPrice: cleanInvalidValue(item.unitPrice),
        totalPrice: cleanInvalidValue(item.totalPrice),
        quantity: cleanInvalidValue(item.quantity)
      }));
      
      console.log('🧹 Cleaned line items count:', cleanedLineItems.length);
      console.log('🧹 Raw first item from DB:', lineItems[0] ? {
        id: lineItems[0].id,
        description: lineItems[0].description,
        unitPrice: lineItems[0].unitPrice,
        totalPrice: lineItems[0].totalPrice
      } : 'No items');
      console.log('🧹 Cleaned first item:', cleanedLineItems[0] ? {
        id: cleanedLineItems[0].id,
        description: cleanedLineItems[0].description,
        unitPrice: cleanedLineItems[0].unitPrice,
        totalPrice: cleanedLineItems[0].totalPrice
      } : 'No items');
      
      // Set cache headers to prevent browser caching of this data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      res.json(cleanedLineItems);
    } catch (error) {
      console.error('Error fetching line items:', error);
      res.status(500).json({ message: "Failed to fetch line items" });
    }
  });

  // Legal compliance enforcement endpoint
  app.post("/api/properties/enforce-legal-compliance", requireAuth, async (req, res) => {
    try {
      console.log('🏛️ Manual legal compliance enforcement requested...');
      const result = await enforceAllPropertiesLegalCompliance();
      
      res.json({
        success: result.success,
        summary: result.summary,
        details: result.results
      });
    } catch (error) {
      console.error("Error enforcing legal compliance:", error);
      res.status(500).json({ message: "Failed to enforce legal compliance" });
    }
  });

  // Fix BIA lease total endpoint
  app.post("/api/properties/fix-bia-lease", requireAuth, async (req, res) => {
    try {
      console.log('🏗️ Fixing BIA lease total to 397,167 SF...');
      const result = await fixBIALeaseTotal();
      
      res.json(result);
    } catch (error) {
      console.error("Error fixing BIA lease total:", error);
      res.status(500).json({ message: "Failed to fix BIA lease total" });
    }
  });

  // Symmetrical legal compliance endpoint
  app.post("/api/properties/:id/symmetrical-compliance", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const { targetBays, targetTotal } = req.body;
      
      if (!targetBays || !targetTotal) {
        return res.status(400).json({ message: "targetBays and targetTotal are required" });
      }
      
      console.log(`🏗️ Applying symmetrical legal compliance to property ${propertyId}...`);
      const result = await applySymmetricalLegalCompliance(propertyId, targetBays, targetTotal);
      
      res.json(result);
    } catch (error) {
      console.error("Error applying symmetrical legal compliance:", error);
      res.status(500).json({ message: "Failed to apply symmetrical legal compliance" });
    }
  });

  // Property routes
  app.get("/api/properties", async (req, res) => {
    try {
      const properties = await storage.getAllProperties();
      // Add cache-busting headers to force fresh data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('ETag', `"${Date.now()}"`);
      
      
      // Debug log the total warehouse area for property 1
      const property1 = properties.find(p => p.id === 1);
      if (property1) {
        const totalWarehouseSF = property1.bayConfigurations?.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0) || 0;
        console.log(`🔍 DEBUG Properties API - Property 1 warehouse total: ${totalWarehouseSF} SF`);
        
        // Debug the bay configurations structure
        console.log('🔍 DEBUG - Bay configurations count:', property1.bayConfigurations?.length);
        
        // Show ALL bay values being sent to frontend
        console.log('🏗️ ALL BAYS BEING SENT TO FRONTEND:');
        property1.bayConfigurations?.forEach((bay: any) => {
          const displaySF = bay.rentableSquareFootage || bay.squareFootage || 0;
          console.log(`  ${bay.bayName || bay.bayNumber}: ${displaySF} SF`);
        });
        
        // Verify legal compliance rounding system is working correctly
        const bay45 = property1.bayConfigurations?.find((bay: any) => bay.bayName === 'Bay 4-5');
        const bay56 = property1.bayConfigurations?.find((bay: any) => bay.bayName === 'Bay 5-6');
        
        if (bay45) {
          const bay45Rentable = bay45.rentableSquareFootage || bay45.squareFootage || 0;
          console.log(`✅ Bay 4-5 Rentable SF: ${bay45Rentable} SF (includes mechanical room allocation)`);
        }
        if (bay56) {
          const bay56Rentable = bay56.rentableSquareFootage || bay56.squareFootage || 0;
          console.log(`✅ Bay 5-6 Rentable SF: ${bay56Rentable} SF (includes mechanical room allocation)`);
        }
        
        // Verify legal compliance total (exact requirement: 409,189 SF)
        const legalRequirementTotal = 409189;
        if (totalWarehouseSF === legalRequirementTotal) {
          console.log(`✅ LEGAL COMPLIANCE: Total matches exact requirement: ${totalWarehouseSF} SF`);
        } else {
          console.log(`🚨 LEGAL COMPLIANCE VIOLATION: Total is ${totalWarehouseSF} SF, Required ${legalRequirementTotal} SF (Difference: ${totalWarehouseSF - legalRequirementTotal} SF)`);
        }
        
        // Check for missing squareFootage values
        const missingBays = property1.bayConfigurations?.filter((bay: any) => !bay.squareFootage) || [];
        if (missingBays.length > 0) {
          console.log('🚨 DEBUG - Bays missing squareFootage:', missingBays.map((bay: any) => bay.bayName));
        }
      }
      
      // Debug Bridge Point Port Everglades (Property 2) 
      const property2 = properties.find(p => p.id === 2);
      if (property2) {
        const totalWarehouseSF2 = property2.bayConfigurations?.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0) || 0;
        console.log(`🔍 DEBUG Properties API - Property 2 warehouse total: ${totalWarehouseSF2} SF`);
        
        // Verify legal compliance total (exact requirement: 290,307 SF)
        const legalRequirementTotal2 = 290307;
        if (totalWarehouseSF2 === legalRequirementTotal2) {
          console.log(`✅ PORT EVERGLADES LEGAL COMPLIANCE: Total matches exact requirement: ${totalWarehouseSF2} SF`);
        } else {
          console.log(`🚨 PORT EVERGLADES LEGAL COMPLIANCE VIOLATION: Total is ${totalWarehouseSF2} SF, Required ${legalRequirementTotal2} SF (Difference: ${totalWarehouseSF2 - legalRequirementTotal2} SF)`);
        }
        
        // Verify the 5 adjusted bays have correct values after rounding
        const adjustedBays = [
          {name: 'Bay 3-4', expected: 15762}, 
          {name: 'Bay 16-17', expected: 15762},
          {name: 'Bay 11-12', expected: 15792}, 
          {name: 'Bay 12-13', expected: 15792}, 
          {name: 'Bay 15-16', expected: 15792}
        ];
        
        adjustedBays.forEach(({name, expected}) => {
          const bay = property2.bayConfigurations?.find((bay: any) => bay.bayName === name);
          if (bay) {
            const actual = bay.rentableSquareFootage || bay.squareFootage || 0;
            if (actual === expected) {
              console.log(`✅ ${name}: ${actual} SF (correctly adjusted)`);
            } else {
              console.log(`❌ ${name}: ${actual} SF (expected ${expected} SF after legal rounding)`);
            }
          }
        });
      }
      
      // Debug Bridge Point Port Everglades (Property 4)
      const property4 = properties.find(p => p.id === 4);
      if (property4) {
        const totalWarehouseSF4 = property4.bayConfigurations?.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0) || 0;
        console.log(`🔍 DEBUG Properties API - Property 4 warehouse total: ${totalWarehouseSF4} SF`);
        
        // Verify legal compliance total (exact requirement: 171,983 SF)
        const legalRequirementTotal4 = 171983;
        if (totalWarehouseSF4 === legalRequirementTotal4) {
          console.log(`✅ PORT EVERGLADES LEGAL COMPLIANCE: Total matches exact requirement: ${totalWarehouseSF4} SF`);
        } else {
          console.log(`🚨 PORT EVERGLADES LEGAL COMPLIANCE VIOLATION: Total is ${totalWarehouseSF4} SF, Required ${legalRequirementTotal4} SF (Difference: ${totalWarehouseSF4 - legalRequirementTotal4} SF)`);
        }
      }
      
      res.json(properties);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch properties" });
    }
  });

  app.get("/api/properties/next-id", async (req, res) => {
    try {
      const nextId = await storage.getNextPropertyId();
      res.json({ nextId });
    } catch (error) {
      res.status(500).json({ message: "Failed to get next property ID" });
    }
  });

  app.post("/api/properties", async (req, res) => {
    try {
      const result = insertPropertySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      const property = await storage.createProperty(result.data);
      res.status(201).json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to create property" });
    }
  });

  app.get("/api/properties/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const property = await storage.getProperty(id);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Add cache-busting headers to force fresh data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('ETag', `"${Date.now()}"`);


      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch property" });
    }
  });

  app.put("/api/properties/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const result = updatePropertySchema.safeParse({ ...req.body, id });
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      // Apply legal compliance middleware before saving
      const legallyCompliantData = await autoEnforceLegalComplianceMiddleware(id, result.data);

      const property = await storage.updateProperty(id, legallyCompliantData);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Failed to update property" });
    }
  });

  app.patch("/api/properties/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const result = updatePropertySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: "Invalid input", errors: result.error.issues });
      }

      // If changing ID, check if new ID already exists
      if (result.data.id && result.data.id !== id) {
        const existingProperty = await storage.getProperty(result.data.id);
        if (existingProperty) {
          return res.status(400).json({ message: "Property ID already exists" });
        }
      }

      // Apply legal compliance middleware before saving
      const legallyCompliantData = await autoEnforceLegalComplianceMiddleware(id, result.data);

      const property = await storage.updateProperty(id, legallyCompliantData);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.json(property);
    } catch (error) {
      console.error('Property update error:', error);
      if (error.code === '23505') { // PostgreSQL unique violation
        return res.status(400).json({ message: "Property ID already exists" });
      }
      res.status(500).json({ message: "Failed to update property" });
    }
  });

  app.delete("/api/properties/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteProperty(id);
      if (!deleted) {
        return res.status(404).json({ message: "Property not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete property" });
    }
  });

  // Property Existing Improvements routes
  app.get("/api/properties/:propertyId/existing-improvements", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const improvements = await storage.getPropertyExistingImprovements(propertyId);
      
      // DEBUG: Log bucket fields to verify data
      console.log('🔍 BACKEND DEBUG: Existing Improvements from DB:', improvements.map(imp => ({
        id: imp.id,
        description: imp.description,
        bucket: imp.bucket
      })));
      
      // CRITICAL: No-cache headers to ensure bucket field is always fresh (cost lifecycle tracking)
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      
      res.json(improvements);
    } catch (error) {
      console.error('Error fetching property existing improvements:', error);
      res.status(500).json({ message: "Failed to fetch existing improvements" });
    }
  });

  app.post("/api/properties/:propertyId/existing-improvements", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Handle costStage -> bucket mapping (form sends costStage, DB expects bucket)
      const bucket = req.body.bucket || req.body.costStage || 'FORECAST';
      
      // Convert totalCost from dollars to cents
      const totalCostCents = req.body.totalCost !== undefined 
        ? Math.round(req.body.totalCost * 100) 
        : 0;
      
      // Convert per-stage cost fields from dollars to cents
      // If per-stage fields are not provided, distribute totalCost to the appropriate stage based on bucket
      let forecastCost = req.body.forecastCost ? Math.round(req.body.forecastCost * 100) : 0;
      let committedCost = req.body.committedCost ? Math.round(req.body.committedCost * 100) : 0;
      let actualsCost = req.body.actualsCost ? Math.round(req.body.actualsCost * 100) : 0;
      
      // If no per-stage costs are provided but totalCost is, distribute to the appropriate stage
      if (forecastCost === 0 && committedCost === 0 && actualsCost === 0 && totalCostCents > 0) {
        if (bucket === 'FORECAST' || bucket === 'PIPELINE') {
          forecastCost = totalCostCents;
        } else if (bucket === 'COMMITTED') {
          committedCost = totalCostCents;
        } else if (bucket === 'ACTUALS') {
          actualsCost = totalCostCents;
        }
      }
      
      // Compute total as sum of all stages (or use the provided total for backward compatibility)
      const computedTotal = forecastCost + committedCost + actualsCost;
      const totalCost = computedTotal > 0 ? computedTotal : totalCostCents;
      
      const improvementData = {
        ...req.body,
        propertyId,
        bucket, // Ensure bucket is always set
        forecastCost,
        committedCost,
        actualsCost,
        totalCost, // Already computed correctly above
        originalCommitment: req.body.originalCommitment ? Math.round(req.body.originalCommitment * 100) : undefined,
        addedAmount: req.body.addedAmount ? Math.round(req.body.addedAmount * 100) : undefined,
      };
      
      // Clean up costStage if it was sent (not a DB field)
      delete improvementData.costStage;

      const improvement = await storage.createPropertyExistingImprovement(improvementData);
      res.status(201).json(improvement);
    } catch (error) {
      console.error('Error creating property existing improvement:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to create existing improvement" 
      });
    }
  });

  app.patch("/api/properties/:propertyId/existing-improvements/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      console.log('📝 PATCH existing-improvements - ID:', id, 'Body:', JSON.stringify(req.body));
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid improvement ID" });
      }

      const updates = { ...req.body };
      
      // Convert per-stage cost fields from dollars to cents if provided
      if (updates.forecastCost !== undefined) {
        console.log('📝 Converting forecastCost from dollars to cents:', updates.forecastCost, '→', Math.round(updates.forecastCost * 100));
        updates.forecastCost = Math.round(updates.forecastCost * 100);
      }
      if (updates.committedCost !== undefined) {
        updates.committedCost = Math.round(updates.committedCost * 100);
      }
      if (updates.actualsCost !== undefined) {
        updates.actualsCost = Math.round(updates.actualsCost * 100);
      }
      
      // If any stage cost is updated, get existing values and recompute total
      if (updates.forecastCost !== undefined || updates.committedCost !== undefined || updates.actualsCost !== undefined) {
        // Get current improvement to compute new total
        const currentImprovement = await storage.getPropertyExistingImprovement(id);
        if (currentImprovement) {
          const forecast = updates.forecastCost !== undefined ? updates.forecastCost : (currentImprovement.forecastCost || 0);
          const committed = updates.committedCost !== undefined ? updates.committedCost : (currentImprovement.committedCost || 0);
          const actuals = updates.actualsCost !== undefined ? updates.actualsCost : (currentImprovement.actualsCost || 0);
          updates.totalCost = forecast + committed + actuals;
        }
      } else if (updates.totalCost !== undefined) {
        // Legacy: If only totalCost provided (backward compatibility)
        updates.totalCost = Math.round(updates.totalCost * 100);
      }
      
      if (updates.originalCommitment !== undefined) {
        updates.originalCommitment = updates.originalCommitment ? Math.round(updates.originalCommitment * 100) : undefined;
      }
      if (updates.addedAmount !== undefined) {
        updates.addedAmount = updates.addedAmount ? Math.round(updates.addedAmount * 100) : undefined;
      }

      const improvement = await storage.updatePropertyExistingImprovement(id, updates);
      if (!improvement) {
        return res.status(404).json({ message: "Existing improvement not found" });
      }

      res.json(improvement);
    } catch (error) {
      console.error('Error updating property existing improvement:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to update existing improvement" 
      });
    }
  });

  app.delete("/api/properties/:propertyId/existing-improvements/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid improvement ID" });
      }

      const deleted = await storage.deletePropertyExistingImprovement(id);
      if (!deleted) {
        return res.status(404).json({ message: "Existing improvement not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting property existing improvement:', error);
      res.status(500).json({ message: "Failed to delete existing improvement" });
    }
  });

  // Property renumbering endpoint
  app.post("/api/properties/renumber", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const { mappings } = req.body;
      
      if (!mappings || !Array.isArray(mappings)) {
        return res.status(400).json({ message: "Invalid mappings format" });
      }

      // Validate mappings format
      for (const mapping of mappings) {
        if (!mapping.oldId || !mapping.newId) {
          return res.status(400).json({ message: "Each mapping must have oldId and newId" });
        }
      }

      // Begin transaction
      await db.transaction(async (tx) => {
        const updates = [];
        
        for (const { oldId, newId } of mappings) {
          // Check if old property exists
          const oldProperty = await storage.getProperty(oldId);
          if (!oldProperty) {
            throw new Error(`Property ${oldId} not found`);
          }
          
          // Check if new ID is available (unless it's the same as old ID)
          if (oldId !== newId) {
            const existingProperty = await storage.getProperty(newId);
            if (existingProperty) {
              throw new Error(`Property ID ${newId} already exists`);
            }
          }
          
          updates.push({ oldId, newId, property: oldProperty });
        }
        
        // Create a temporary mapping to avoid conflicts
        const tempMappings = new Map();
        
        // First pass: Update all properties to temporary IDs
        for (const { oldId, newId } of mappings) {
          if (oldId !== newId) {
            const tempId = 90000 + parseInt(oldId); // Use high temp IDs to avoid conflicts
            tempMappings.set(oldId, { tempId, finalId: newId });
            
            await tx.update(properties)
              .set({ id: tempId })
              .where(eq(properties.id, oldId));
          }
        }
        
        // Second pass: Update all RFP requests to use temp IDs
        for (const [oldId, { tempId }] of tempMappings) {
          await tx.update(rfpRequests)
            .set({ property: tempId.toString() })
            .where(eq(rfpRequests.property, oldId.toString()));
        }
        
        // Third pass: Update temp IDs to final IDs
        for (const [oldId, { tempId, finalId }] of tempMappings) {
          await tx.update(properties)
            .set({ id: finalId })
            .where(eq(properties.id, tempId));
            
          await tx.update(rfpRequests)
            .set({ property: finalId.toString() })
            .where(eq(rfpRequests.property, tempId.toString()));
        }
      });
      
      res.json({ success: true, message: "Properties renumbered successfully" });
    } catch (error) {
      console.error('Property renumbering error:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to renumber properties" 
      });
    }
  });

  // Evaluation Budget routes
  app.post("/api/rfp-requests/:rfpId/evaluation-budget", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const budgetData = req.body;
      
      // Clean up orphaned assembly items before saving
      if (budgetData.tenantImprovements) {
        budgetData.tenantImprovements = budgetData.tenantImprovements.map((item: any) => {
          // If item is marked as assembled but assembly no longer exists, clear assembly flags
          if (item.isAssembled && item.assemblyId && budgetData.assemblies) {
            const assemblyExists = Object.keys(budgetData.assemblies).includes(item.assemblyId.toString());
            if (!assemblyExists) {
              return {
                ...item,
                isAssembled: false,
                assemblyId: null
              };
            }
          }
          return item;
        });
      }
      
      // Also clean up existing assemblies data structure
      if (budgetData.assemblies && typeof budgetData.assemblies === 'object') {
        const cleanedAssemblies: Record<string, any> = {};
        Object.entries(budgetData.assemblies).forEach(([key, value]) => {
          if (value && typeof value === 'object' && 'components' in value) {
            cleanedAssemblies[key] = value;
          }
        });
        budgetData.assemblies = cleanedAssemblies;
      }
      
      // Check if evaluation budget already exists
      const existingBudget = await storage.getEvaluationBudget(rfpId);
      
      let savedBudget;
      if (existingBudget) {
        // Update existing budget
        savedBudget = await storage.updateEvaluationBudget(rfpId, budgetData);
      } else {
        // Create new budget
        savedBudget = await storage.createEvaluationBudget(budgetData);
      }
      
      res.status(201).json({ 
        message: "Evaluation budget saved successfully",
        rfpId,
        data: savedBudget
      });
    } catch (error) {
      console.error('Evaluation budget save error:', error);
      res.status(500).json({ message: "Failed to save evaluation budget" });
    }
  });

  // Get evaluation budget for an RFP
  app.get("/api/rfp-requests/:rfpId/evaluation-budget", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const budget = await storage.getEvaluationBudget(rfpId);
      if (!budget) {
        return res.status(404).json({ message: "Evaluation budget not found" });
      }

      res.json(budget);
    } catch (error) {
      console.error('Evaluation budget fetch error:', error);
      res.status(500).json({ message: "Failed to fetch evaluation budget" });
    }
  });

  // Get list of RFPs with evaluation budgets for import
  app.get("/api/evaluation-budgets/available-for-import", requireAuth, async (req, res) => {
    try {
      const rfps = await storage.getAllRfpRequests();
      
      // Get RFPs with evaluation budgets
      const rfpsWithBudgets = [];
      for (const rfp of rfps) {
        try {
          const budget = await storage.getEvaluationBudget(rfp.id);
          if (budget && (
            (budget.tenantImprovements && budget.tenantImprovements.length > 0) ||
            (budget.designSoftCosts && budget.designSoftCosts.length > 0) ||
            (budget.existingImprovements && budget.existingImprovements.length > 0)
          )) {
            const tiCount = budget.tenantImprovements?.length || 0;
            const dscCount = budget.designSoftCosts?.length || 0;
            const eiCount = budget.existingImprovements?.length || 0;
            
            rfpsWithBudgets.push({
              id: rfp.id,
              rfpNumber: rfp.rfpNumber,
              tenantName: rfp.tenantName,
              projectName: rfp.projectName,
              property: rfp.property,
              itemCount: tiCount + dscCount + eiCount,
              tenantImprovementsCount: tiCount,
              designSoftCostsCount: dscCount,
              existingImprovementsCount: eiCount,
              grandTotal: budget.grandTotal,
            });
          }
        } catch (error) {
          // Skip RFPs without budgets
          continue;
        }
      }

      res.json(rfpsWithBudgets);
    } catch (error) {
      console.error('Error fetching RFPs with budgets:', error);
      res.status(500).json({ message: "Failed to fetch RFPs with budgets" });
    }
  });

  // Get template for evaluation budget import
  app.get("/api/templates/:id/for-import", requireAuth, async (req, res) => {
    try {
      const template = await Templates.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      // Convert template items to evaluation line item format
      const evaluationItems = {
        tenantImprovements: [] as any[],
        designSoftCosts: [] as any[],
        existingImprovements: [] as any[],
      };

      template.items.forEach((item: any, index: number) => {
        // Normalize unit format: lowercase with period
        // IMPORTANT: Prioritize snapshot.unit (from ROM pilot) over template.unit for consistency
        let normalizedUnit = item.snapshot?.unit || item.unit || "ea.";
        normalizedUnit = normalizedUnit.toLowerCase();
        if (!normalizedUnit.endsWith('.')) {
          normalizedUnit = normalizedUnit + '.';
        }
        
        const lineItem = {
          id: `template-${template.id}-${index}`,
          description: item.label,
          quantity: item.qty || 1,
          unit: normalizedUnit,
          unitPrice: item.unit_cost ? item.unit_cost.toString() : "0",
          totalPrice: item.unit_cost && item.qty ? (item.unit_cost * item.qty).toString() : "0",
          tenantShare: item.percent || 100,
          notes: item.notes || "",
          // Add ROM snapshot for tiered pricing logic
          romSnapshot: item.snapshot ? {
            ...item.snapshot,
            itemGroup: item.snapshot.itemGroup,
            minSquareFootage: item.snapshot.minSquareFootage,
            maxSquareFootage: item.snapshot.maxSquareFootage,
          } : undefined,
        };

        // Categorize based on snapshot.category, tags, or type
        const category = item.snapshot?.category || "";
        const tags = item.tags || [];
        
        // Check snapshot category first (most reliable)
        if (category.toLowerCase().includes("design") || 
            category.toLowerCase().includes("soft cost") ||
            category.toLowerCase().includes("other fees")) {
          evaluationItems.designSoftCosts.push(lineItem);
        } else if (category.toLowerCase().includes("existing")) {
          evaluationItems.existingImprovements.push(lineItem);
        } 
        // Fall back to tag checking
        else if (tags.some((tag: string) => tag.includes("design") || tag.includes("soft-cost"))) {
          evaluationItems.designSoftCosts.push(lineItem);
        } else if (tags.some((tag: string) => tag.includes("existing"))) {
          evaluationItems.existingImprovements.push(lineItem);
        } 
        // Default to tenant improvements
        else {
          evaluationItems.tenantImprovements.push(lineItem);
        }
      });

      res.json(evaluationItems);
    } catch (error) {
      console.error('Template import fetch error:', error);
      res.status(500).json({ message: "Failed to fetch template for import" });
    }
  });

  // Clean up orphaned assembly items in evaluation budget
  app.post("/api/rfp-requests/:rfpId/evaluation-budget/cleanup-assemblies", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const budget = await storage.getEvaluationBudget(rfpId);
      if (!budget) {
        return res.status(404).json({ message: "Evaluation budget not found" });
      }

      let cleanupCount = 0;
      
      // Clean up tenant improvements
      if (budget.tenantImprovements) {
        const cleanedTI = budget.tenantImprovements.map((item: any) => {
          if (item.isAssembled && item.assemblyId) {
            const assemblyExists = budget.assemblies && Object.keys(budget.assemblies).includes(item.assemblyId.toString());
            if (!assemblyExists) {
              cleanupCount++;
              return {
                ...item,
                isAssembled: false,
                assemblyId: null
              };
            }
          }
          return item;
        });
        budget.tenantImprovements = cleanedTI;
      }

      // Clean up design/soft costs
      if (budget.designSoftCosts) {
        const cleanedDSC = budget.designSoftCosts.map((item: any) => {
          if (item.isAssembled && item.assemblyId) {
            const assemblyExists = budget.assemblies && Object.keys(budget.assemblies).includes(item.assemblyId.toString());
            if (!assemblyExists) {
              cleanupCount++;
              return {
                ...item,
                isAssembled: false,
                assemblyId: null
              };
            }
          }
          return item;
        });
        budget.designSoftCosts = cleanedDSC;
      }

      // Save the cleaned budget if any changes were made
      if (cleanupCount > 0) {
        await storage.updateEvaluationBudget(rfpId, budget);
      }

      res.json({ 
        message: `Cleaned up ${cleanupCount} orphaned assembly items`,
        cleanupCount
      });
    } catch (error) {
      console.error('Assembly cleanup error:', error);
      res.status(500).json({ message: "Failed to cleanup orphaned assembly items" });
    }
  });

  // Evaluation Budget Attachments routes
  app.post("/api/rfp-requests/:rfpId/evaluation-budget/attachments", requireAuth, upload.any(), async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const savedAttachments = [];
      for (const file of files) {
        const attachment = await storage.createEvaluationBudgetAttachment({
          rfpId,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        });
        savedAttachments.push(attachment);
      }

      res.status(201).json({ 
        message: "Files uploaded successfully",
        attachments: savedAttachments
      });
    } catch (error) {
      console.error('Evaluation budget attachment upload error:', error);
      res.status(500).json({ message: "Failed to upload files" });
    }
  });

  // Get evaluation budget attachments
  app.get("/api/rfp-requests/:rfpId/evaluation-budget/attachments", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const attachments = await storage.getEvaluationBudgetAttachments(rfpId);
      res.json(attachments);
    } catch (error) {
      console.error('Evaluation budget attachments fetch error:', error);
      res.status(500).json({ message: "Failed to fetch attachments" });
    }
  });

  // Get evaluation budget attachments (alternative route)
  app.get("/api/evaluation-budget-attachments/:rfpId", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const attachments = await storage.getEvaluationBudgetAttachments(rfpId);
      res.json(attachments);
    } catch (error) {
      console.error('Evaluation budget attachments fetch error:', error);
      res.status(500).json({ message: "Failed to fetch attachments" });
    }
  });

  // Upload evaluation budget attachments (alternative route)
  app.post("/api/evaluation-budget-attachments", requireAuth, upload.any(), async (req, res) => {
    try {
      const rfpId = parseInt(req.body.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const savedAttachments = [];
      for (const file of files) {
        const attachment = await storage.createEvaluationBudgetAttachment({
          rfpId,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        });
        savedAttachments.push(attachment);
      }

      res.status(201).json({ 
        message: "Files uploaded successfully",
        attachments: savedAttachments
      });
    } catch (error) {
      console.error('Evaluation budget attachment upload error:', error);
      res.status(500).json({ message: "Failed to upload files" });
    }
  });

  // Download evaluation budget attachment
  app.get("/api/evaluation-budget-attachments/:attachmentId/download", requireAuth, async (req, res) => {
    try {
      const attachmentId = parseInt(req.params.attachmentId);
      if (isNaN(attachmentId)) {
        return res.status(400).json({ message: "Invalid attachment ID" });
      }

      const attachment = await storage.getEvaluationBudgetAttachment(attachmentId);
      if (!attachment) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      const filePath = path.join(uploadsDir, attachment.filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.download(filePath, attachment.originalName);
    } catch (error) {
      console.error('Evaluation budget attachment download error:', error);
      res.status(500).json({ message: "Failed to download attachment" });
    }
  });

  // Delete evaluation budget attachment
  app.delete("/api/evaluation-budget-attachments/:attachmentId", requireAuth, async (req, res) => {
    try {
      const attachmentId = parseInt(req.params.attachmentId);
      if (isNaN(attachmentId)) {
        return res.status(400).json({ message: "Invalid attachment ID" });
      }

      const attachment = await storage.getEvaluationBudgetAttachment(attachmentId);
      if (!attachment) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      // Delete file from disk
      const filePath = path.join(uploadsDir, attachment.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const deleted = await storage.deleteEvaluationBudgetAttachment(attachmentId);
      if (!deleted) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      res.status(200).json({ message: "Attachment deleted successfully" });
    } catch (error) {
      console.error('Evaluation budget attachment delete error:', error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // Financial Summary PDF generation
  app.post("/api/rfp-requests/:rfpId/financial-summary-pdf", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      const bidCollections = await storage.getBidCollectionsByRfp(rfpId);
      
      // Collect all line items from bid collections
      const allLineItems = [];
      for (const bid of bidCollections) {
        const lineItems = await storage.getBidLineItemsByBid(bid.id);
        allLineItems.push(...lineItems.map(item => ({ ...item, bidCollection: bid })));
      }

      // Get evaluation budget data
      const evaluationBudget = await storage.getEvaluationBudget(rfpId);

      // Generate PDF using existing PDF generator
      const { generateRfpPdf } = await import("./pdf-generator");
      
      const pdfBuffer = await generateRfpPdf({
        rfp: {
          ...rfp,
          bidCollections,
          allLineItems,
          evaluationBudget
        },
        recipientType: "financial-summary",
        recipientName: "Financial Team",
        recipientCompany: "Internal"
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Financial_Summary_${rfp.rfpNumber}_${rfp.projectName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating financial summary PDF:", error);
      res.status(500).json({ message: "Failed to generate financial summary PDF" });
    }
  });

  // Executive Summary Report route
  app.get("/api/reports/executive", async (req, res) => {
    try {
      const filters = req.query.filters ? JSON.parse(req.query.filters as string) : {};
      console.log("Generating executive summary with filters:", filters);
      
      // Fetch all RFPs from storage
      let rfpData = await storage.getAllRfpRequests();
      console.log("Fetched", rfpData.length, "RFPs from storage");
      
      // For completed projects, fetch their evaluation budget data to get grand totals
      const rfpDataWithBudgets = await Promise.all(rfpData.map(async (rfp) => {
        if (rfp.status === 'completed') {
          try {
            const evaluationBudget = await storage.getEvaluationBudget(rfp.id);
            return {
              ...rfp,
              grandTotal: evaluationBudget?.grandTotal || null
            };
          } catch (error) {
            console.log(`Failed to fetch budget for RFP ${rfp.id}:`, error);
            return { ...rfp, grandTotal: null };
          }
        }
        return { ...rfp, grandTotal: null };
      }));
      
      rfpData = rfpDataWithBudgets;
      
      // Apply filters to RFP data
      if (filters.status && filters.status !== "all") {
        rfpData = rfpData.filter(rfp => rfp.status === filters.status);
      }
      if (filters.property && filters.property !== "all") {
        rfpData = rfpData.filter(rfp => rfp.property === filters.property);
      }
      if (filters.dueInDays && filters.dueInDays !== "all") {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + parseInt(filters.dueInDays));
        rfpData = rfpData.filter(rfp => {
          const dueDate = new Date(rfp.internalDueDate);
          return dueDate <= targetDate;
        });
      }
      

      
      // Generate simple HTML report
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Executive Summary Report</title>
          <style>
            @page { size: A4 landscape; margin: 0.5in; }
            @media print { .no-print { display: none !important; } }
            body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; }
            .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .header .subtitle { font-size: 14px; color: #666; margin: 5px 0; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
            th { background: #f9fafb; font-weight: 600; }
            th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(6), th:nth-child(7), th:nth-child(8), th:nth-child(9) { text-align: center; }
            td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7), td:nth-child(8), td:nth-child(9) { text-align: center; }
            th:nth-child(3) { width: 100px; }
            td:nth-child(3) { width: 100px; }
            th:nth-child(4) { width: 120px; }
            td:nth-child(4) { width: 120px; }
            th:nth-child(5) { width: 80px; }
            td:nth-child(5) { width: 80px; }
            th:nth-child(6) { width: 120px; }
            td:nth-child(6) { width: 120px; }
            th:nth-child(7) { width: 70px; }
            td:nth-child(7) { width: 70px; text-align: center; }
            th:nth-child(8) { width: 90px; }
            td:nth-child(8) { width: 90px; text-align: center; }
            th:nth-child(9) { width: 60px; }
            td:nth-child(9) { width: 60px; text-align: center; }
            .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; color: white; display: inline-block; }
            .status-received { background: #8B5CF6; }
            .status-inprogress { background: #F59E0B; }
            .status-completed { background: #10B981; }
            .status-onhold { background: #EF4444; }
            .status-in-progress { background: #F59E0B; }
            .status-on-hold { background: #EF4444; }
          </style>
        </head>
        <body>
          <div class="no-print">
            <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
            <br><small>This banner will not appear in the printed version.</small>
          </div>
          
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Executive Summary Report</div>
            <div class="subtitle">RFP Status Overview - Generated on ${new Date().toLocaleDateString()}</div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>RFP Number</th>
                <th>Project Name</th>
                <th>Rentable SF</th>
                <th>Due Date</th>
                <th>Day(s) Until Due</th>
                <th>Status</th>
                <th>Development Contact</th>
                <th>Grand Total</th>
                <th>$/RSF</th>
              </tr>
            </thead>
            <tbody>
              ${(rfpData || []).map((rfp: any) => {
                const dueDate = new Date(rfp.internalDueDate);
                const receivedDate = new Date(rfp.receivedOn);
                const daysUntil = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                
                let dayDisplay;
                let dueDateDisplay;
                
                // Check if RFP is completed based on status or workflow phase
                const isCompleted = rfp.status === 'completed' || rfp.workflowPhase === 'award';
                
                if (isCompleted) {
                  dayDisplay = '-';
                  dueDateDisplay = '-';
                } else {
                  dueDateDisplay = dueDate.toLocaleDateString();
                  if (daysUntil < 0) {
                    dayDisplay = Math.abs(daysUntil) + ' day(s) overdue';
                  } else {
                    dayDisplay = daysUntil + ' day(s)';
                  }
                }
                
                // Display workflow phase or status
                const workflowPhase = rfp.workflowPhase || 'rfp-entry';
                let phaseDisplay = '';
                let phaseClass = '';
                
                // Check if completed by status first, then by workflow phase
                if (rfp.status === 'completed') {
                  phaseDisplay = 'Completed';
                  phaseClass = 'status-completed';
                } else {
                  switch (workflowPhase) {
                    case 'rfp-entry':
                      phaseDisplay = 'RFP Entry';
                      phaseClass = 'status-received';
                      break;
                    case 'rfp-validation':
                      phaseDisplay = 'RFP Validation';
                      phaseClass = 'status-inprogress';
                      break;
                    case 'invitation-to-bid':
                      phaseDisplay = 'Invitation to Bid';
                      phaseClass = 'status-inprogress';
                      break;
                    case 'bid-collection':
                      phaseDisplay = 'Bid Collection';
                      phaseClass = 'status-inprogress';
                      break;
                    case 'evaluation':
                      phaseDisplay = 'Evaluation';
                      phaseClass = 'status-inprogress';
                      break;
                    case 'publish':
                      phaseDisplay = 'Publish';
                      phaseClass = 'status-inprogress';
                      break;
                    default:
                      phaseDisplay = 'RFP Entry';
                      phaseClass = 'status-received';
                  }
                }
                
                const statusDisplay = '<span class="status-badge ' + phaseClass + '">' + phaseDisplay + '</span>';
                
                // Extract rentable SF from project area or selected bay configurations
                let rentableSF = 'N/A';
                if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                  const totalArea = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
                  if (totalArea > 0) {
                    rentableSF = Math.round(totalArea).toLocaleString();
                  }
                } else if (rfp.projectArea) {
                  // Try to extract SF from project area text
                  const sfMatch = rfp.projectArea.match(/(\d{1,3}(?:,\d{3})*)\s*SF/i);
                  if (sfMatch) {
                    const sf = parseInt(sfMatch[1].replace(/,/g, ''));
                    rentableSF = Math.round(sf).toLocaleString();
                  }
                }
                
                // Format grand total for completed projects
                let grandTotalDisplay = '-';
                let rsfDisplay = '-';
                if (rfp.status === 'completed' && rfp.grandTotal) {
                  const total = parseFloat(rfp.grandTotal);
                  if (!isNaN(total)) {
                    grandTotalDisplay = '$' + total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                    
                    // Calculate $/RSF if rentable SF is available
                    let rentableSFNumber = 0;
                    if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                      rentableSFNumber = rfp.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
                    } else if (rfp.projectArea) {
                      const sfMatch = rfp.projectArea.match(/(\d{1,3}(?:,\d{3})*)\s*SF/i);
                      if (sfMatch) {
                        rentableSFNumber = parseInt(sfMatch[1].replace(/,/g, ''));
                      }
                    }
                    
                    if (rentableSFNumber > 0) {
                      const rsfValue = total / rentableSFNumber;
                      rsfDisplay = '$' + rsfValue.toFixed(2);
                    }
                  }
                }

                // Format development contact name
                let devContact = 'N/A';
                if (rfp.developmentContact) {
                  let contactName = rfp.developmentContact;
                  // Remove "Bridge Industrial" or similar company references
                  contactName = contactName.replace(/\s*-\s*Bridge\s*Industrial/i, '').trim();
                  
                  // Try to shorten to "First L." format if possible
                  const nameParts = contactName.split(' ');
                  if (nameParts.length >= 2) {
                    const firstName = nameParts[0];
                    const lastName = nameParts[nameParts.length - 1];
                    if (lastName.length > 0) {
                      devContact = firstName + ' ' + lastName.charAt(0) + '.';
                    } else {
                      devContact = contactName;
                    }
                  } else {
                    devContact = contactName;
                  }
                }

                return '<tr>' +
                  '<td><strong>' + (rfp.rfpNumber || 'N/A') + '</strong></td>' +
                  '<td>' + (rfp.projectName || 'N/A').replace(/ - $/, '') + '</td>' +
                  '<td>' + rentableSF + '</td>' +
                  '<td>' + dueDateDisplay + '</td>' +
                  '<td>' + dayDisplay + '</td>' +
                  '<td>' + statusDisplay + '</td>' +
                  '<td>' + devContact + '</td>' +
                  '<td style="font-weight: bold; text-align: center;">' + grandTotalDisplay + '</td>' +
                  '<td style="font-weight: bold; text-align: center;">' + rsfDisplay + '</td>' +
                  '</tr>';
              }).join('')}
            </tbody>
          </table>
          
          ${(rfpData || []).length === 0 ? '<p style="text-align: center; margin-top: 40px; color: #6b7280;">No RFPs found matching the current filters.</p>' : ''}
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'inline; filename="executive-summary-report.html"');
      res.send(html);
    } catch (error) {
      console.error("Error generating executive summary report:", error);
      res.status(500).json({ message: "Failed to generate executive summary report" });
    }
  });

  // Custom Report route
  app.get("/api/reports/custom", async (req, res) => {
    try {
      const config = req.query.config ? JSON.parse(req.query.config as string) : {};
      console.log("Generating custom report with config:", config);
      
      const { fields = [], title = "Custom Report", sortBy = "receivedOn", sortOrder = "desc", filters = {} } = config;
      
      if (fields.length === 0) {
        return res.status(400).json({ message: "No fields specified for custom report" });
      }
      
      // Fetch all RFPs from storage
      let rfpData = await storage.getAllRfpRequests();
      console.log("Fetched", rfpData.length, "RFPs from storage");
      
      // Apply filters to RFP data
      if (filters.status && filters.status !== "all") {
        rfpData = rfpData.filter(rfp => rfp.status === filters.status);
      }
      if (filters.property && filters.property !== "all") {
        rfpData = rfpData.filter(rfp => rfp.property === filters.property);
      }
      if (filters.dueInDays && filters.dueInDays !== "all") {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + parseInt(filters.dueInDays));
        rfpData = rfpData.filter(rfp => {
          const dueDate = new Date(rfp.internalDueDate);
          return dueDate <= targetDate;
        });
      }

      // Sort data
      rfpData.sort((a: any, b: any) => {
        let aValue = a[sortBy];
        let bValue = b[sortBy];
        
        // Handle date fields
        if (sortBy === 'receivedOn' || sortBy === 'internalDueDate') {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        }
        
        // Handle numeric fields
        if (typeof aValue === 'string' && !isNaN(Number(aValue))) {
          aValue = Number(aValue);
          bValue = Number(bValue);
        }
        
        if (sortOrder === 'desc') {
          return bValue > aValue ? 1 : -1;
        } else {
          return aValue > bValue ? 1 : -1;
        }
      });

      // Create table headers
      const fieldLabels: { [key: string]: string } = {
        rfpNumber: "RFP Number",
        property: "Property",
        tenantName: "Tenant Name",
        projectName: "Project Name",
        rentableSF: "Rentable SF",
        sentBy: "Sent By",
        receivedOn: "Date Received",
        internalDueDate: "Due Date",
        daysUntilDue: "Days Until Due",
        status: "Status",
        workflowPhase: "Workflow Phase",
        developmentContact: "Development Contact",
        requestTypes: "Request Types",
        confidential: "Confidential",
        notes: "Notes"
      };

      const headers = fields.map((field: string) => fieldLabels[field] || field);

      // Generate HTML report
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            @page { size: A4 landscape; margin: 0.5in; }
            @media print { .no-print { display: none !important; } }
            body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; }
            .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .header .subtitle { font-size: 14px; color: #666; margin: 5px 0; text-align: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
            th { background: #f9fafb; font-weight: 600; text-align: center; }
            td { text-align: center; }
            .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; color: white; display: inline-block; }
            .status-received { background: #8B5CF6; }
            .status-inprogress { background: #F59E0B; }
            .status-completed { background: #10B981; }
            .status-onhold { background: #EF4444; }
            .status-in-progress { background: #F59E0B; }
            .status-on-hold { background: #EF4444; }
          </style>
        </head>
        <body>
          <div class="no-print">
            <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
            <br><small>This banner will not appear in the printed version.</small>
          </div>
          
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">${title}</div>
            <div class="subtitle">Generated on ${new Date().toLocaleDateString()} • ${rfpData.length} records</div>
          </div>
          
          <table>
            <thead>
              <tr>
                ${headers.map(header => `<th>${header}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${(rfpData || []).map((rfp: any) => {
                const cells = fields.map((field: string) => {
                  let value = rfp[field];
                  
                  // Handle special field formatting
                  switch (field) {
                    case 'rentableSF':
                      if (rfp.selectedBayConfigurations && rfp.selectedBayConfigurations.length > 0) {
                        const totalArea = rfp.selectedBayConfigurations.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || bay.squareFootage || 0), 0);
                        value = totalArea > 0 ? Math.round(totalArea).toLocaleString() : 'N/A';
                      } else if (rfp.projectArea) {
                        const sfMatch = rfp.projectArea.match(/(\d{1,3}(?:,\d{3})*)\s*SF/i);
                        value = sfMatch ? Math.round(parseInt(sfMatch[1].replace(/,/g, ''))).toLocaleString() : 'N/A';
                      } else {
                        value = 'N/A';
                      }
                      break;
                    case 'receivedOn':
                    case 'internalDueDate':
                      value = value ? new Date(value).toLocaleDateString() : 'N/A';
                      break;
                    case 'daysUntilDue':
                      if (rfp.internalDueDate) {
                        const dueDate = new Date(rfp.internalDueDate);
                        const daysUntil = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                        if (rfp.status === 'completed' || rfp.workflowPhase === 'award') {
                          value = 'Completed';
                        } else if (daysUntil < 0) {
                          value = 'Overdue';
                        } else {
                          value = daysUntil.toString();
                        }
                      } else {
                        value = 'N/A';
                      }
                      break;
                    case 'status':
                      let statusDisplay = value || 'N/A';
                      let statusClass = 'status-received';
                      
                      // Use workflow phase for more detailed status if available
                      if (rfp.workflowPhase) {
                        switch (rfp.workflowPhase) {
                          case 'invitation-to-bid':
                            statusDisplay = 'Invitation to Bid';
                            statusClass = 'status-inprogress';
                            break;
                          case 'bid-collection':
                            statusDisplay = 'Bid Collection';
                            statusClass = 'status-inprogress';
                            break;
                          case 'evaluation':
                            statusDisplay = 'Evaluation';
                            statusClass = 'status-inprogress';
                            break;
                          case 'award':
                            statusDisplay = 'Award';
                            statusClass = 'status-completed';
                            break;
                          default:
                            statusDisplay = 'RFP Entry';
                            statusClass = 'status-received';
                        }
                      }
                      
                      value = '<span class="status-badge ' + statusClass + '">' + statusDisplay + '</span>';
                      break;
                    case 'workflowPhase':
                      const phaseLabels: { [key: string]: string } = {
                        'rfp-entry': 'RFP Entry',
                        'invitation-to-bid': 'Invitation to Bid',
                        'bid-collection': 'Bid Collection',
                        'evaluation': 'Evaluation',
                        'award': 'Award'
                      };
                      value = phaseLabels[value] || value || 'N/A';
                      break;
                    case 'requestTypes':
                      value = Array.isArray(value) ? value.join(', ') : (value || 'N/A');
                      break;
                    case 'confidential':
                      value = value ? 'Yes' : 'No';
                      break;
                    default:
                      value = value || 'N/A';
                  }
                  
                  return '<td>' + value + '</td>';
                });
                
                return '<tr>' + cells.join('') + '</tr>';
              }).join('')}
            </tbody>
          </table>
          
          ${(rfpData || []).length === 0 ? '<p style="text-align: center; margin-top: 40px; color: #6b7280;">No RFPs found matching the current filters.</p>' : ''}
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'inline; filename="custom-report.html"');
      res.send(html);
    } catch (error) {
      console.error("Error generating custom report:", error);
      res.status(500).json({ message: "Failed to generate custom report" });
    }
  });

  // ROM Pilot routes
  app.get("/api/rom-pilots", async (req, res) => {
    try {
      const pilots = await storage.getAllRomPilots();
      res.json(pilots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ROM pilots" });
    }
  });

  app.get("/api/rom-pilots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const pilot = await storage.getRomPilot(id);
      if (!pilot) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.json(pilot);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch ROM pilot" });
    }
  });

  app.post("/api/rom-pilots", async (req, res) => {
    try {
      // Generate ROM number
      const currentYear = new Date().getFullYear();
      const existingRoms = await storage.getAllRomPilots();
      const currentYearRoms = existingRoms.filter(rom => 
        rom.createdAt && new Date(rom.createdAt).getFullYear() === currentYear
      );
      const romCount = currentYearRoms.length + 1;
      const romNumber = `ROM-${currentYear}-${romCount.toString().padStart(3, '0')}`;
      
      const pilot = await storage.createRomPilot({
        ...req.body,
        romNumber
      });
      res.status(201).json(pilot);
    } catch (error) {
      res.status(400).json({ message: "Invalid ROM pilot data" });
    }
  });

  app.put("/api/rom-pilots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const pilot = await storage.updateRomPilot(id, req.body);
      if (!pilot) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.json(pilot);
    } catch (error) {
      res.status(400).json({ message: "Invalid ROM pilot data" });
    }
  });

  app.delete("/api/rom-pilots/:id", requireAuth, checkPermission('rom.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteRomPilot(id);
      if (!deleted) {
        return res.status(404).json({ message: "ROM pilot not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete ROM pilot" });
    }
  });

  // ROM Scope Items endpoints
  app.get("/api/rom-scope-items", async (req, res) => {
    try {
      const scopeItems = await storage.getAllRomScopeItems();
      res.json(scopeItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scope items" });
    }
  });

  app.post("/api/rom-scope-items", async (req, res) => {
    try {
      // Handle date conversion for lastUpdated field
      const createData = { ...req.body };
      if (createData.lastUpdated && createData.lastUpdated !== '') {
        createData.lastUpdated = new Date(createData.lastUpdated);
      } else if (createData.lastUpdated === '') {
        createData.lastUpdated = null;
      }

      const scopeItem = await storage.createRomScopeItem(createData);
      res.status(201).json(scopeItem);
    } catch (error) {
      console.error("ROM scope item creation error:", error);
      res.status(400).json({ message: "Invalid scope item data", error: error.message });
    }
  });

  app.put("/api/rom-scope-items/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      console.log("🔥 ROM UPDATE ATTEMPT - ID:", id);
      console.log("🔥 ROM UPDATE DATA:", JSON.stringify(req.body, null, 2));

      // Handle date conversion for lastUpdated field
      const updateData = { ...req.body };
      if (updateData.lastUpdated && updateData.lastUpdated !== '') {
        updateData.lastUpdated = new Date(updateData.lastUpdated);
      } else if (updateData.lastUpdated === '') {
        updateData.lastUpdated = null;
      }

      const scopeItem = await storage.updateRomScopeItem(id, updateData);
      if (!scopeItem) {
        return res.status(404).json({ message: "Scope item not found" });
      }

      console.log("Successfully updated ROM scope item:", scopeItem);
      res.json(scopeItem);
    } catch (error) {
      console.error("🚨 ROM SCOPE ITEM UPDATE ERROR:", error);
      console.error("🚨 ERROR STACK:", error.stack);
      res.status(500).json({ message: "Failed to update scope item", error: error.message });
    }
  });

  app.delete("/api/rom-scope-items/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const deleted = await storage.deleteRomScopeItem(id);
      if (!deleted) {
        return res.status(404).json({ message: "Scope item not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete scope item" });
    }
  });

  // ROM Scope Items file download endpoint
  app.get("/api/rom-scope-items/download/:fileName", async (req, res) => {
    try {
      const { fileName } = req.params;
      const { path: filePath } = req.query;
      
      console.log("ROM download request:", { fileName, filePath });
      
      if (!fileName || !filePath) {
        console.log("Missing fileName or filePath");
        return res.status(400).json({ message: "File name and path are required" });
      }

      // Construct the full path - files are stored in uploads directory
      const fullPath = path.join(process.cwd(), 'uploads', filePath as string);
      
      console.log("Looking for file at:", fullPath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        console.log("File not found at:", fullPath);
        return res.status(404).json({ message: "File not found" });
      }

      // Set appropriate headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${decodeURIComponent(fileName)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      
      // Stream the file
      const fileStream = fs.createReadStream(fullPath);
      fileStream.on('error', (error) => {
        console.error("File stream error:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error streaming file" });
        }
      });
      fileStream.pipe(res);
      
    } catch (error) {
      console.error("ROM scope items file download error:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // ROM Pilot Line Items endpoints
  app.get("/api/rom-pilots/:id/line-items", async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const lineItems = await storage.getRomPilotLineItems(romPilotId);
      res.json(lineItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch line items" });
    }
  });

  app.post("/api/rom-pilots/:id/line-items", async (req, res) => {
    try {
      console.log("ROM line items save request received");
      console.log("User from auth:", req.user?.username);
      console.log("Request headers:", req.headers.authorization);
      
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const { lineItems } = req.body;
      console.log("Saving ROM line items:", { romPilotId, lineItems });
      console.log("Line items details:", lineItems.map(item => ({
        scopeItemId: item.scopeItemId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        tenantShare: item.tenantShare,
        category: item.category
      })));
      
      const savedLineItems = await storage.saveRomPilotLineItems(romPilotId, lineItems);
      
      // Calculate and update total estimate
      const total = lineItems.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
      await storage.updateRomPilot(romPilotId, { totalEstimate: total.toString() });
      
      res.json(savedLineItems);
    } catch (error) {
      console.error("ROM line items save error:", error);
      res.status(500).json({ message: "Failed to save line items" });
    }
  });

  // Individual line item save endpoint
  app.post("/api/rom-pilots/:id/line-items/individual", async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const { lineItem } = req.body;
      console.log("Saving individual ROM line item:", { romPilotId, lineItem });
      
      // Get existing line items
      const existingLineItems = await storage.getRomPilotLineItems(romPilotId);
      
      // Update or add the specific line item
      let updatedLineItems;
      if (lineItem.id) {
        // Update existing item
        updatedLineItems = existingLineItems.map(item => 
          item.id === lineItem.id ? { ...item, ...lineItem } : item
        );
      } else {
        // Add new item
        updatedLineItems = [...existingLineItems, lineItem];
      }
      
      const savedLineItems = await storage.saveRomPilotLineItems(romPilotId, updatedLineItems);
      
      // Calculate and update total estimate
      const total = updatedLineItems.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
      await storage.updateRomPilot(romPilotId, { totalEstimate: total.toString() });
      
      res.json({ success: true, lineItem: savedLineItems.find(item => 
        item.scopeItemId === lineItem.scopeItemId && 
        item.category === lineItem.category
      )});
    } catch (error) {
      console.error("Individual ROM line item save error:", error);
      res.status(500).json({ message: "Failed to save line item" });
    }
  });

  app.delete("/api/rom-pilots/:id/line-items", requireAuth, checkPermission('rom.delete'), async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      await storage.saveRomPilotLineItems(romPilotId, []);
      await storage.updateRomPilot(romPilotId, { totalEstimate: "0" });
      
      res.status(200).json({ message: "Line items cleared successfully" });
    } catch (error) {
      console.error("ROM line items delete error:", error);
      res.status(500).json({ message: "Failed to clear line items" });
    }
  });

  // Helper function to generate ROM report HTML
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

  async function generateRomReportHtml(romPilot: any, lineItems: any[], scopeItems: any[], generatedBy: string = 'Unknown User'): Promise<string> {
    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Get property details if property ID is provided
    let propertyDetails = null;
    let bayCount = 0;
    let doorConfig = 'N/A';
    let vehicularParking = 'N/A';
    let trailerParking = 'N/A';
    let existingCosts = [];
    let propertyDisplayName = romPilot.property;
    
    if (romPilot.property && !isNaN(parseInt(romPilot.property))) {
      try {
        propertyDetails = await storage.getProperty(parseInt(romPilot.property));
        if (propertyDetails) {
          // Create property display name with building info
          const buildingInfo = propertyDetails.buildingName ? ` - ${propertyDetails.buildingName}` : '';
          propertyDisplayName = `${propertyDetails.propertyName}${buildingInfo}`;
          
          // Calculate door configuration from selected bays
          if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations)) {
            bayCount = romPilot.selectedBayConfigurations.length;
            const totalStandardDoors = romPilot.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.standardDockDoors || 0), 0);
            const totalOversizedDoors = romPilot.selectedBayConfigurations.reduce((sum, bay) => sum + (bay.oversizedDockDoors || 0), 0);
            doorConfig = `${totalStandardDoors + totalOversizedDoors} doors total (${totalOversizedDoors} oversized, ${totalStandardDoors} regular)`;
          }
          
          // Get parking info
          vehicularParking = propertyDetails.vehicularParking || 'N/A';
          trailerParking = propertyDetails.trailerParking || 'N/A';
          
          // Get existing improvements from property and calculate proportional costs
          try {
            const allExistingCosts = await storage.getPropertyExistingImprovements(parseInt(romPilot.property));
            
            // Calculate proportional costs based on ROM area vs total property area
            const propertyTotalSF = propertyDetails.totalSquareFootage || totalSquareFootage || 1;
            const romAreaPortion = totalSquareFootage / propertyTotalSF;
            
            existingCosts = allExistingCosts.map(cost => {
              const originalCost = parseFloat(cost.costEstimate) || 0;
              const proportionalCost = originalCost * romAreaPortion;
              return {
                ...cost,
                costEstimate: proportionalCost.toString(),
                originalCostEstimate: originalCost.toString() // Keep original for reference
              };
            });
          } catch (error) {
            console.error('Error fetching existing improvements:', error);
          }
        }
      } catch (error) {
        console.error('Error fetching property details:', error);
      }
    }
    
    // Calculate formulas and update line items with actual quantities
    const processedLineItems = lineItems.map(item => {
      let actualQuantity = parseFloat(item.quantity) || 0;
      
      // Handle formula-based quantities
      if (item.quantity && item.quantity.toString().startsWith('=')) {
        const formula = item.quantity.toString().substring(1);
        const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
        
        try {
          // Handle demising wall calculation specifically
          if (formula.includes('demising') || scopeItem?.name?.toLowerCase().includes('demising')) {
            actualQuantity = bayCount > 1 ? (bayCount - 1) * 40 : 0; // 40 LF per demising wall between bays
          } else {
            // Replace variables and evaluate
            const processedFormula = formula
              .replace(/totalSquareFootage/g, totalSquareFootage.toString())
              .replace(/bayCount/g, bayCount.toString());
            actualQuantity = eval(processedFormula);
          }
        } catch (error) {
          console.error('Formula evaluation error:', error);
          actualQuantity = 0;
        }
      }
      
      // Recalculate total price with actual quantity
      const unitPrice = parseFloat(item.unitPrice) || 0;
      const newTotalPrice = actualQuantity * unitPrice;
      
      return {
        ...item,
        actualQuantity,
        totalPrice: newTotalPrice.toString()
      };
    });
    
    // Categorize processed line items
    const tenantImprovements = processedLineItems.filter(item => item.category === 'tenant-improvements');
    const designSoftCosts = processedLineItems.filter(item => item.category === 'design-soft-costs');
    
    // Calculate totals
    const calculateCategoryTotal = (items: any[]) => {
      return items.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
    };
    
    const formatCurrency = (amount: number) => {
      // Use standard 2 decimal places for all currency amounts
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    };
    
    const formatPerSF = (total: number, sf: number) => {
      if (sf === 0) return '$0.00';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(total / sf);
    };
    
    const tenantImprovementsTotal = calculateCategoryTotal(tenantImprovements);
    const designSoftCostsTotal = calculateCategoryTotal(designSoftCosts);
    const grandTotal = tenantImprovementsTotal + designSoftCostsTotal;
    
    // Calculate total square footage from selected bay configurations FIRST
    let totalSquareFootage = 51094;
    console.log('ROM Pilot data:', JSON.stringify(romPilot, null, 2));
    console.log('Total square footage:', totalSquareFootage);
    
    if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations)) {
      const calculatedSF = romPilot.selectedBayConfigurations.reduce((sum: number, bay: any) => {
        return sum + (bay.rentableSquareFootage || bay.squareFootage || 0);
      }, 0);
      if (calculatedSF > 0) {
        totalSquareFootage = calculatedSF;
      }
      console.log('Calculated SF from bays:', calculatedSF);
    }
    
    const renderCategorySection = (title: string, items: any[], categoryTotal: number) => {
      if (items.length === 0) return '';
      
      const categoryPerSF = totalSquareFootage > 0 ? categoryTotal / totalSquareFootage : 0;
      
      return `
        <div style="margin-bottom: 30px;">
          <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center;">
            <span>${title}</span>
            <span style="color: #065f46; font-size: 16px;">${formatCurrency(categoryTotal)} <span style="font-size: 11px; color: #999;">(${formatPerSF(categoryTotal, totalSquareFootage)}/sf)</span></span>
          </h3>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600;">DESCRIPTION</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">QUANTITY</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">UNIT</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">UNIT PRICE</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">TOTAL PRICE</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">$/RSF</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => {
                const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
                const itemTotal = parseFloat(item.totalPrice) || 0;
                const perSF = totalSquareFootage > 0 ? itemTotal / totalSquareFootage : 0;
                
                return `
                  <tr>
                    <td style="border: 1px solid #e5e7eb; padding: 6px;">${scopeItem?.name || 'Custom Item'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${new Intl.NumberFormat('en-US').format(item.actualQuantity || parseFloat(item.quantity) || 0)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${scopeItem?.unit || 'ea'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(itemTotal)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatPerSF(itemTotal, totalSquareFootage)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    };
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>ROM Budget Report</title>
        <style>
          @page { size: A4; margin: 0.75in; }
          @media print { 
            .no-print { display: none !important; }
            body { font-size: 11px; }
            .document-title {
              background: rgb(59, 88, 152) !important;
              color: white !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            font-size: 12px; 
            margin: 0; 
            color: #1f2937;
            line-height: 1.4;
          }
          .no-print { 
            background: #3b82f6; 
            color: white; 
            padding: 15px; 
            text-align: center; 
            margin-bottom: 20px; 
            border-radius: 8px; 
            font-weight: 600;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 25px;
            padding-bottom: 15px;
          }
          .logo {
            max-width: 120px;
            height: auto;
          }
          .generated-info {
            text-align: right;
            font-size: 11px;
            color: #666;
          }
          .document-title {
            background: rgb(59, 88, 152);
            color: white;
            padding: 15px;
            text-align: center;
            font-size: 20px;
            font-weight: bold;
            margin: 20px 0;
            border-radius: 5px;
          }
          .project-info {
            text-align: center;
            margin-bottom: 20px;
            padding: 10px;
            border-bottom: 2px solid #e5e7eb;
          }
          .project-info h2 {
            margin: 5px 0;
            font-size: 16px;
            color: #333;
          }
          .project-info .rfp-number {
            font-size: 14px;
            color: #666;
            margin: 5px 0;
          }
          .property-summary {
            background: #f8f9fa;
            padding: 15px;
            margin-bottom: 25px;
            border-radius: 5px;
            border-left: 4px solid rgb(59, 88, 152);
          }
          .property-summary h3 {
            margin: 0 0 10px 0;
            font-size: 16px;
            font-weight: 600;
            color: #333;
          }
          .property-details {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }
          .property-left, .property-right {
            flex: 1;
          }
          .property-left {
            margin-right: 20px;
          }
          .grand-total {
            margin-top: 30px;
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: #065f46;
            border-top: 3px solid #e5e7eb;
            padding-top: 20px;
          }
          .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 72px;
            font-weight: bold;
            color: rgba(59, 88, 152, 0.1);
            z-index: 9999;
            pointer-events: none;
            white-space: nowrap;
            user-select: none;
          }
          @media print {
            .watermark {
              color: rgba(59, 88, 152, 0.15) !important;
              z-index: 9999 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="watermark">ROM PILOT</div>
        <div class="no-print">
          <p>ROM Budget Report - Use your browser's print function to save as PDF or print this report</p>
        </div>
        
        <div class="header">
          <img src="${getBridgeLogo()}" alt="Bridge Industrial" class="logo" />
          <div class="generated-info">
            Generated: ${currentDate}
          </div>
        </div>
        
        <div class="document-title">ROM Budget Report</div>
        
        <div class="project-info">
          <h2>Project: ${romPilot.projectName} @ ${propertyDisplayName}</h2>
          <div class="rfp-number">${romPilot.romNumber || 'ROM-2025-001'}</div>
        </div>
        
        <div class="property-summary">
          <h3>Property Summary</h3>
          <div class="property-details">
            <div class="property-left">
              <div><strong>Rentable Area:</strong> ${totalSquareFootage > 0 ? new Intl.NumberFormat('en-US').format(totalSquareFootage) + ' sf' : 'N/A'}</div>
              <div><strong>Bay Count:</strong> ${bayCount || (romPilot.selectedBayConfigurations ? romPilot.selectedBayConfigurations.length : 0)} bays</div>
              <div><strong>Door Configuration:</strong> ${doorConfig}</div>
            </div>
            <div class="property-right">
              <div><strong>Vehicular Parking:</strong> ${vehicularParking} spaces</div>
              <div><strong>Trailer Parking:</strong> ${trailerParking} spaces</div>
              <div><strong>Generated by:</strong> ${generatedBy}</div>
            </div>
          </div>
        </div>

        ${renderCategorySection("Tenant Improvements", tenantImprovements, tenantImprovementsTotal)}
        ${renderCategorySection("Design / Soft Costs / Other Fees", designSoftCosts, designSoftCostsTotal)}
        
        <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px; border-left: 4px solid #6b7280;">
          <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #666;">* Existing improvements tracked separately for financial modeling</h3>
        </div>
        
        ${existingCosts.length > 0 ? `
        <div style="margin-top: 20px;">
          <h3 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #333; display: flex; justify-content: space-between; align-items: center;">
            <span>Existing Costs</span>
            <span style="color: #065f46; font-size: 16px;">${formatCurrency(existingCosts.reduce((sum, cost) => sum + (parseFloat(cost.costEstimate) || 0), 0))} <span style="font-size: 11px; color: #999;">(${formatPerSF(existingCosts.reduce((sum, cost) => sum + (parseFloat(cost.costEstimate) || 0), 0), totalSquareFootage)}/sf)</span></span>
          </h3>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-weight: 600;">DESCRIPTION</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">TYPE</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">STATUS</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">COST ESTIMATE</th>
                <th style="border: 1px solid #e5e7eb; padding: 8px; text-align: center; font-weight: 600;">$/RSF</th>
              </tr>
            </thead>
            <tbody>
              ${existingCosts.map(cost => {
                const costAmount = parseFloat(cost.costEstimate) || 0;
                return `
                  <tr>
                    <td style="border: 1px solid #e5e7eb; padding: 6px;">${cost.description || 'N/A'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${cost.improvementType || 'N/A'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${cost.status || 'N/A'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatCurrency(costAmount)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 6px; text-align: center;">${formatPerSF(costAmount, totalSquareFootage)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ` : ''}

        <div class="grand-total" style="display: flex; align-items: baseline; justify-content: center; gap: 4px;">
          <span style="font-size: 24px; font-weight: bold; color: #065f46;">Grand Total: ${formatCurrency(grandTotal)}</span>
          <span style="font-size: 10px; font-style: italic; font-weight: normal; color: #999;">(${formatCurrency(totalSquareFootage > 0 ? grandTotal / totalSquareFootage : 0)} / sf)</span>
        </div>
      </body>
      </html>
    `;
  }

  // Reports PDF generation
  app.post("/api/reports/detailed-report-pdf", async (req, res) => {
    try {
      const { filters } = req.body;
      
      // Get all RFPs and apply filters
      let rfps = await storage.getAllRfpRequests();
      
      if (filters?.status) {
        rfps = rfps.filter(rfp => rfp.status === filters.status);
      }
      if (filters?.property) {
        rfps = rfps.filter(rfp => rfp.property === filters.property);
      }
      if (filters?.dueInDays) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + filters.dueInDays);
        rfps = rfps.filter(rfp => new Date(rfp.internalDueDate) <= targetDate);
      }

      const reportData = {
        rfps,
        filters,
        generatedAt: new Date().toISOString()
      };

      const pdfBuffer = await generateDetailedReportPdf(reportData);
      const filename = generateReportFilename("detailed-report");
      
      // Write to temporary file to avoid Express JSON serialization
      const tempPath = path.join(process.cwd(), 'temp-' + Date.now() + '.pdf');
      fs.writeFileSync(tempPath, pdfBuffer);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Stream the file and clean up
      const fileStream = fs.createReadStream(tempPath);
      fileStream.pipe(res);
      
      fileStream.on('end', () => {
        fs.unlinkSync(tempPath);
      });
    } catch (error) {
      console.error("Error generating executive summary PDF:", error);
      res.status(500).json({ message: "Failed to generate executive summary PDF" });
    }
  });

  // Historical Pricing Report route
  app.get("/api/reports/historical", async (req, res) => {
    try {
      const { generateHistoricalPricingPdf } = await import("./historical-pricing-reports");
      const pdfBuffer = await generateHistoricalPricingPdf();
      
      // Always return HTML for browser-based PDF generation in new window
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'inline; filename="historical-pricing-report.html"');
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating historical pricing report:", error);
      res.status(500).json({ message: "Failed to generate historical pricing report" });
    }
  });

  // Property Summary Report route
  app.get("/api/reports/property-summary", async (req, res) => {
    try {
      const { generatePropertySummaryReport } = await import("./property-summary-report");
      
      // Support RFP-specific mode with tenant allocation calculations
      const rfpId = req.query.rfpId as string;
      const propertyId = req.query.propertyId as string;
      const options = rfpId ? { rfpId: parseInt(rfpId), propertyId: propertyId ? parseInt(propertyId) : undefined } : undefined;
      
      const html = await generatePropertySummaryReport(options);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'inline; filename="property-summary-report.html"');
      res.send(html);
    } catch (error) {
      console.error("Error generating property summary report:", error);
      res.status(500).json({ message: "Failed to generate property summary report" });
    }
  });

  // ROM Report generation
  app.get("/api/rom-pilots/:id/report", requireAuth, async (req: any, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const romPilot = await storage.getRomPilot(romPilotId);
      if (!romPilot) {
        return res.status(404).json({ message: "ROM Pilot not found" });
      }

      const lineItems = await storage.getRomPilotLineItems(romPilotId);
      const scopeItems = await storage.getAllRomScopeItems();
      
      // Get user info for the report
      const user = req.user;
      const generatedBy = user?.firstName && user?.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user?.username || user?.email || 'Unknown User';
      
      // Generate HTML report
      const html = await generateRomReportHtml(romPilot, lineItems, scopeItems, generatedBy);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(html);
    } catch (error) {
      console.error("ROM report generation error:", error);
      res.status(500).json({ message: "Failed to generate ROM report" });
    }
  });

  // Auth route - returns current user with persistent admin role
  app.get('/api/auth/user', async (req, res) => {
    try {
      // Check if user exists in database, if not create with admin role
      let user = await storage.getUser('test-admin');
      
      if (!user) {
        user = await storage.upsertUser({
          id: 'test-admin',
          email: 'admin@rfptracker.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin' // Start as admin for development
        });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      // Fallback to simple admin user if database fails
      const fallbackUser = {
        id: 'test-admin',
        email: 'admin@rfptracker.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin'
      };
      res.json(fallbackUser);
    }
  });

  // Development route to make current user admin (now persists in database)
  app.post('/api/dev/make-admin', async (req, res) => {
    try {
      const user = await storage.updateUser('test-admin', { role: 'admin' });
      res.json({ message: "User promoted to admin", user });
    } catch (error) {
      console.error("Error promoting user:", error);
      // Fallback response
      const adminUser = {
        id: 'test-admin',
        email: 'admin@rfptracker.com',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin'
      };
      res.json({ message: "User promoted to admin", user: adminUser });
    }
  });

  // Admin routes for user management
  app.get('/api/admin/users', async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Get contacts with system access (for user management)
  app.get('/api/admin/authorized-contacts', async (req, res) => {
    try {
      console.log("Fetching authorized contacts...");
      const authorizedContacts = await storage.getAuthorizedContacts();
      console.log("Found authorized contacts:", authorizedContacts);
      res.json(authorizedContacts);
    } catch (error) {
      console.error("Error fetching authorized contacts:", error);
      res.status(500).json({ message: "Failed to fetch authorized contacts" });
    }
  });

  app.patch('/api/admin/users/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const user = await storage.updateUser(id, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete('/api/admin/users/:id', requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteUser(id);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Set password for contact (admin only)
  app.post('/api/admin/contacts/:id/set-password', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;



      if (!password || password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters long' });
      }

      const contactId = parseInt(id);
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));

      if (!contact || contact.type !== 'owner' || !contact.hasSystemAccess) {
        return res.status(404).json({ message: 'Contact not found or not authorized for system access' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      await db.update(contacts)
        .set({ passwordHash })
        .where(eq(contacts.id, contactId));


      res.status(200).json({ success: true, message: 'Password set successfully' });
    } catch (error) {
      console.error('Set password error:', error);
      res.status(500).json({ message: 'Failed to set password' });
    }
  });

  // Generate password for contact (admin only)  
  app.post('/api/admin/contacts/:id/generate-password', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const contactId = parseInt(id);
      
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));

      if (!contact || contact.type !== 'owner' || !contact.hasSystemAccess) {
        return res.status(404).json({ message: 'Contact not found or not authorized for system access' });
      }

      // Generate secure random password
      const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      await db.update(contacts)
        .set({ passwordHash })
        .where(eq(contacts.id, contactId));

      res.status(200).json({ 
        success: true, 
        message: 'Password generated successfully',
        tempPassword 
      });
    } catch (error) {
      console.error('Generate password error:', error);
      res.status(500).json({ message: 'Failed to generate password' });
    }
  });

  // Generate all bid collections PDF for an RFP
  app.get("/api/rfp-requests/:id/bid-collections/pdf", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);

      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      const bidCollections = await storage.getBidCollectionsByRfp(rfpId);
      if (!bidCollections || bidCollections.length === 0) {
        return res.status(404).json({ message: "No bid collections found" });
      }

      // Get line items and contact info for all bids
      const allBidsData = await Promise.all(
        bidCollections.map(async (bid) => {
          const lineItems = await storage.getBidLineItemsByBid(bid.id);
          const contact = await storage.getContact(bid.contractorId);
          return { bid, lineItems, contact };
        })
      );

      // Generate HTML for all bid collections
      const html = generateAllBidCollectionsHtml(rfp, allBidsData);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="all-bids-${rfp.rfpNumber}.html"`);
      res.send(html);
    } catch (error) {
      console.error("All bid collections PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate all bid collections PDF" });
    }
  });



  // Download bid collection attachment
  app.get("/api/bid-collections/:id/attachments/:fileId", requireAuth, async (req, res) => {
    try {
      const bidCollectionId = parseInt(req.params.id);
      const fileId = req.params.fileId;

      console.log(`🔍 DOWNLOAD DEBUG - Bid ${bidCollectionId}, File ${fileId}`);

      if (isNaN(bidCollectionId)) {
        return res.status(400).json({ message: "Invalid bid collection ID" });
      }

      const bidCollection = await storage.getBidCollection(bidCollectionId);
      if (!bidCollection) {
        console.log(`❌ DOWNLOAD DEBUG - Bid collection ${bidCollectionId} not found`);
        return res.status(404).json({ message: "Bid collection not found" });
      }

      console.log(`🔍 DOWNLOAD DEBUG - Bid collection found, attachments:`, bidCollection.attachments);

      const file = bidCollection.attachments?.find((f: any) => f.id === fileId);
      if (!file) {
        console.log(`❌ DOWNLOAD DEBUG - File ${fileId} not found in attachments`);
        return res.status(404).json({ message: "File not found" });
      }

      console.log(`🔍 DOWNLOAD DEBUG - File found:`, file);

      const filePath = path.join(uploadsDir, file.path || file.name);
      console.log(`🔍 DOWNLOAD DEBUG - Checking file path: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`❌ DOWNLOAD DEBUG - File not found on disk: ${filePath}`);
        return res.status(404).json({ message: "File not found on disk" });
      }

      console.log(`✅ DOWNLOAD DEBUG - File exists, starting download`);
      res.download(filePath, file.name);
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Get comprehensive file count for an RFP from all workflow stages
  app.get("/api/rfp-requests/:id/file-count", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);

      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      let totalFiles = 0;
      const filesByStage = {
        rfpEntry: 0,
        invitationToBid: 0,
        bidCollection: 0,
        evaluationBudget: 0,
        publishedFiles: 0
      };

      // 1. RFP Entry and Published files (distinguish by upload timing)
      if (rfp.files && rfp.files.length > 0) {
        const rfpCreated = new Date(rfp.createdAt || rfp.receivedDate || new Date());
        
        for (const file of rfp.files) {
          const fileUploadDate = new Date(file.uploadedAt);
          const daysSinceRfpCreated = (fileUploadDate.getTime() - rfpCreated.getTime()) / (1000 * 60 * 60 * 24);
          
          // If RFP is in publish phase or completed, and file was uploaded recently, treat as Published file
          const isInPublishPhase = rfp.workflowPhase === 'publish' || rfp.status === 'completed';
          const isRecentUpload = daysSinceRfpCreated > 1; // More than 1 day after RFP creation
          const isPublishedFile = isInPublishPhase && isRecentUpload;
          
          if (isPublishedFile) {
            filesByStage.publishedFiles++;
          } else {
            filesByStage.rfpEntry++;
          }
          totalFiles++;
        }
      }

      // 2. Bid Collection files
      const bidCollections = await storage.getBidCollectionsByRfp(rfpId);
      if (bidCollections && bidCollections.length > 0) {
        for (const bid of bidCollections) {
          if (bid.attachments && bid.attachments.length > 0) {
            filesByStage.bidCollection += bid.attachments.length;
            totalFiles += bid.attachments.length;
          }
        }
      }

      // 3. Evaluation Budget files
      try {
        const evaluationAttachments = await storage.getEvaluationBudgetAttachments(rfpId);
        if (evaluationAttachments && evaluationAttachments.length > 0) {
          filesByStage.evaluationBudget = evaluationAttachments.length;
          totalFiles += evaluationAttachments.length;
        }
      } catch (error) {
        console.log('No evaluation attachments found');
      }

      res.json({
        totalFiles,
        filesByStage
      });

    } catch (error) {
      console.error("File count error:", error);
      res.status(500).json({ message: "Failed to count files" });
    }
  });

  // Download only published files for current workflow step
  app.get("/api/rfp-requests/:id/download-published-files", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      console.log(`📦 Generating PUBLISHED FILES download for RFP ${rfp.rfpNumber}: ${rfp.projectName}`);

      const uploadsDir = path.join(process.cwd(), 'uploads');
      const archive = archiver('zip', { zlib: { level: 9 } });

      // Set response headers for download
      const projectName = rfp.projectName || `${rfp.tenantName}_RFP_${rfp.rfpNumber}`;
      const safeFileName = projectName
        .replace(/[@]/g, '_at_')
        .replace(/[^\w\s\-\.]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
      
      const timestamp = Date.now();
      const filename = `${safeFileName}_Published_Files_${timestamp}.zip`;
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      archive.pipe(res);

      let hasFiles = false;
      let missingFiles = [];

      // Only include Published Files (files uploaded during publish phase)
      if (rfp.files && rfp.files.length > 0) {
        const rfpCreated = new Date(rfp.createdAt || rfp.receivedDate || new Date());
        
        for (const file of rfp.files) {
          const fileUploadDate = new Date(file.uploadedAt);
          const daysSinceRfpCreated = (fileUploadDate.getTime() - rfpCreated.getTime()) / (1000 * 60 * 60 * 24);
          
          // Only include files that are Published files (uploaded during publish phase)
          const isInPublishPhase = rfp.workflowPhase === 'publish' || rfp.status === 'completed';
          const isRecentUpload = daysSinceRfpCreated > 1; // More than 1 day after RFP creation
          const isPublishedFile = isInPublishPhase && isRecentUpload;
          
          if (isPublishedFile) {
            const filePath = path.join(uploadsDir, file.path || file.name);
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: file.name });
              hasFiles = true;
              console.log(`📎 Adding published file: ${file.name}`);
            } else {
              console.log(`⚠️ Missing published file on disk: ${file.name} (path: ${file.path})`);
              missingFiles.push(file.name);
            }
          }
        }
      }

      if (!hasFiles) {
        archive.append('No published files found for this RFP.\n\nThis download only includes files uploaded during the Publish phase (Step 6).\n\nTo download all files from all workflow steps, use the "Download All Files" option.', { name: 'README.txt' });
      }

      if (missingFiles.length > 0) {
        archive.append(`Missing Files Report\n\nThe following files exist in the database but are missing from disk:\n\n${missingFiles.map(name => `- ${name}`).join('\n')}\n\nPlease contact support if you need these files.`, { name: 'MISSING_FILES.txt' });
      }

      await archive.finalize();
      console.log(`📦 Published files download complete: ${hasFiles ? 'files included' : 'no files'}`);

    } catch (error) {
      console.error("Published files download error:", error);
      res.status(500).json({ message: "Failed to download published files" });
    }
  });

  // Download all files for an RFP as organized zip
  app.get("/api/rfp-requests/:id/download-all-files", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);

      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      console.log(`📦 Generating download for RFP ${rfp.rfpNumber}: ${rfp.projectName}`);

      // Create zip archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // compression level
      });

      // Set response headers - use project name format
      // Use the project name directly since it's already complete
      const projectName = rfp.projectName || `${rfp.tenantName}_RFP_${rfp.rfpNumber}`;
      const zipFilename = `${projectName}_All_Files.zip`;
      
      // Create a simple, browser-friendly filename by replacing all problematic characters
      let fallbackFilename = projectName;
      console.log(`📁 Original project name: "${projectName}"`);
      
      // Step by step replacement with logging
      fallbackFilename = fallbackFilename.replace(/@/g, '_at_');
      console.log(`📁 After @ replacement: "${fallbackFilename}"`);
      
      fallbackFilename = fallbackFilename.replace(/\(/g, '_');
      fallbackFilename = fallbackFilename.replace(/\)/g, '_');
      fallbackFilename = fallbackFilename.replace(/\s+/g, '_');
      fallbackFilename = fallbackFilename.replace(/_+/g, '_');
      fallbackFilename = fallbackFilename.replace(/^_+|_+$/g, '');
      fallbackFilename = fallbackFilename + '_All_Files.zip';
      
      console.log(`📁 Final fallback filename: "${fallbackFilename}"`);
      
      console.log(`📁 ZIP filename will be: ${zipFilename}`);
      console.log(`📁 Fallback filename: ${fallbackFilename}`);
      
      // Add timestamp to ensure unique downloads
      const timestamp = Date.now();
      const timestampedFilename = fallbackFilename.replace('.zip', `_${timestamp}.zip`);
      
      // Set response headers with browser-friendly fallback and strong cache busting
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${timestampedFilename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Last-Modified', new Date().toUTCString());
      res.setHeader('ETag', `"${timestamp}"`);
      
      console.log(`📁 Using timestamped filename in header: ${timestampedFilename}`);
      
      // Pipe archive to response
      archive.pipe(res);

      let hasFiles = false;

      // 1. RFP Entry and Published files (all files from rfp.files array)
      // Note: This includes both original RFP entry files and published files
      let missingFiles = [];
      if (rfp.files && rfp.files.length > 0) {
        // Sort files by upload date to distinguish between early (RFP Entry) and recent (Published) files
        const sortedFiles = [...rfp.files].sort((a, b) => 
          new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
        );
        
        // Get the creation date of the RFP to help distinguish file categories
        const rfpCreated = new Date(rfp.createdAt || rfp.receivedDate || new Date());
        
        for (const file of sortedFiles) {
          const filePath = path.join(uploadsDir, file.path || file.name);
          if (fs.existsSync(filePath)) {
            const fileUploadDate = new Date(file.uploadedAt);
            const daysSinceRfpCreated = (fileUploadDate.getTime() - rfpCreated.getTime()) / (1000 * 60 * 60 * 24);
            
            // Simplified logic: If RFP is in publish phase, ALL files are Published files
            const isInPublishPhase = rfp.workflowPhase === 'publish' || rfp.status === 'completed';
            const folderName = isInPublishPhase ? '6-Published-Files' : '1-RFP-Entry';
            
            archive.file(filePath, { name: `${folderName}/${file.name}` });
            hasFiles = true;
          } else {
            console.log(`⚠️ Missing file on disk: ${file.name} (path: ${file.path})`);
            missingFiles.push(file.name);
          }
        }
      }

      // 2. Invitation to Bid files (if this field exists in your schema)
      const invitationToBid = await storage.getInvitationToBid(rfpId);
      // Note: Skip this section if contractorDocs field doesn't exist in the schema

      // 3. Bid Collection files (contractor submissions)
      const bidCollections = await storage.getBidCollectionsByRfp(rfpId);
      if (bidCollections && bidCollections.length > 0) {
        for (const bid of bidCollections) {
          if (bid.attachments && bid.attachments.length > 0) {
            for (const file of bid.attachments) {
              const filePath = path.join(uploadsDir, file.path || file.name);
              if (fs.existsSync(filePath)) {
                const contractorFolder = bid.contractorCompany.replace(/[^a-zA-Z0-9-]/g, '-');
                archive.file(filePath, { name: `3-Bid-Collection/${contractorFolder}/${file.name}` });
                hasFiles = true;
              }
            }
          }
        }
      }

      // 4. Evaluation Budget files
      try {
        const evaluationAttachments = await storage.getEvaluationBudgetAttachments(rfpId);
        console.log(`Found ${evaluationAttachments?.length || 0} evaluation attachments for RFP ${rfpId}`);
        if (evaluationAttachments && evaluationAttachments.length > 0) {
          for (const file of evaluationAttachments) {
            const filePath = path.join(uploadsDir, file.filename);
            console.log(`Checking evaluation file: ${filePath}`);
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: `4-Evaluation-Budget/${file.originalName}` });
              hasFiles = true;
              console.log(`Added evaluation file: ${file.originalName}`);
            } else {
              console.log(`Evaluation file not found on disk: ${filePath}`);
            }
          }
        }
      } catch (error) {
        console.error('Error collecting evaluation attachments:', error);
      }

      // 5. Invitation to Bid files (check if any contractor documents exist)
      try {
        const invitationToBid = await storage.getInvitationToBid(rfpId);
        if (invitationToBid && invitationToBid.contractorDocs && invitationToBid.contractorDocs.length > 0) {
          for (const file of invitationToBid.contractorDocs) {
            const filePath = path.join(uploadsDir, file.path || file.name);
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: `2-Invitation-to-Bid/${file.name}` });
              hasFiles = true;
            }
          }
        }
      } catch (error) {
        console.log('No invitation to bid files or method not available');
      }

      // If no files found, add a detailed readme
      if (!hasFiles) {
        let readmeContent = `RFP Download Report for ${rfp.projectName}\n`;
        readmeContent += `RFP Number: ${rfp.rfpNumber}\n`;
        readmeContent += `Generated: ${new Date().toLocaleString()}\n\n`;
        
        if (missingFiles.length > 0) {
          readmeContent += `ISSUE: The following files are registered in the database but missing from disk:\n`;
          missingFiles.forEach(fileName => {
            readmeContent += `- ${fileName}\n`;
          });
          readmeContent += `\nPlease contact your system administrator to restore these files.\n`;
        } else {
          readmeContent += `No files have been uploaded for this RFP yet.\n`;
        }
        
        readmeContent += `\nFile locations checked:\n`;
        readmeContent += `- RFP Entry files\n`;
        readmeContent += `- Bid Collection files\n`;
        readmeContent += `- Evaluation Budget files\n`;
        readmeContent += `- Published files\n`;
        
        archive.append(readmeContent, { name: 'README.txt' });
      }

      // Finalize the archive
      await archive.finalize();

    } catch (error) {
      console.error("Download all files error:", error);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      res.status(500).json({ message: "Failed to create zip file", error: error.message });
    }
  });

  // Print endpoints for property management modals
  app.get('/api/properties/:propertyId/bay-configurations/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Bay Configurations - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Bay Configurations Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Property Summary</h3>
            <p><strong>Total Bays:</strong> ${property.bayConfigurations?.length || 0}</p>
            <p><strong>Total Square Footage:</strong> ${(property.bayConfigurations || []).reduce((sum, bay) => sum + bay.squareFootage, 0).toLocaleString()} SF</p>
            <p><strong>Mechanical Room SF:</strong> ${property.mechanicalRoomSquareFootage?.toLocaleString() || 0} SF</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Bay Name</th>
                <th>Square Footage</th>
                <th>Standard Dock Doors</th>
                <th>Oversized Dock Doors</th>
                <th>Grade Level Doors</th>
                <th>Truck Courts</th>
                <th>Car Parking</th>
              </tr>
            </thead>
            <tbody>
              ${(property.bayConfigurations || []).map(bay => `
                <tr>
                  <td>${bay.bayName}</td>
                  <td>${bay.squareFootage.toLocaleString()}</td>
                  <td>${bay.standardDockDoors || 0}</td>
                  <td>${bay.oversizedDockDoors || 0}</td>
                  <td>${bay.gradeLevelDoors || 0}</td>
                  <td>${bay.truckCourts || 0}</td>
                  <td>${bay.carParking || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Bay configurations print error:", error);
      res.status(500).json({ message: "Failed to generate bay configurations report" });
    }
  });

  app.get('/api/properties/:propertyId/executed-leases/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const leases = await storage.getExecutedLeases(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Executed Leases - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Executed Leases Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Leasing Summary</h3>
            <p><strong>Total Leases:</strong> ${leases.length}</p>
            <p><strong>Total Leased SF:</strong> ${leases.reduce((sum, lease) => sum + (lease.rentableAreaOverride || 0), 0).toLocaleString()} SF</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Tenant Name</th>
                <th>Assigned Bays</th>
                <th>Rentable Area (SF)</th>
                <th>Standard Parking</th>
                <th>Accessible Parking</th>
                <th>EV Parking</th>
                <th>Trailer Parking</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${leases.map(lease => `
                <tr>
                  <td>${lease.tenantName}</td>
                  <td>${(lease.assignedBays || []).join(', ')}</td>
                  <td>${(lease.rentableAreaOverride || 0).toLocaleString()}</td>
                  <td>${lease.standardParking || 0}</td>
                  <td>${lease.accessibleParking || 0}</td>
                  <td>${lease.evParking || 0}</td>
                  <td>${lease.trailerParking || 0}</td>
                  <td>${lease.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Executed leases print error:", error);
      res.status(500).json({ message: "Failed to generate executed leases report" });
    }
  });

  app.get('/api/properties/:propertyId/building-specifications/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Building Specifications - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; line-height: 1.6; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            .section { margin-bottom: 30px; }
            .section-title { font-size: 18px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 15px; padding-bottom: 5px; border-bottom: 2px solid #e5e7eb; }
            .spec-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 15px; margin-bottom: 15px; }
            .spec-label { font-weight: 600; color: #374151; }
            .spec-value { color: #1f2937; }
            .empty-value { color: #9ca3af; font-style: italic; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Building Specifications</div>
            <div class="property-name">${property.propertyName}</div>
          </div>

          <div class="section">
            <div class="section-title">Structural Specifications</div>
            <div class="spec-grid">
              <div class="spec-label">Slab Thickness & PSI:</div>
              <div class="spec-value ${!property.slabThickness ? 'empty-value' : ''}">${property.slabThickness || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Clear Height:</div>
              <div class="spec-value ${!property.clearHeight ? 'empty-value' : ''}">${property.clearHeight || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Floor Flatness/Level (FF/FL):</div>
              <div class="spec-value ${!property.floorFlatness ? 'empty-value' : ''}">${property.floorFlatness || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Truck Apron Slab:</div>
              <div class="spec-value ${!property.truckApronSlab ? 'empty-value' : ''}">${property.truckApronSlab || 'Not specified'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Operational Specifications</div>
            <div class="spec-grid">
              <div class="spec-label">Ramp Capacity:</div>
              <div class="spec-value ${!property.rampCapacity ? 'empty-value' : ''}">${property.rampCapacity || 'No ramps / Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Roof R-Value:</div>
              <div class="spec-value ${!property.roofRValue ? 'empty-value' : ''}">${property.roofRValue || 'Not specified'}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Fire & Safety Systems</div>
            <div class="spec-grid">
              <div class="spec-label">Fire Pump Information:</div>
              <div class="spec-value ${!property.firePumpInfo ? 'empty-value' : ''}">${property.firePumpInfo || 'Not specified'}</div>
            </div>
            <div class="spec-grid">
              <div class="spec-label">Fire Sprinkler System:</div>
              <div class="spec-value ${!property.fireSprinklerInfo ? 'empty-value' : ''}">${property.fireSprinklerInfo || 'Not specified'}</div>
            </div>
          </div>

          <div class="footer">
            <p><strong>Property Address:</strong> ${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
            <p><em>This document is intended for lease documentation and RFP purposes.</em></p>
          </div>
        </body>
        </html>
      `;

      // Return HTML content like other PDF generation in this project
      // The browser will handle PDF conversion
      const cleanHtml = html.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
      const htmlBuffer = Buffer.from(cleanHtml, 'utf8');

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="Building_Specifications_${property.propertyName.replace(/[^a-zA-Z0-9]/g, '_')}.html"`);
      res.send(htmlBuffer);
    } catch (error) {
      console.error("Building specifications print error:", error);
      res.status(500).json({ message: "Failed to generate building specifications report" });
    }
  });

  app.get('/api/properties/:propertyId/existing-improvements/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const improvements = await storage.getPropertyExistingImprovements(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const totalValue = improvements.reduce((sum, imp) => sum + imp.totalCost, 0);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Existing Improvements - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .currency { text-align: right; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Existing Improvements Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Investment Summary</h3>
            <p><strong>Total Improvements:</strong> ${improvements.length}</p>
            <p><strong>Total Investment:</strong> $${(totalValue / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p><strong>Active Items:</strong> ${improvements.filter(i => i.isActive).length}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Description</th>
                <th>Total Cost</th>
                <th>Allocation Type</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${improvements.map(improvement => `
                <tr>
                  <td>${improvement.category}</td>
                  <td>${improvement.description}</td>
                  <td class="currency">$${(improvement.totalCost / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td>${improvement.allocationType}</td>
                  <td>${improvement.isActive ? 'Active' : 'Inactive'}</td>
                  <td>${improvement.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Existing improvements print error:", error);
      res.status(500).json({ message: "Failed to generate existing improvements report" });
    }
  });

  app.get('/api/properties/:propertyId/electrical/print', requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const property = await storage.getProperty(propertyId);
      const transformers = await storage.getTransformersByProperty(propertyId);
      
      // Get all main panels for all transformers at this property
      const allMainPanels = [];
      for (const transformer of transformers) {
        const panels = await storage.getMainPanelsByTransformer(transformer.id);
        allMainPanels.push(...panels);
      }
      
      // Get all electrical reservations for all transformers at this property
      const allReservations = [];
      for (const transformer of transformers) {
        const reservations = await storage.getElectricalReservations(transformer.id);
        allReservations.push(...reservations);
      }
      
      const bayAssignments = await storage.getBayPanelAssignments(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const totalCapacity = transformers.reduce((sum, t) => sum + (t.totalCapacityKva || 0), 0);
      const totalReserved = allReservations.reduce((sum, r) => sum + (r.reservedKva || 0), 0);
      const availableCapacity = totalCapacity - totalReserved;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Electrical Capacity Management - ${property.propertyName}</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
            .document-title { font-size: 24px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
            .property-name { font-size: 18px; color: #666; text-align: center; margin-bottom: 20px; }
            h1 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
            h2 { color: #555; margin-top: 30px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            .summary { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .capacity-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin: 20px 0; }
            .capacity-item { text-align: center; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
              <!-- Company logo -->
              <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
            </div>
            <div class="document-title">Electrical Capacity Management Report</div>
            <div class="property-name">${property.propertyName}</div>
          </div>
          
          <div class="summary">
            <h3>Capacity Overview</h3>
            <div class="capacity-grid">
              <div class="capacity-item">
                <h4>Total Capacity</h4>
                <p><strong>${totalCapacity} kVA</strong></p>
              </div>
              <div class="capacity-item">
                <h4>Available</h4>
                <p><strong>${availableCapacity} kVA</strong></p>
              </div>
              <div class="capacity-item">
                <h4>Reserved</h4>
                <p><strong>${totalReserved} kVA</strong></p>
              </div>
              <div class="capacity-item">
                <h4>Utilization</h4>
                <p><strong>${totalCapacity > 0 ? ((totalReserved / totalCapacity) * 100).toFixed(1) : 0}%</strong></p>
              </div>
            </div>
          </div>

          <h2>System Status</h2>
          <table>
            <tr><td>Transformers</td><td>${transformers.length}</td></tr>
            <tr><td>Main Panels</td><td>${allMainPanels.length}</td></tr>
            <tr><td>Bay Assignments</td><td>${bayAssignments.length}</td></tr>
            <tr><td>Active Reservations</td><td>${allReservations.length}</td></tr>
          </table>

          ${transformers.length > 0 ? `
          <h2>Transformers</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Capacity (kVA)</th>
                <th>FPL Designation No.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${transformers.map(transformer => `
                <tr>
                  <td>${transformer.transformerName}</td>
                  <td>${transformer.totalCapacityKva || 0}</td>
                  <td>${transformer.fplId || 'N/A'}</td>
                  <td>${transformer.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}

          ${allMainPanels.length > 0 ? `
          <h2>Main Panels</h2>
          <table>
            <thead>
              <tr>
                <th>Panel ID</th>
                <th>Transformer</th>
                <th>Capacity (A)</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              ${allMainPanels.map(panel => `
                <tr>
                  <td>${panel.panelName}</td>
                  <td>${panel.transformerId || 'N/A'}</td>
                  <td>${panel.maxCapacityKva || 0}</td>
                  <td>${panel.panelLocation || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}

          ${allReservations.length > 0 ? `
          <h2>Active Reservations</h2>
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Reserved Capacity (kVA)</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${allReservations.map(reservation => `
                <tr>
                  <td>${reservation.tenantName || 'N/A'}</td>
                  <td>${reservation.reservedKva || 0}</td>
                  <td>${reservation.notes || 'N/A'}</td>
                  <td>${reservation.isActive ? 'Active' : 'Inactive'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : ''}
          
          <p><em>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</em></p>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Electrical management print error:", error);
      res.status(500).json({ message: "Failed to generate electrical management report" });
    }
  });

  // RFP Generation History routes
  // Evaluation Budget History routes
  app.get('/api/rfp-requests/:rfpId/evaluation-budget-history', requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      const history = await storage.getEvaluationBudgetHistory(rfpId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching evaluation budget history:", error);
      res.status(500).json({ message: "Failed to fetch evaluation budget history" });
    }
  });

  app.post('/api/rfp-requests/:rfpId/evaluation-budget-history', requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      const { reportName, generatedContent, notes, budgetData } = req.body;
      const generatedBy = req.user?.username || 'Unknown';
      
      // Use sent budgetData if available, otherwise try to fetch from database
      let currentBudget = budgetData;
      if (!currentBudget) {
        currentBudget = await storage.getEvaluationBudget(rfpId);
      }
      
      // Get the most recent history item to compare against
      const previousHistory = await storage.getEvaluationBudgetHistory(rfpId);
      let previousBudget = null;
      if (previousHistory.length > 0) {
        try {
          const parsed = JSON.parse(previousHistory[0].generatedContent || '{}');
          previousBudget = parsed.budgetData || parsed;
        } catch (error) {
          // If it's HTML content, this indicates there was a previous budget report
          // but we can't extract the budget data for comparison
          console.log("Previous report contains HTML, indicating prior budget existed");
          
          // Set flag to indicate this is not truly the initial budget
          previousBudget = { isLegacyReport: true };
        }
      }
      
      // Generate change summary
      const changeSummary = storage.generateEvaluationChangeSummary(previousBudget, currentBudget);
      
      // Store both HTML content and budget data for change tracking
      const contentWithBudgetData = JSON.stringify({
        htmlContent: generatedContent,
        budgetData: currentBudget
      });

      const historyItem = await storage.createEvaluationBudgetHistory({
        rfpId,
        reportName,
        generatedBy,
        generatedContent: contentWithBudgetData,
        changeSummary,
        notes
      });
      
      res.json(historyItem);
    } catch (error) {
      console.error("Error creating evaluation budget history:", error);
      res.status(500).json({ message: "Failed to create evaluation budget history" });
    }
  });

  app.patch('/api/evaluation-budget-history/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { reportName, notes } = req.body;
      
      const updated = await storage.updateEvaluationBudgetHistory(id, { reportName, notes });
      if (!updated) {
        return res.status(404).json({ message: "Evaluation budget history item not found" });
      }
      
      res.json(updated);
    } catch (error) {
      console.error("Error updating evaluation budget history:", error);
      res.status(500).json({ message: "Failed to update evaluation budget history" });
    }
  });

  app.get('/api/evaluation-budget-history/:id/view', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.getEvaluationBudgetHistoryById(id);
      
      if (!item) {
        return res.status(404).json({ message: "Evaluation budget history item not found" });
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      
      // Extract HTML content if stored as JSON with budget data
      let htmlContent = item.generatedContent;
      try {
        const parsed = JSON.parse(item.generatedContent);
        htmlContent = parsed.htmlContent || item.generatedContent;
      } catch (error) {
        // If it's not JSON, use as-is (legacy HTML content)
        htmlContent = item.generatedContent;
      }
      
      res.send(htmlContent);
    } catch (error) {
      console.error("Error viewing evaluation budget history item:", error);
      res.status(500).json({ message: "Failed to view evaluation budget history item" });
    }
  });

  app.delete('/api/evaluation-budget-history/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteEvaluationBudgetHistory(id);
      
      if (!success) {
        return res.status(404).json({ message: "Evaluation budget history item not found" });
      }
      
      res.json({ message: "Evaluation budget history item deleted successfully" });
    } catch (error) {
      console.error("Error deleting evaluation budget history:", error);
      res.status(500).json({ message: "Failed to delete evaluation budget history item" });
    }
  });

  app.get('/api/rfp-requests/:rfpId/generation-history', requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      const history = await storage.getRfpGenerationHistory(rfpId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching generation history:", error);
      res.status(500).json({ message: "Failed to fetch generation history" });
    }
  });

  app.get('/api/generation-history/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.getGenerationHistoryItem(id);
      if (!item) {
        return res.status(404).json({ message: "Generation history item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Error fetching generation history item:", error);
      res.status(500).json({ message: "Failed to fetch generation history item" });
    }
  });

  app.get('/api/generation-history/:id/view', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const item = await storage.getGenerationHistoryItem(id);
      if (!item) {
        return res.status(404).json({ message: "Generation history item not found" });
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(item.generatedContent);
    } catch (error) {
      console.error("Error viewing generation history item:", error);
      res.status(500).json({ message: "Failed to view generation history item" });
    }
  });

  app.delete('/api/generation-history/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteGenerationHistoryItem(id);
      if (!success) {
        return res.status(404).json({ message: "Generation history item not found" });
      }
      res.json({ message: "Generation history item deleted successfully" });
    } catch (error) {
      console.error("Error deleting generation history item:", error);
      res.status(500).json({ message: "Failed to delete generation history item" });
    }
  });

  // Bridge Industrial logo endpoint for evaluation reports
  app.get('/api/bridge-logo', (req, res) => {
    try {
      const logoBase64 = readFileSync('./bridge_logo_new_base64.txt', 'utf8').trim();
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(logoBase64, 'base64'));
    } catch (error) {
      console.error('Error serving Bridge logo:', error);
      res.status(404).send('Logo not found');
    }
  });

  // Vendor Workload Report API endpoints
  app.get('/api/reports/vendor-workload', requireAuth, async (req, res) => {
    try {
      const { startDate, endDate, vendors } = req.query;
      
      const options: any = {};
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      if (vendors) options.vendors = (vendors as string).split(',').map(v => v.trim());
      
      const { generateVendorWorkloadData } = await import('./vendor-workload-report');
      const data = await generateVendorWorkloadData(options);
      
      res.json(data);
    } catch (error) {
      console.error("Error generating vendor workload data:", error);
      res.status(500).json({ message: "Failed to generate vendor workload data" });
    }
  });

  app.get('/api/reports/vendor-workload/html', async (req, res) => {
    try {
      const { startDate, endDate, vendors, incompleteOnly } = req.query;
      
      const options: any = {};
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      if (vendors) options.vendors = (vendors as string).split(',').map(v => v.trim());
      if (incompleteOnly) options.incompleteOnly = incompleteOnly === 'true';
      
      const { generateVendorWorkloadData, generateVendorWorkloadHtml } = await import('./vendor-workload-report');
      
      const data = await generateVendorWorkloadData(options);
      const html = await generateVendorWorkloadHtml(data);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("Error generating vendor workload HTML:", error);
      res.status(500).json({ message: "Failed to generate vendor workload HTML" });
    }
  });

  app.get('/api/reports/vendor-workload/pdf', requireAuth, async (req, res) => {
    try {
      const { startDate, endDate, vendors, incompleteOnly } = req.query;
      
      const options: any = {};
      if (startDate) options.startDate = new Date(startDate as string);
      if (endDate) options.endDate = new Date(endDate as string);
      if (vendors) options.vendors = (vendors as string).split(',').map(v => v.trim());
      if (incompleteOnly) options.incompleteOnly = incompleteOnly === 'true';
      
      const { generateVendorWorkloadData, generateVendorWorkloadPdf, generateVendorWorkloadFilename } = await import('./vendor-workload-report');
      
      const data = await generateVendorWorkloadData(options);
      const pdfBuffer = await generateVendorWorkloadPdf(data);
      const filename = generateVendorWorkloadFilename(options);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating vendor workload PDF:", error);
      res.status(500).json({ message: "Failed to generate vendor workload PDF" });
    }
  });

  // Executed Leases API routes
  app.get('/api/executed-leases/all', requireAuth, async (req, res) => {
    try {
      const leases = await storage.getAllExecutedLeases();
      res.json(leases);
    } catch (error) {
      console.error("Error fetching all executed leases:", error);
      res.status(500).json({ message: "Failed to fetch all executed leases" });
    }
  });

  app.get('/api/properties/:propertyId/executed-leases', requireAuth, async (req, res) => {
    try {
      const { propertyId } = req.params;
      const leases = await storage.getExecutedLeases(parseInt(propertyId));
      console.log(`DEBUG: Executed leases for property ${propertyId}:`, JSON.stringify(leases, null, 2));
      res.json(leases);
    } catch (error) {
      console.error("Error fetching executed leases:", error);
      res.status(500).json({ message: "Failed to fetch executed leases" });
    }
  });

  app.post('/api/properties/:propertyId/executed-leases', requireAuth, async (req, res) => {
    try {
      const { propertyId } = req.params;
      const leaseData = { 
        ...req.body, 
        propertyId: parseInt(propertyId),
        assignedBays: Array.isArray(req.body.assignedBays) ? req.body.assignedBays : [],
      };
      const lease = await storage.createExecutedLease(leaseData);
      res.json(lease);
    } catch (error) {
      console.error("Error creating executed lease:", error);
      res.status(500).json({ message: "Failed to create executed lease" });
    }
  });

  app.patch('/api/executed-leases/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = { 
        ...req.body,
        assignedBays: req.body.assignedBays ? (Array.isArray(req.body.assignedBays) ? req.body.assignedBays : []) : undefined,
      };
      const lease = await storage.updateExecutedLease(parseInt(id), updateData);
      res.json(lease);
    } catch (error) {
      console.error("Error updating executed lease:", error);
      res.status(500).json({ message: "Failed to update executed lease" });
    }
  });

  app.delete('/api/executed-leases/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteExecutedLease(parseInt(id));
      if (success) {
        res.json({ message: "Executed lease deleted successfully" });
      } else {
        res.status(404).json({ message: "Executed lease not found" });
      }
    } catch (error) {
      console.error("Error deleting executed lease:", error);
      res.status(500).json({ message: "Failed to delete executed lease" });
    }
  });

  // File Cleanup API Endpoints

  // Get cleanup statistics
  app.get('/api/admin/file-cleanup/stats', requireAuth, async (req, res) => {
    try {
      const { getCleanupStats } = await import('./file-cleanup');
      const stats = await getCleanupStats();
      res.json(stats);
    } catch (error) {
      console.error('Error getting cleanup stats:', error);
      res.status(500).json({ message: 'Failed to get cleanup statistics' });
    }
  });

  // Find orphaned files
  app.get('/api/admin/file-cleanup/orphaned', requireAuth, async (req, res) => {
    try {
      const { findOrphanedFiles } = await import('./file-cleanup');
      const orphanedFiles = await findOrphanedFiles();
      res.json({ orphanedFiles });
    } catch (error) {
      console.error('Error finding orphaned files:', error);
      res.status(500).json({ message: 'Failed to find orphaned files' });
    }
  });

  // Cleanup orphaned files
  app.post('/api/admin/file-cleanup/clean', requireAuth, async (req, res) => {
    try {
      const { cleanupOrphanedFiles } = await import('./file-cleanup');
      const result = await cleanupOrphanedFiles();
      res.json({
        message: 'File cleanup completed',
        ...result
      });
    } catch (error) {
      console.error('Error during file cleanup:', error);
      res.status(500).json({ message: 'Failed to cleanup files' });
    }
  });

  // Manual file cleanup for specific files
  app.post('/api/admin/file-cleanup/delete', requireAuth, async (req, res) => {
    try {
      const { filenames } = req.body;
      if (!Array.isArray(filenames)) {
        return res.status(400).json({ message: 'filenames must be an array' });
      }

      const { deleteFiles } = await import('./file-cleanup');
      const result = await deleteFiles(filenames);
      
      res.json({
        message: 'File deletion completed',
        ...result
      });
    } catch (error) {
      console.error('Error during manual file deletion:', error);
      res.status(500).json({ message: 'Failed to delete files' });
    }
  });

  // RFP Format Settings routes
  app.get('/api/rfp-format-settings', requireAuth, async (req: any, res) => {
    try {
      const settings = await storage.getRfpFormatSettings();
      res.json(settings || {
        tableColumns: {
          scopeOfWork: { description: 30, quantity: 12, unit: 8, notes: 50 },
          spaceRequirements: { spaceType: 30, area: 30, notes: 40 }
        },
        fonts: { headerSize: 24, bodySize: 12, tableHeaderSize: 11, tableBodySize: 12 },
        colors: { 
          headerBackground: '#f8f9fa', tableHeaderBackground: '#f8f9fa', 
          tableBorderColor: '#e5e7eb', primaryAccent: '#3b82f6' 
        },
        spacing: { sectionMargin: 20, tableMargin: 15, cellPadding: 8 },
        layout: { pageMargins: '1in', tableLayout: 'fixed', headerAlignment: 'left' }
      });
    } catch (error) {
      console.error("Error fetching RFP format settings:", error);
      res.status(500).json({ message: "Failed to fetch RFP format settings" });
    }
  });

  app.post('/api/rfp-format-settings', requireAuth, async (req: any, res) => {
    try {
      await storage.saveRfpFormatSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving RFP format settings:", error);
      res.status(500).json({ message: "Failed to save RFP format settings" });
    }
  });

  app.post('/api/rfp-preview', requireAuth, async (req: any, res) => {
    try {
      const { documentType, formatSettings } = req.body;
      
      // Generate sample preview HTML with the provided settings
      const previewHtml = generateRfpPreviewHtml(documentType, formatSettings);
      res.json({ html: previewHtml });
    } catch (error) {
      console.error("Error generating RFP preview:", error);
      res.status(500).json({ message: "Failed to generate preview" });
    }
  });

  // PDF Template management routes
  app.get('/api/pdf-templates', requireAuth, async (req, res) => {
    try {
      const templates = await storage.getPdfTemplates();
      res.json(templates);
    } catch (error) {
      console.error('Error fetching PDF templates:', error);
      res.status(500).json({ message: 'Failed to fetch PDF templates' });
    }
  });

  app.get('/api/pdf-templates/:id', requireAuth, async (req, res) => {
    try {
      const template = await storage.getPdfTemplate(parseInt(req.params.id));
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      console.error('Error fetching PDF template:', error);
      res.status(500).json({ message: 'Failed to fetch PDF template' });
    }
  });

  app.post('/api/pdf-templates', requireAuth, async (req, res) => {
    try {
      const validatedData = insertPdfTemplateSchema.parse(req.body);
      const template = await storage.createPdfTemplate(validatedData);
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating PDF template:', error);
      res.status(500).json({ message: 'Failed to create PDF template' });
    }
  });

  app.put('/api/pdf-templates/:id', requireAuth, async (req, res) => {
    try {
      const templateData = insertPdfTemplateSchema.partial().parse(req.body);
      const template = await storage.updatePdfTemplate(parseInt(req.params.id), templateData);
      res.json(template);
    } catch (error) {
      console.error('Error updating PDF template:', error);
      res.status(500).json({ message: 'Failed to update PDF template' });
    }
  });

  app.delete('/api/pdf-templates/:id', requireAuth, async (req, res) => {
    try {
      await storage.deletePdfTemplate(parseInt(req.params.id));
      res.json({ message: 'Template deleted successfully' });
    } catch (error) {
      console.error('Error deleting PDF template:', error);
      res.status(500).json({ message: 'Failed to delete PDF template' });
    }
  });

  // Property Attachments routes
  app.get("/api/properties/:id/attachments", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const attachments = await storage.getPropertyAttachments(propertyId);
      res.json(attachments);
    } catch (error) {
      console.error("Error fetching property attachments:", error);
      res.status(500).json({ message: "Failed to fetch property attachments" });
    }
  });

  app.post("/api/properties/:id/attachments", requireAuth, upload.any(), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files provided" });
      }

      const savedAttachments = [];
      for (const file of files) {
        const fileType = file.mimetype.includes('pdf') ? 'pdf' : 
                        file.mimetype.includes('dwg') || file.originalname.toLowerCase().endsWith('.dwg') ? 'dwg' : 'other';
        
        const attachment = await storage.createPropertyAttachment({
          propertyId,
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          fileType,
          description: req.body.description || null
        });
        savedAttachments.push(attachment);
      }

      res.json(savedAttachments);
    } catch (error) {
      console.error("Error uploading property attachments:", error);
      res.status(500).json({ message: "Failed to upload property attachments" });
    }
  });

  app.get("/api/properties/:id/attachments/:attachmentId/download", requireAuth, async (req, res) => {
    try {
      console.log(`🔽 Download request: Property ${req.params.id}, Attachment ${req.params.attachmentId}, User: ${req.user?.username}`);
      
      const propertyId = parseInt(req.params.id);
      const attachmentId = parseInt(req.params.attachmentId);
      
      if (isNaN(propertyId) || isNaN(attachmentId)) {
        console.log("❌ Invalid IDs provided");
        return res.status(400).json({ message: "Invalid property or attachment ID" });
      }

      const attachment = await storage.getPropertyAttachment(attachmentId);
      console.log(`📁 Attachment lookup result:`, attachment ? `Found: ${attachment.filename}` : 'Not found');
      
      if (!attachment || attachment.propertyId !== propertyId) {
        console.log(`❌ Attachment not found or property mismatch`);
        return res.status(404).json({ message: "Attachment not found" });
      }

      const filePath = path.join(uploadsDir, attachment.filename);
      console.log(`📂 Checking file path: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found on disk: ${filePath}`);
        return res.status(404).json({ message: "File not found on disk" });
      }

      console.log(`✅ Starting download: ${attachment.originalName}`);
      res.download(filePath, attachment.originalName, (err) => {
        if (err) {
          console.error("❌ Download error:", err);
        } else {
          console.log(`✅ Download completed: ${attachment.originalName}`);
        }
      });
    } catch (error) {
      console.error("❌ Error downloading property attachment:", error);
      res.status(500).json({ message: "Failed to download attachment" });
    }
  });

  app.delete("/api/properties/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const attachmentId = parseInt(req.params.attachmentId);
      
      if (isNaN(propertyId) || isNaN(attachmentId)) {
        return res.status(400).json({ message: "Invalid property or attachment ID" });
      }

      const attachment = await storage.getPropertyAttachment(attachmentId);
      if (!attachment || attachment.propertyId !== propertyId) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      // Delete file from disk
      const filePath = path.join(uploadsDir, attachment.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete from database
      const deleted = await storage.deletePropertyAttachment(attachmentId);
      if (!deleted) {
        return res.status(404).json({ message: "Failed to delete attachment" });
      }

      res.json({ message: "Attachment deleted successfully" });
    } catch (error) {
      console.error("Error deleting property attachment:", error);
      res.status(500).json({ message: "Failed to delete attachment" });
    }
  });

  // Utility function to normalize bay configurations for consistent display
  function normalizeBayConfigurations(bayConfigs: any[]): any[] {
    if (!bayConfigs) return [];
    
    return bayConfigs.map(bay => ({
      ...bay,
      // Ensure we use rentableSquareFootage (with mechanical room) for display
      displaySquareFootage: bay.rentableSquareFootage || bay.squareFootage || 0,
      bayDisplayName: bay.bayNumber || bay.bayName || 'Unknown Bay'
    }));
  }

  // Property print HTML generator
  function generatePropertyPrintHtml(property: any, executedLeases: any[], propertyImprovements: any[]): string {
    // Normalize bay configurations to ensure consistent data
    const normalizedBays = normalizeBayConfigurations(property.bayConfigurations || []);
    
    // Calculate total rentable area from normalized bay configurations
    const totalRentableArea = normalizedBays.reduce((sum: number, bay: any) => sum + bay.displaySquareFootage, 0);
    const totalBays = property.bayConfigurations?.length || 0;
    
    // Calculate remaining space after executed leases
    const leasedArea = executedLeases.reduce((sum, lease) => {
      // Use override if available, otherwise calculate from bay configurations
      if (lease.rentableAreaOverride) {
        return sum + lease.rentableAreaOverride;
      }
      const assignedBayConfigs = normalizedBays.filter(
        (bay: any) => lease.assignedBays?.includes(bay.id)
      );
      const leaseArea = assignedBayConfigs.reduce(
        (total: number, bay: any) => total + bay.displaySquareFootage,
        0
      );
      return sum + leaseArea;
    }, 0);
    const remainingArea = totalRentableArea - leasedArea;
    
    // Calculate parking totals
    const totalVehicularParking = (property.standardParking || 0) + (property.accessibleParking || 0) + (property.evParking || 0);
    const totalTrailerParking = property.trailerParking || 0;
    
    const leasedVehicularParking = executedLeases.reduce((sum, lease) => sum + ((lease.standardParking || 0) + (lease.accessibleParking || 0) + (lease.evParking || 0)), 0);
    const leasedTrailerParking = executedLeases.reduce((sum, lease) => sum + (lease.trailerParking || 0), 0);
    
    const remainingVehicularParking = totalVehicularParking - leasedVehicularParking;
    const remainingTrailerParking = totalTrailerParking - leasedTrailerParking;

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Property Report - ${property.propertyName}</title>
  <style>
    @media print {
      .no-print { display: none !important; }
      @page { margin: 0.5in; }
      body { font-size: 11px; }
    }
    body { font-family: 'Segoe UI', sans-serif; font-size: 12px; margin: 0; padding: 20px; line-height: 1.4; }
    .no-print { background: #3b82f6; color: white; padding: 15px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
    .header { border-bottom: 3px solid rgb(0,50,130); padding-bottom: 20px; margin-bottom: 30px; position: relative; }
    .document-title { font-size: 28px; font-weight: bold; color: rgb(0,50,130); margin-bottom: 10px; background: rgb(0,50,130); color: white; padding: 10px; border-radius: 5px; text-align: center; }
    .header .subtitle { font-size: 16px; color: #666; margin: 5px 0; text-align: center; }
    .section { margin-bottom: 30px; }
    .section h2 { font-size: 18px; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 15px; }
    .section h3 { font-size: 14px; color: #374151; margin: 15px 0 10px 0; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .info-item { background: #f9fafb; padding: 15px; border-radius: 8px; }
    .info-item strong { color: #1f2937; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    .bay-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 15px; }
    .bay-item { background: #f0f9ff; border: 1px solid #bae6fd; padding: 8px; border-radius: 4px; text-align: center; font-size: 11px; }
    .compass { text-align: center; margin: 15px 0; }
    .compass-directions { display: flex; justify-content: space-between; margin: 10px 0; font-size: 11px; color: #6b7280; }
    .existing-improvements { background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="no-print">
    <strong>📄 Save as PDF:</strong> Press Ctrl+P (Windows/Linux) or Cmd+P (Mac), then select "Save as PDF" as your destination.
    <br><small>This banner will not appear in the printed version.</small>
  </div>
  
  <div class="header">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <!-- Company logo -->
      <img src="${getBridgeLogo()}" alt="Bridge Industrial" style="height: 30px; width: auto;" />
    </div>
    <div class="document-title">${property.propertyName}</div>
    <div class="subtitle">Property Report - Generated on ${new Date().toLocaleDateString()}</div>
  </div>

  <div class="section">
    <h2>Property Overview</h2>
    <div class="info-grid">
      <div class="info-item">
        <strong>Total Rentable Area:</strong> ${totalRentableArea ? totalRentableArea.toLocaleString() + ' SF' : 'N/A'}<br>
        <strong>Bay Count:</strong> ${totalBays}<br>
        <strong>Single Building:</strong> ${property.isSingleBuilding ? 'Yes' : 'No'}
      </div>
      <div class="info-item">
        <strong>Vehicular Parking:</strong> ${totalVehicularParking} spaces<br>
        <strong>Trailer Parking:</strong> ${totalTrailerParking} spaces<br>
        <strong>Parking Ratio:</strong> ${totalRentableArea ? (totalVehicularParking / (totalRentableArea / 1000)).toFixed(2) : '0.00'} per 1,000 SF<br>
        <strong>Trailer Ratio:</strong> ${totalRentableArea ? (totalTrailerParking / (totalRentableArea / 1000)).toFixed(2) : '0.00'} per 1,000 SF
      </div>
    </div>
  </div>

  ${property.bayConfigurations?.length > 0 ? `
  <div class="section">
    <h2>Bay Configuration</h2>
    <div class="compass">
      <div class="compass-directions">
        <span>West Side (Street/Entrance)</span>
        <span>East Side (Loading Docks)</span>
      </div>
    </div>
    <!-- Simplified bay configuration display -->
    <div style="margin-top: 15px;">
      ${normalizedBays.map((bay: any, index: number) => `
        <div style="display: inline-block; margin: 5px 15px 5px 0; padding: 4px 8px; background: #f0f9ff; border-radius: 4px; font-size: 11px;">
          ${bay.bayDisplayName} - ${bay.displaySquareFootage.toLocaleString()} sf
        </div>
      `).join('')}
    </div>
    ${property.mechanicalRoomSquareFootage ? `
    <div style="margin-top: 15px;">
      <div class="info-item">
        <strong>Mechanical Room:</strong> ${property.mechanicalRoomSquareFootage.toLocaleString()} SF <em>(prorated across all bays)</em>
      </div>
    </div>
    ` : ''}
  </div>
  ` : ''}

  ${executedLeases.length > 0 ? `
  <div class="section">
    <h2>Executed Leases</h2>
    <table>
      <thead>
        <tr>
          <th>Tenant Name</th>
          <th>Rentable Area</th>
          <th>Vehicular Parking</th>
          <th>Trailer Parking</th>
          <th>Lease Date</th>
        </tr>
      </thead>
      <tbody>
        ${executedLeases.map(lease => {
          // Use override if available, otherwise calculate from bay configurations
          let totalRentableArea;
          if (lease.rentableAreaOverride) {
            totalRentableArea = lease.rentableAreaOverride;
          } else {
            const assignedBayConfigs = normalizedBays.filter(
              (bay: any) => lease.assignedBays?.includes(bay.id)
            );
            totalRentableArea = assignedBayConfigs.reduce(
              (total: number, bay: any) => total + bay.displaySquareFootage,
              0
            );
          }
          
          // Calculate vehicular parking total
          const vehicularParking = (lease.standardParking || 0) + (lease.accessibleParking || 0) + (lease.evParking || 0);
          
          return `
          <tr>
            <td>${lease.tenantName}</td>
            <td>${totalRentableArea.toLocaleString()} SF${lease.rentableAreaOverride ? ' <span style="color: #ea580c; font-size: 10px;">(Override)</span>' : ''}</td>
            <td>${vehicularParking} spaces</td>
            <td>${lease.trailerParking || 0} spaces</td>
            <td>N/A</td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="section">
    <h2>Available Space</h2>
    <div class="info-grid">
      <div class="info-item">
        <strong>Remaining Rentable Area:</strong> ${remainingArea ? remainingArea.toLocaleString() + ' SF' : 'N/A'}<br>
        <strong>Percentage Available:</strong> ${totalRentableArea ? ((remainingArea / totalRentableArea) * 100).toFixed(1) + '%' : 'N/A'}
      </div>
      <div class="info-item">
        <strong>Remaining Vehicular Parking:</strong> ${remainingVehicularParking} spaces<br>
        <strong>Remaining Trailer Parking:</strong> ${remainingTrailerParking} spaces
      </div>
    </div>
  </div>

  ${propertyImprovements.length > 0 ? `
  <div class="section">
    <h2>Existing Improvements</h2>
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Description</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Unit Price</th>
          <th>Total Cost</th>
        </tr>
      </thead>
      <tbody>
        ${propertyImprovements.map(improvement => {
          const totalCostDollars = (improvement.totalCost || 0) / 100;
          let quantity = 1;
          let unit = 'LS';
          let unitPrice = totalCostDollars;
          
          // Calculate based on allocation type
          if (improvement.allocationType === 'prorated') {
            // For prorated items, show per square foot
            const totalSF = totalRentableArea || 1;
            quantity = totalSF;
            unit = 'SF';
            unitPrice = totalCostDollars / totalSF;
          } else if (improvement.allocationType === 'bay-specific') {
            // For bay-specific items, show per bay
            const applicableBayCount = (improvement.applicableBays || []).length || 1;
            quantity = applicableBayCount;
            unit = 'Bay';
            unitPrice = totalCostDollars / applicableBayCount;
          } else if (improvement.allocationType === 'whole-property') {
            // For whole property items, show as lump sum
            quantity = 1;
            unit = 'LS';
            unitPrice = totalCostDollars;
          }
          
          return `
          <tr>
            <td>${(improvement.category || '').toUpperCase()}</td>
            <td>${improvement.description || ''}</td>
            <td>${quantity.toLocaleString()}</td>
            <td>${unit}</td>
            <td>$${unitPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>$${totalCostDollars.toLocaleString()}</td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
    <div style="margin-top: 15px; text-align: right;">
      <strong>Total Existing Improvements: $${propertyImprovements.reduce((sum, imp) => sum + ((imp.totalCost || 0) / 100), 0).toLocaleString()}</strong>
    </div>
  </div>
  ` : ''}
</body>
</html>
    `;
  }

  // Property print routes
  app.get("/api/properties/:id/print", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const executedLeases = await storage.getExecutedLeases(propertyId);
      const propertyImprovements = await storage.getPropertyExistingImprovements(propertyId);

      // Generate HTML for printing
      const html = generatePropertyPrintHtml(property, executedLeases, propertyImprovements);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="property-${property.propertyName.replace(/\s+/g, '-')}-report.html"`);
      res.send(html);
    } catch (error) {
      console.error("Error generating property print:", error);
      res.status(500).json({ message: "Failed to generate property print" });
    }
  });

  // Legal compliance rounding system
  app.post("/api/properties/:id/apply-legal-rounding", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Get legal total for this property
      let legalTotal: number;
      if (propertyId === 1) {
        legalTotal = LEGAL_TOTALS.BRIDGE_POINT_GRATIGNY;
      } else if (propertyId === 2) {
        legalTotal = LEGAL_TOTALS.BRIDGE_595_BUILDING_2;
      } else {
        return res.status(400).json({ message: "Legal total not defined for this property" });
      }

      // Apply legal rounding
      const { updatedBayConfigs, result } = applyLegalRounding(
        property.bayConfigurations || [], 
        legalTotal
      );

      if (result.success) {
        // Update property with rounded bay configurations
        await storage.updateProperty(propertyId, {
          bayConfigurations: updatedBayConfigs
        });

        res.json({
          success: true,
          message: result.message,
          adjustments: result.adjustedBays,
          originalTotal: result.originalTotal,
          finalTotal: result.finalTotal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message,
          originalTotal: result.originalTotal,
          finalTotal: result.finalTotal
        });
      }
    } catch (error) {
      console.error("Error applying legal rounding:", error);
      res.status(500).json({ message: "Failed to apply legal rounding" });
    }
  });

  app.get("/api/properties/:id/legal-compliance", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.id);
      const property = await storage.getProperty(propertyId);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // Get legal total for this property
      let legalTotal: number;
      if (propertyId === 1) {
        legalTotal = LEGAL_TOTALS.BRIDGE_POINT_GRATIGNY;
      } else if (propertyId === 2) {
        legalTotal = LEGAL_TOTALS.BRIDGE_595_BUILDING_2;
      } else {
        return res.status(400).json({ message: "Legal total not defined for this property" });
      }

      // Validate compliance
      const validation = validateLegalCompliance(
        property.bayConfigurations || [], 
        legalTotal
      );

      res.json({
        propertyId,
        propertyName: property.propertyName,
        legalTotal,
        ...validation
      });
    } catch (error) {
      console.error("Error checking legal compliance:", error);
      res.status(500).json({ message: "Failed to check legal compliance" });
    }
  });

  // ============================================================================
  // ELECTRICAL CAPACITY MANAGEMENT API ROUTES
  // ============================================================================

  // Transformers endpoints
  app.get("/api/transformers", async (req, res) => {
    try {
      const transformers = await storage.getTransformers();
      res.json(transformers);
    } catch (error) {
      console.error("Error fetching transformers:", error);
      res.status(500).json({ message: "Failed to fetch transformers" });
    }
  });

  app.get("/api/properties/:propertyId/transformers", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const transformers = await storage.getTransformersByProperty(propertyId);
      res.json(transformers);
    } catch (error) {
      console.error("Error fetching property transformers:", error);
      res.status(500).json({ message: "Failed to fetch property transformers" });
    }
  });

  app.post("/api/transformers", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const parsed = insertTransformerSchema.parse(req.body);
      const transformer = await storage.createTransformer(parsed);
      res.status(201).json(transformer);
    } catch (error) {
      console.error("Transformer creation error:", error);
      res.status(400).json({ 
        message: "Invalid transformer data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/properties/:propertyId/transformers", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const parsed = insertTransformerSchema.parse({
        ...req.body,
        propertyId
      });
      const transformer = await storage.createTransformer(parsed);
      res.status(201).json(transformer);
    } catch (error) {
      console.error("Transformer creation error:", error);
      res.status(400).json({ 
        message: "Invalid transformer data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/transformers/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const parsed = updateTransformerSchema.parse(req.body);
      const transformer = await storage.updateTransformer(id, parsed);
      
      if (!transformer) {
        return res.status(404).json({ message: "Transformer not found" });
      }

      res.json(transformer);
    } catch (error) {
      console.error("Transformer update error:", error);
      res.status(400).json({ 
        message: "Failed to update transformer", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/transformers/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const deleted = await storage.deleteTransformer(id);
      if (!deleted) {
        return res.status(404).json({ message: "Transformer not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Transformer deletion error:", error);
      res.status(500).json({ message: "Failed to delete transformer" });
    }
  });

  // Main Panels endpoints
  app.get("/api/transformers/:transformerId/panels", async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const panels = await storage.getMainPanelsByTransformer(transformerId);
      res.json(panels);
    } catch (error) {
      console.error("Error fetching main panels:", error);
      res.status(500).json({ message: "Failed to fetch main panels" });
    }
  });

  app.get("/api/properties/:propertyId/main-panels", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const panels = await storage.getMainPanelsByProperty(propertyId);
      res.json(panels);
    } catch (error) {
      console.error("Error fetching property main panels:", error);
      res.status(500).json({ message: "Failed to fetch property main panels" });
    }
  });

  app.post("/api/main-panels", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const parsed = insertMainPanelSchema.parse(req.body);
      const panel = await storage.createMainPanel(parsed);
      res.status(201).json(panel);
    } catch (error) {
      console.error("Main panel creation error:", error);
      res.status(400).json({ 
        message: "Invalid main panel data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/properties/:propertyId/main-panels", requireAuth, checkPermission('properties.create'), async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Get the property to verify it exists
      const property = await storage.getProperty(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const parsed = insertMainPanelSchema.parse(req.body);
      const panel = await storage.createMainPanel(parsed);
      res.status(201).json(panel);
    } catch (error) {
      console.error("Main panel creation error:", error);
      res.status(400).json({ 
        message: "Invalid main panel data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/main-panels/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid main panel ID" });
      }

      const parsed = updateMainPanelSchema.parse(req.body);
      const panel = await storage.updateMainPanel(id, parsed);
      
      if (!panel) {
        return res.status(404).json({ message: "Main panel not found" });
      }

      res.json(panel);
    } catch (error) {
      console.error("Main panel update error:", error);
      res.status(400).json({ 
        message: "Failed to update main panel", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/main-panels/:id", requireAuth, checkPermission('properties.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid main panel ID" });
      }

      const deleted = await storage.deleteMainPanel(id);
      if (!deleted) {
        return res.status(404).json({ message: "Main panel not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Main panel deletion error:", error);
      res.status(500).json({ message: "Failed to delete main panel" });
    }
  });

  // Bay Panel Assignments endpoints
  app.get("/api/properties/:propertyId/bay-panel-assignments", async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      const assignments = await storage.getBayPanelAssignments(propertyId);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching bay panel assignments:", error);
      res.status(500).json({ message: "Failed to fetch bay panel assignments" });
    }
  });

  app.post("/api/bay-panel-assignments", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const parsed = insertBayPanelAssignmentSchema.parse(req.body);
      const assignment = await storage.createBayPanelAssignment(parsed);
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Bay panel assignment creation error:", error);
      res.status(400).json({ 
        message: "Invalid bay panel assignment data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/bay-panel-assignments/:id", requireAuth, checkPermission('properties.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment ID" });
      }

      const deleted = await storage.deleteBayPanelAssignment(id);
      if (!deleted) {
        return res.status(404).json({ message: "Bay panel assignment not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Bay panel assignment deletion error:", error);
      res.status(500).json({ message: "Failed to delete bay panel assignment" });
    }
  });

  // Electrical Reservations endpoints
  app.get("/api/transformers/:transformerId/reservations", async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const reservations = await storage.getElectricalReservations(transformerId);
      res.json(reservations);
    } catch (error) {
      console.error("Error fetching electrical reservations:", error);
      res.status(500).json({ message: "Failed to fetch electrical reservations" });
    }
  });

  app.get("/api/rfp-requests/:rfpId/electrical-reservation", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const reservation = await storage.getElectricalReservationByRfp(rfpId);
      res.json(reservation);
    } catch (error) {
      console.error("Error fetching RFP electrical reservation:", error);
      res.status(500).json({ message: "Failed to fetch RFP electrical reservation" });
    }
  });

  app.post("/api/electrical-reservations", requireAuth, checkPermission('rfp.create'), async (req, res) => {
    try {
      const parsed = insertElectricalReservationSchema.parse({
        ...req.body,
        createdBy: req.user?.username || 'unknown'
      });
      const reservation = await storage.createElectricalReservation(parsed);
      res.status(201).json(reservation);
    } catch (error) {
      console.error("Electrical reservation creation error:", error);
      res.status(400).json({ 
        message: "Invalid electrical reservation data", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.patch("/api/electrical-reservations/:id", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reservation ID" });
      }

      const parsed = updateElectricalReservationSchema.parse(req.body);
      const reservation = await storage.updateElectricalReservation(id, parsed);
      
      if (!reservation) {
        return res.status(404).json({ message: "Electrical reservation not found" });
      }

      res.json(reservation);
    } catch (error) {
      console.error("Electrical reservation update error:", error);
      res.status(400).json({ 
        message: "Failed to update electrical reservation", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.delete("/api/electrical-reservations/:id", requireAuth, checkPermission('rfp.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid reservation ID" });
      }

      const deleted = await storage.deleteElectricalReservation(id);
      if (!deleted) {
        return res.status(404).json({ message: "Electrical reservation not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Electrical reservation deletion error:", error);
      res.status(500).json({ message: "Failed to delete electrical reservation" });
    }
  });

  // Power Bank Dashboard - get capacity summary for a transformer
  app.get("/api/transformers/:transformerId/capacity-summary", async (req, res) => {
    try {
      const transformerId = parseInt(req.params.transformerId);
      if (isNaN(transformerId)) {
        return res.status(400).json({ message: "Invalid transformer ID" });
      }

      const summary = await storage.getTransformerCapacitySummary(transformerId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching transformer capacity summary:", error);
      res.status(500).json({ message: "Failed to fetch transformer capacity summary" });
    }
  });

  // Power Bank Dashboard - get capacity overview for all properties
  app.get("/api/electrical-capacity/overview", async (req, res) => {
    try {
      const overview = await storage.getElectricalCapacityOverview();
      res.json(overview);
    } catch (error) {
      console.error("Error fetching electrical capacity overview:", error);
      res.status(500).json({ message: "Failed to fetch electrical capacity overview" });
    }
  });

  // RFP Electrical Capacity Validation - check if capacity is available for RFP
  app.post("/api/rfp-requests/:rfpId/validate-electrical-capacity", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const { transformerId, requestedKva } = req.body;
      if (!transformerId || !requestedKva) {
        return res.status(400).json({ message: "Transformer ID and requested kVA are required" });
      }

      const validation = await storage.validateElectricalCapacity(transformerId, requestedKva, rfpId);
      res.json(validation);
    } catch (error) {
      console.error("Error validating electrical capacity:", error);
      res.status(500).json({ message: "Failed to validate electrical capacity" });
    }
  });

  // Version endpoint
  app.get("/api/version", async (req, res) => {
    try {
      const versionData = JSON.parse(readFileSync(path.join(process.cwd(), 'version.json'), 'utf-8'));
      
      // Add runtime information
      const runtimeInfo = {
        ...versionData,
        nodeVersion: process.version,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      };
      
      res.json(runtimeInfo);
    } catch (error) {
      console.error("Error reading version info:", error);
      res.status(500).json({ 
        message: "Failed to read version info",
        version: "unknown",
        environment: process.env.NODE_ENV || 'development'
      });
    }
  });

  // ============================================================================
  // RFP TEMPLATES API ROUTES
  // ============================================================================

  // List templates with optional search and archived filter
  app.get("/api/templates", async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const includeArchived = req.query.includeArchived === 'true';
      
      const result = await Templates.listTemplates({ search, includeArchived });
      res.json(result);
    } catch (error) {
      console.error("Error listing templates:", error);
      res.status(500).json({ message: "Failed to list templates" });
    }
  });

  // Get single template by ID
  app.get("/api/templates/:id", async (req, res) => {
    try {
      const template = await Templates.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error("Error fetching template:", error);
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  // Create new template (admin only)
  app.post("/api/templates", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const user = (req as any).user;
      const template = await Templates.createTemplate({
        ...req.body,
        createdBy: user?.username || 'admin'
      });
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      const message = error instanceof Error ? error.message : "Failed to create template";
      res.status(400).json({ message });
    }
  });

  // Update template (admin only)
  app.patch("/api/templates/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const user = (req as any).user;
      const template = await Templates.updateTemplate(req.params.id, {
        ...req.body,
        metadata: {
          ...req.body.metadata,
          updatedBy: user?.username || 'admin'
        }
      });
      res.json(template);
    } catch (error) {
      console.error("Error updating template:", error);
      const message = error instanceof Error ? error.message : "Failed to update template";
      res.status(400).json({ message });
    }
  });

  // Duplicate template (admin only)
  app.post("/api/templates/:id/duplicate", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const user = (req as any).user;
      const template = await Templates.duplicateTemplate(req.params.id, user?.username || 'admin');
      res.status(201).json(template);
    } catch (error) {
      console.error("Error duplicating template:", error);
      const message = error instanceof Error ? error.message : "Failed to duplicate template";
      res.status(400).json({ message });
    }
  });

  // Archive/Unarchive template (admin only)
  app.patch("/api/templates/:id/archive", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const { archived } = req.body;
      const template = await Templates.archiveTemplate(req.params.id, archived === true);
      res.json(template);
    } catch (error) {
      console.error("Error archiving template:", error);
      const message = error instanceof Error ? error.message : "Failed to archive template";
      res.status(400).json({ message });
    }
  });

  // Delete template (admin only)
  app.delete("/api/templates/:id", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      await Templates.deleteTemplate(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting template:", error);
      const message = error instanceof Error ? error.message : "Failed to delete template";
      res.status(400).json({ message });
    }
  });

  // Build import preview for a template
  app.post("/api/templates/:id/preview", async (req, res) => {
    try {
      const template = await Templates.getTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      const { subtotalsContext = {} } = req.body;
      const preview = Templates.buildImportPreview(template, subtotalsContext);
      res.json(preview);
    } catch (error) {
      console.error("Error building template preview:", error);
      res.status(500).json({ message: "Failed to build template preview" });
    }
  });

  // Email Admin Routes

  // Send status report manually (admin only)
  app.post("/api/admin/email/send-status-report", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const result = await sendStatusReportNow();
      if (result.success) {
        res.json({ message: "Status report sent successfully" });
      } else {
        res.status(500).json({ message: result.error || "Failed to send status report" });
      }
    } catch (error) {
      console.error("Error sending status report:", error);
      res.status(500).json({ message: "Failed to send status report" });
    }
  });

  // Get owner contacts (for preview/testing)
  app.get("/api/admin/email/owner-contacts", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const owners = await storage.getContactsByType('owner');
      res.json(owners.map(owner => ({
        id: owner.id,
        name: owner.name,
        email: owner.email,
        company: owner.company
      })));
    } catch (error) {
      console.error("Error fetching owner contacts:", error);
      res.status(500).json({ message: "Failed to fetch owner contacts" });
    }
  });

  // Send test status report to a specific email (admin only)
  app.post("/api/admin/email/send-test", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email address is required" });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address format" });
      }
      
      const result = await sendTestStatusReportEmail(email);
      if (result.success) {
        res.json({ message: `Test email sent successfully to ${email}` });
      } else {
        res.status(500).json({ message: result.error || "Failed to send test email" });
      }
    } catch (error) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
