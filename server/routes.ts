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
  updateRomScopeItemSchema
} from "@shared/schema";
import { validateRfpForProgression, canAdvanceToPhase } from "./validation";
import { AuthService } from "./auth";
import { users, contacts } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { tokenStore } from "./token-auth";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { generateRfpPdf, generatePdfFilename } from "./pdf-generator";
import archiver from "archiver";
import fs from "fs";
import path from "path";

// Generate HTML for bid collection PDF
function generateBidCollectionHtml(bidCollection: any, rfp: any, lineItems: any[]) {
  const totalAmount = lineItems.reduce((sum, item) => sum + parseFloat(item.totalPrice || '0'), 0);
  
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
                <td class="currency">${item.unitPrice ? '$' + parseFloat(item.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                <td class="currency">${item.totalPrice ? '$' + parseFloat(item.totalPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
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
import multer from "multer";
import path from "path";
import fs from "fs";

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

// Session middleware setup - simplified for development
function setupSession(app: Express) {
  // Trust proxy for Replit environment
  app.set('trust proxy', 1);
  
  app.use(session({
    secret: process.env.SESSION_SECRET || 'rfp-tracker-dev-secret-2024',
    resave: true,
    saveUninitialized: true,
    rolling: false,
    name: 'connect.sid',
    cookie: {
      secure: false,
      httpOnly: false, // Allow JS access for debugging
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/'
    }
  }));
}

// Authentication middleware
async function requireAuth(req: any, res: any, next: any) {
  // Check for token in Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  const userId = await tokenStore.getUserFromToken(token);
  if (!userId) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  req.userId = userId;
  next();
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
        console.log("Admin login successful - Token generated for user:", user.username);
        
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

      const token = await tokenStore.generateToken(`contact_${contact.id}`);
      console.log("Contact login successful - Token generated for:", contact.email);

      res.json({ 
        user: {
          id: `contact_${contact.id}`,
          username: contact.email,
          name: contact.name,
          isAdmin: false,
          isContact: true,
          permissions: contact.permissions,
          role: 'contact'
        },
        token,
        message: "Login successful" 
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
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

    res.json({ message: "Logout successful" });
  });

  app.get('/api/auth/user', requireAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      
      // Check if it's a contact user
      if (userId.startsWith('contact_')) {
        const contactId = parseInt(userId.replace('contact_', ''));
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
        
        if (!contact || !contact.hasSystemAccess) {
          return res.status(404).json({ message: "Contact not found" });
        }

        return res.json({
          id: userId,
          username: contact.email,
          name: contact.name,
          isAdmin: false,
          isContact: true,
          permissions: contact.permissions,
          role: 'contact'
        });
      }

      // Regular admin user
      const user = await AuthService.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "Failed to fetch user" });
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

  // Get RFP statistics (must come before /:id route)
  app.get("/api/rfp-requests/stats", async (req, res) => {
    try {
      const allRequests = await storage.getAllRfpRequests();
      
      const stats = {
        total: allRequests.length,
        received: allRequests.filter(r => r.status === "received").length,
        inProgress: allRequests.filter(r => r.status === "in-progress").length,
        completed: allRequests.filter(r => r.status === "completed").length,
        onHold: allRequests.filter(r => r.status === "on-hold").length,
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Get all RFP requests
  app.get("/api/rfp-requests", async (req, res) => {
    try {
      const { search, status } = req.query;
      
      let requests;
      if (search) {
        requests = await storage.searchRfpRequests(search as string);
      } else if (status) {
        requests = await storage.filterRfpRequestsByStatus(status as string);
      } else {
        requests = await storage.getAllRfpRequests();
      }
      
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch RFP requests" });
    }
  });

  // Get single RFP request
  app.get("/api/rfp-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const request = await storage.getRfpRequest(id);
      if (!request) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      res.json(request);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch RFP request" });
    }
  });

  // Create new RFP request
  app.post("/api/rfp-requests", async (req, res) => {
    try {
      console.log('Creating RFP with data:', req.body);
      
      const parsed = insertRfpRequestSchema.parse(req.body);
      
      // Create RFP without files initially
      const requestData = {
        ...parsed,
        files: [],
        dueDate: parsed.internalDueDate, // Map internalDueDate to dueDate for validation
      };

      const newRequest = await storage.createRfpRequest(requestData);
      res.status(201).json(newRequest);
    } catch (error) {
      console.error('RFP creation error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Invalid request data" 
      });
    }
  });

  // Create new RFP request with files
  app.post("/api/rfp-requests/with-files", requireAuth, upload.array("files"), async (req, res) => {
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

      // Ensure sentBy field is present (frontend should send this directly now)

      // Parse with schema first, then convert dates for database
      const parsed = insertRfpRequestSchema.parse(formData);
      
      // Convert date strings to Date objects for database storage
      if (parsed.receivedOn && typeof parsed.receivedOn === 'string') {
        parsed.receivedOn = new Date(parsed.receivedOn);
      }
      if (parsed.internalDueDate && typeof parsed.internalDueDate === 'string') {
        parsed.internalDueDate = new Date(parsed.internalDueDate);
      }
      if (parsed.contractorDueDate && typeof parsed.contractorDueDate === 'string') {
        parsed.contractorDueDate = new Date(parsed.contractorDueDate);
      }
      if (parsed.architectDueDate && typeof parsed.architectDueDate === 'string') {
        parsed.architectDueDate = new Date(parsed.architectDueDate);
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

      const requestWithFiles = {
        ...parsed,
        files: uploadedFiles,
        selectedBayConfigurations: selectedBayConfigurations,
        dueDate: parsed.internalDueDate, // Map internalDueDate to dueDate for validation
      };

      console.log('About to create RFP with selectedBayConfigurations:', requestWithFiles.selectedBayConfigurations?.length || 0);

      const newRequest = await storage.createRfpRequest(requestWithFiles);
      res.status(201).json(newRequest);
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

      res.json(updatedRequest);
    } catch (error) {
      res.status(400).json({ 
        message: error instanceof Error ? error.message : "Failed to advance workflow phase" 
      });
    }
  });

  // Delete RFP request
  app.delete("/api/rfp-requests/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Get the request to clean up files
      const request = await storage.getRfpRequest(id);
      if (request) {
        // Delete associated files from disk
        request.files.forEach(file => {
          const filePath = path.join(uploadsDir, file.path || file.name);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        });
      }

      const deleted = await storage.deleteRfpRequest(id);
      if (!deleted) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      res.status(200).json({ message: "RFP request deleted successfully" });
    } catch (error) {
      console.error('Delete RFP error:', error);
      res.status(500).json({ 
        message: "Failed to delete RFP request",
        error: error instanceof Error ? error.message : String(error)
      });
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

  // Delete file from RFP
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
      if (file) {
        // Delete file from disk
        const filePath = path.join(uploadsDir, file.path || file.name);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      const updatedRequest = await storage.removeFileFromRfp(id, fileId);
      if (!updatedRequest) {
        return res.status(404).json({ message: "Failed to remove file" });
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to delete file" });
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

      // Convert string boolean to actual boolean
      if (formData.confidential === 'true') {
        formData.confidential = true;
      } else if (formData.confidential === 'false') {
        formData.confidential = false;
      } else {
        formData.confidential = Boolean(formData.confidential);
      }

      // Convert date strings to Date objects for database
      if (formData.receivedOn && typeof formData.receivedOn === 'string') {
        formData.receivedOn = new Date(formData.receivedOn);
      }
      if (formData.internalDueDate && typeof formData.internalDueDate === 'string') {
        formData.internalDueDate = new Date(formData.internalDueDate);
      }
      if (formData.contractorDueDate && typeof formData.contractorDueDate === 'string') {
        formData.contractorDueDate = new Date(formData.contractorDueDate);
      }
      if (formData.architectDueDate && typeof formData.architectDueDate === 'string') {
        formData.architectDueDate = new Date(formData.architectDueDate);
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

      console.log('Updating RFP with files - processed data:', formData);

      // Update the RFP request first
      const updatedRequest = await storage.updateRfpRequest(id, formData);
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
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

  app.delete("/api/contacts/:id", async (req, res) => {
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

  app.delete("/api/invitations/:id", async (req, res) => {
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

  app.delete("/api/rfp-requests/:id/invitation-to-bid", async (req, res) => {
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
  app.post("/api/rfp-requests/:id/generate-pdf", async (req, res) => {
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

      const pdfOptions = {
        rfp: rfpWithAddress,
        invitationToBid,
        recipientType: recipientType as "architect" | "contractor" | "broker-architect" | "broker-contractor",
        recipientName,
        recipientCompany
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
      res.json(bidCollections);
    } catch (error) {
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
      let bidData, lineItems;
      
      if (req.body.bidData) {
        // Original JSON format
        bidData = JSON.parse(req.body.bidData);
        lineItems = JSON.parse(req.body.lineItems || '[]');
      } else {
        // New form-data format
        bidData = {
          contractorId: parseInt(req.body.contractorId),
          contractorName: req.body.contractorName,
          contractorCompany: req.body.contractorCompany,
          contractorEmail: req.body.contractorEmail,
          submissionDate: req.body.submissionDate,
          totalAmount: req.body.totalAmount,
          status: req.body.status || 'received',
          notes: req.body.notes || ''
        };
        lineItems = JSON.parse(req.body.lineItems || '[]');
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
        status: req.body.status,
        notes: req.body.notes || ''
      };
      
      const lineItems = JSON.parse(req.body.lineItems || '[]');
      
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

      res.json(bidCollection);
    } catch (error) {
      console.error("Bid collection update error:", error);
      res.status(400).json({ message: "Failed to update bid collection" });
    }
  });

  app.delete("/api/rfp-requests/:rfpId/bid-collections/:id", async (req, res) => {
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
      res.json(lineItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch line items" });
    }
  });

  // Property routes
  app.get("/api/properties", async (req, res) => {
    try {
      const properties = await storage.getAllProperties();
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

      const property = await storage.updateProperty(id, result.data);
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

      const property = await storage.updateProperty(id, result.data);
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

  app.delete("/api/properties/:id", async (req, res) => {
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
      res.json(improvements);
    } catch (error) {
      console.error('Error fetching property existing improvements:', error);
      res.status(500).json({ message: "Failed to fetch existing improvements" });
    }
  });

  app.post("/api/properties/:propertyId/existing-improvements", requireAuth, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }

      // Convert total cost from dollars to cents
      const improvementData = {
        ...req.body,
        propertyId,
        totalCost: Math.round(req.body.totalCost * 100), // Convert to cents
      };

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
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid improvement ID" });
      }

      const updates = { ...req.body };
      // Convert total cost from dollars to cents if provided
      if (updates.totalCost !== undefined) {
        updates.totalCost = Math.round(updates.totalCost * 100);
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

  app.delete("/api/properties/:propertyId/existing-improvements/:id", async (req, res) => {
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

  // Evaluation Budget routes
  app.post("/api/rfp-requests/:rfpId/evaluation-budget", async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const budgetData = req.body;
      
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
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 15px; }
            .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
            .header .subtitle { font-size: 14px; color: #6b7280; margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; }
            th { background: #f9fafb; font-weight: 600; }
            th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(6), th:nth-child(7), th:nth-child(8), th:nth-child(9) { text-align: center; }
            td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7), td:nth-child(8), td:nth-child(9) { text-align: center; }
            th:nth-child(3) { width: 100px; }
            td:nth-child(3) { width: 100px; }
            th:nth-child(4), th:nth-child(5) { width: 80px; }
            td:nth-child(4), td:nth-child(5) { width: 80px; }
            th:nth-child(6) { width: 60px; }
            td:nth-child(6) { width: 60px; }
            th:nth-child(7) { width: 120px; }
            td:nth-child(7) { width: 120px; }
            th:nth-child(8) { width: 140px; }
            td:nth-child(8) { width: 140px; text-align: right; }
            th:nth-child(9) { width: 90px; }
            td:nth-child(9) { width: 90px; text-align: right; }
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
            <h1>Executive Summary Report</h1>
            <div class="subtitle">RFP Status Overview - Generated on ${new Date().toLocaleDateString()}</div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>RFP Number</th>
                <th>Project Name</th>
                <th>Rentable SF</th>
                <th>Date Received</th>
                <th>Due Date</th>
                <th>Days Until Due</th>
                <th>Status</th>
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
                    dayDisplay = Math.abs(daysUntil) + ' days overdue';
                  } else {
                    dayDisplay = daysUntil + ' days';
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

                return '<tr>' +
                  '<td><strong>' + (rfp.rfpNumber || 'N/A') + '</strong></td>' +
                  '<td>' + (rfp.projectName || 'N/A').replace(/ - $/, '') + '</td>' +
                  '<td>' + rentableSF + '</td>' +
                  '<td>' + receivedDate.toLocaleDateString() + '</td>' +
                  '<td>' + dueDateDisplay + '</td>' +
                  '<td>' + dayDisplay + '</td>' +
                  '<td>' + statusDisplay + '</td>' +
                  '<td style="font-weight: bold; text-align: right;">' + grandTotalDisplay + '</td>' +
                  '<td style="font-weight: bold; text-align: right;">' + rsfDisplay + '</td>' +
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
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 15px; }
            .header h1 { font-size: 24px; margin: 0; color: #1f2937; }
            .header .subtitle { font-size: 14px; color: #6b7280; margin: 5px 0; }
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
            <h1>${title}</h1>
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
      const pilot = await storage.createRomPilot(req.body);
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

  app.delete("/api/rom-pilots/:id", async (req, res) => {
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

      console.log("Updating ROM scope item ID:", id);
      console.log("Update data:", req.body);

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
      console.error("ROM scope item update error:", error);
      res.status(500).json({ message: "Failed to update scope item", error: error.message });
    }
  });

  app.delete("/api/rom-scope-items/:id", async (req, res) => {
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

  app.post("/api/rom-pilots/:id/line-items", requireAuth, async (req, res) => {
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

  app.delete("/api/rom-pilots/:id/line-items", async (req, res) => {
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
  function generateRomReportHtml(romPilot: any, lineItems: any[], scopeItems: any[], generatedBy: string = 'Unknown User'): string {
    const currentDate = new Date().toLocaleDateString();
    
    // Categorize line items
    const tenantImprovements = lineItems.filter(item => item.category === 'tenant-improvements');
    const designSoftCosts = lineItems.filter(item => item.category === 'design-soft-costs');
    
    // Calculate totals
    const calculateCategoryTotal = (items: any[]) => {
      return items.reduce((sum: number, item: any) => sum + (parseFloat(item.totalPrice) || 0), 0);
    };
    
    const formatCurrency = (amount: number) => {
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
    
    // Calculate total square footage from selected bay configurations
    let totalSquareFootage = 51094; // Using the rentable area from the image
    console.log('ROM Pilot data:', JSON.stringify(romPilot, null, 2));
    console.log('Total square footage:', totalSquareFootage);
    
    if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations)) {
      const calculatedSF = romPilot.selectedBayConfigurations.reduce((sum: number, bay: any) => {
        return sum + (bay.squareFootage || 0);
      }, 0);
      if (calculatedSF > 0) {
        totalSquareFootage = calculatedSF;
      }
      console.log('Calculated SF from bays:', calculatedSF);
    }
    
    const renderCategorySection = (title: string, items: any[], categoryTotal: number, bgColor: string) => {
      if (items.length === 0) return '';
      
      const categoryPerSF = totalSquareFootage > 0 ? categoryTotal / totalSquareFootage : 0;
      
      return `
        <div style="margin-bottom: 30px;">
          <div style="background: ${bgColor}; padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">${title}</h2>
            <div style="color: #065f46; display: flex; align-items: baseline; gap: 4px;">
              <span style="font-size: 20px; font-weight: bold;">${formatCurrency(categoryTotal)}</span>
              <span style="font-size: 8px; font-style: italic; font-weight: normal; color: #999;">(${formatCurrency(categoryPerSF)} / sf)</span>
            </div>
          </div>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: left; font-weight: 600; width: 40%;">DESCRIPTION</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: center; font-weight: 600; width: 12%;">QUANTITY</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: center; font-weight: 600; width: 12%;">UNIT</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: center; font-weight: 600; width: 15%;">UNIT PRICE</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: center; font-weight: 600; width: 15%;">TOTAL PRICE</th>
                <th style="border: 1px solid #e5e7eb; padding: 12px; text-align: center; font-weight: 600; width: 6%;">$ / SF</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => {
                const scopeItem = scopeItems.find(si => si.id === item.scopeItemId);
                const itemTotal = parseFloat(item.totalPrice) || 0;
                const perSF = totalSquareFootage > 0 ? itemTotal / totalSquareFootage : 0;
                
                return `
                  <tr>
                    <td style="border: 1px solid #e5e7eb; padding: 8px;">${scopeItem?.name || 'Custom Item'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 8px; text-align: center;">${new Intl.NumberFormat('en-US').format(parseInt(item.quantity) || 0)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 8px; text-align: center;">${scopeItem?.unit || 'ea'}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 8px; text-align: center;">${formatCurrency(parseFloat(item.unitPrice) || 0)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 8px; text-align: center;">${formatCurrency(itemTotal)}</td>
                    <td style="border: 1px solid #e5e7eb; padding: 8px; text-align: center;">${formatPerSF(itemTotal, totalSquareFootage)}</td>
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
            text-align: center; 
            margin-bottom: 30px; 
            border-bottom: 2px solid #e5e7eb; 
            padding-bottom: 20px; 
          }
          .header h1 { 
            font-size: 28px; 
            margin: 0 0 15px 0; 
            color: #1f2937; 
            font-weight: 700;
          }
          .header-info { 
            display: flex; 
            justify-content: space-between; 
            align-items: flex-start; 
            margin-top: 15px;
          }
          .header-left { text-align: left; }
          .header-right { text-align: right; }
          .header p { 
            margin: 3px 0; 
            font-size: 14px; 
            color: #4b5563; 
          }
          .header strong { color: #1f2937; }
          .grand-total {
            margin-top: 30px;
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: #065f46;
            border-top: 3px solid #e5e7eb;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <p>ROM Budget Report - Use your browser's print function to save as PDF or print this report</p>
        </div>
        
        <div class="header">
          <h1>ROM Budget Report</h1>
          <div class="header-info">
            <div class="header-left">
              <p><strong>Project:</strong> ${romPilot.projectName}</p>
              <p><strong>Property:</strong> ${romPilot.property}</p>
              <p><strong>Generated:</strong> ${currentDate}</p>
              <p><strong>Generated by:</strong> ${generatedBy}</p>
            </div>
            <div class="header-right">
              <p><strong>Rentable Area:</strong> ${totalSquareFootage > 0 ? new Intl.NumberFormat('en-US').format(totalSquareFootage) + ' sf' : 'N/A'}</p>
            </div>
          </div>
        </div>

        ${renderCategorySection("Tenant Improvements", tenantImprovements, tenantImprovementsTotal, "#f0fdf4")}
        ${renderCategorySection("Design / Soft Costs / Other Fees", designSoftCosts, designSoftCostsTotal, "#fef3f2")}

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
      const generatedBy = user?.name || user?.username || 'Unknown User';
      
      // Generate HTML report
      const html = generateRomReportHtml(romPilot, lineItems, scopeItems, generatedBy);
      
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

  app.delete('/api/admin/users/:id', async (req, res) => {
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

  // Generate bid collection PDF
  app.get("/api/bid-collections/:id/pdf", requireAuth, async (req, res) => {
    try {
      const bidCollectionId = parseInt(req.params.id);

      if (isNaN(bidCollectionId)) {
        return res.status(400).json({ message: "Invalid bid collection ID" });
      }

      const bidCollection = await storage.getBidCollection(bidCollectionId);
      if (!bidCollection) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      const rfp = await storage.getRfpRequest(bidCollection.rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      const lineItems = await storage.getBidLineItemsByBid(bidCollectionId);
      
      // Generate HTML for bid collection
      const html = generateBidCollectionHtml(bidCollection, rfp, lineItems);
      
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `inline; filename="bid-collection-${bidCollection.contractorName.replace(/\s+/g, '-')}.html"`);
      res.send(html);
    } catch (error) {
      console.error("Bid collection PDF generation error:", error);
      res.status(500).json({ message: "Failed to generate bid collection PDF" });
    }
  });

  // Download bid collection attachment
  app.get("/api/bid-collections/:id/attachments/:fileId", requireAuth, async (req, res) => {
    try {
      const bidCollectionId = parseInt(req.params.id);
      const fileId = req.params.fileId;

      if (isNaN(bidCollectionId)) {
        return res.status(400).json({ message: "Invalid bid collection ID" });
      }

      const bidCollection = await storage.getBidCollection(bidCollectionId);
      if (!bidCollection) {
        return res.status(404).json({ message: "Bid collection not found" });
      }

      const file = bidCollection.attachments?.find((f: any) => f.id === fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const filePath = path.join(uploadsDir, file.path || file.name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.download(filePath, file.name);
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Get comprehensive file count for an RFP from all workflow stages
  app.get("/api/rfp-requests/:id/file-count", requireAuth, async (req, res) => {
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
        evaluationBudget: 0
      };

      // 1. RFP Entry files
      if (rfp.files && rfp.files.length > 0) {
        filesByStage.rfpEntry = rfp.files.length;
        totalFiles += rfp.files.length;
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

      // Create zip archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // compression level
      });

      // Set response headers
      const zipFilename = `RFP-${rfp.rfpNumber}-All-Files.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      
      // Pipe archive to response
      archive.pipe(res);

      let hasFiles = false;

      // 1. RFP Entry files (original RFP documents)
      if (rfp.files && rfp.files.length > 0) {
        for (const file of rfp.files) {
          const filePath = path.join(uploadsDir, file.path || file.name);
          if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: `1-RFP-Entry/${file.name}` });
            hasFiles = true;
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

      // If no files found, add a readme
      if (!hasFiles) {
        archive.append('No files have been uploaded for this RFP yet.', { name: 'README.txt' });
      }

      // Finalize the archive
      await archive.finalize();

    } catch (error) {
      console.error("Download all files error:", error);
      res.status(500).json({ message: "Failed to create zip file" });
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
      const { reportName, generatedContent, notes } = req.body;
      const generatedBy = req.user?.username || 'Unknown';
      
      // Get current evaluation budget to compare changes
      const currentBudget = await storage.getEvaluationBudget(rfpId);
      
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

  const httpServer = createServer(app);
  return httpServer;
}
