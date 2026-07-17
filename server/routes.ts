/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import { users, contacts, insertRfpRequestSchema, updateRfpRequestSchema, insertContactSchema, updateContactSchema, insertInvitationSchema, updateInvitationSchema, insertInvitationToBidSchema, updateInvitationToBidSchema, insertPdfTemplateSchema, auditLog, romScopeItems, masterItemReviewQueue, evaluationBudgets, projectAlternates, insertProjectAlternateSchema, bidLineItems, properties, projectActuals, projectActualLineItems } from "@shared/schema";
import { convertFormDateToDbDate } from "@shared/date-utils";
import { parseRfpVariant } from "@shared/rfp-variant";
import { eq, desc, and, or, gte, lte, ilike, inArray, sql as drizzleSql } from "drizzle-orm";
import { tokenStore } from "./token-auth";
import { logEvent } from "./audit-log";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";

// Single source of truth for all accepted PDF recipient types.
// Any new variant MUST be added here — the GET preview route and POST generate
// route both reference this constant so they can never diverge.
export const ALLOWED_RECIPIENT_TYPES = [
  "architect",
  "contractor",
  "broker-architect",
  "broker-contractor",
  "contractor-enhanced",
  "architect-enhanced",
] as const;
export type RecipientType = typeof ALLOWED_RECIPIENT_TYPES[number];
import { generateRfpPdf } from "./pdf-generator";
import { enforceAllPropertiesLegalCompliance } from "./property-legal-compliance";
import Templates from "./lib/rfp-templates";
import { sendWorkflowCompletionEmail, sendTestStatusReportEmail } from "./email-service";
import { sendStatusReportNow } from "./email-scheduler";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { resolveLiveRomItemPricing, normalizeUnit, categorizeRomLineItem, isKnownRomCategory } from "./rom-pricing-utils";
import { parsePdfBuffer, applyMapping, type MappingConfig } from "./pdf-parser";
import {
  sanitizeProjectName,
  createProjectFolderStructure,
  getWorkflowStepFolder,
  getStepFolderPath,
  getRelativeFilePath,
  sanitizeFilename,
  getSecureDownloadPath,
  resolveSecureFilePath
} from "./file-organization";
import { validateRfpForProgression, canAdvanceToPhase } from "./validation";
import { checkPermission, upload, pdfUpload, uploadsDir, setupSession, requireAuth, requireAuthFlexible, requireAdmin } from './middleware';
import { generateBidCollectionHtml, generateAllBidCollectionsHtml, generateRfpPreviewHtml } from './html-generators';
import { registerAuthRoutes } from './auth-routes';
import { AuthService } from './auth';
import { registerRomRoutes } from './rom-routes';
import { registerActualsRoutes } from './actuals-routes';
import { registerPropertyRoutes } from './property-routes';
import { registerCostsInPlaceReportRoutes } from './costs-in-place-report';
import { registerOccupancyReportRoutes } from './occupancy-report';
import { registerAiRoutes } from './ai-routes';
import { registerProposalsRoutes } from './proposals-routes';
import { registerDashboardRoutes } from './dashboard-routes';
import { streamFromObjectStorage, listObjectStorageFiles } from './storage-backup';

// Helper function to clean invalid values like "$NaN", "NaN", etc.
function cleanInvalidValue(value: any): string {
  if (!value) return '';
  const strValue = String(value);
  if (strValue.includes('$NaN') || strValue === 'NaN' || strValue.includes('Error:')) {
    return '';
  }
  return strValue;
}

// Returns the Kurv/Bridge logo as a base64 data URI for embedding in report HTML.
// Matches the helper used by the other report modules. Returns '' if unavailable.
function getBridgeLogo(): string {
  try {
    const logoPath = path.join(process.cwd(), 'bridge_logo_new_base64.txt');
    const base64 = fs.readFileSync(logoPath, 'utf-8').trim();
    return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  } catch {
    return '';
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Register extracted route modules
  registerAuthRoutes(app);
  registerRomRoutes(app);
  registerActualsRoutes(app);
  registerPropertyRoutes(app);
  registerCostsInPlaceReportRoutes(app);
  registerOccupancyReportRoutes(app);
  registerAiRoutes(app);
  registerProposalsRoutes(app);
  registerDashboardRoutes(app);

  // Serve files from the uploads directory — local disk first, then Object Storage fallback
  app.get('/uploads/*', requireAuthFlexible, async (req, res) => {
    const filename = path.basename(req.path);
    const candidates = [
      path.join(process.cwd(), req.path),
      path.join(process.cwd(), 'uploads', filename),
      path.join(process.cwd(), 'uploads', 'projects', filename),
    ];
    for (const filePath of candidates) {
      console.log('Looking for file at:', filePath, 'Exists:', fs.existsSync(filePath));
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
    // Not on local disk — try Object Storage using key: .private/uploads/<filename>
    // filename is path.basename(req.path) — just the bare filename, no directory prefix
    try {
      const served = await streamFromObjectStorage(filename, res);
      if (served) return;
    } catch (err) {
      console.error('[OS Backup] Error fetching from object storage:', err);
    }
    res.status(404).json({ message: 'File not found' });
  });

  // Auto-enforce legal compliance on startup for ALL properties
  // Temporarily disabled to fix database connection issue during startup
  console.log('🏛️ STARTUP: Skipping legal compliance enforcement to allow server startup...');

  // Setup session middleware
  setupSession(app);
  
  // Register object storage routes for file uploads
  registerObjectStorageRoutes(app);
  
  // PDF Bid Import - Parse PDF and extract table data for mapping
  app.post("/api/bid-import/parse-pdf", requireAuth, pdfUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No PDF file uploaded" });
      }
      
      if (req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({ message: "Only PDF files are supported" });
      }
      
      const result = await parsePdfBuffer(req.file.buffer);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error || "Failed to parse PDF" });
      }
      
      res.json({
        success: true,
        tables: result.tables,
        pageCount: result.pageCount,
        rawText: result.rawText.substring(0, 5000)
      });
    } catch (error) {
      console.error("PDF parsing error:", error);
      res.status(500).json({ message: "Failed to parse PDF file" });
    }
  });
  
  // Apply mapping to parsed PDF data and create bid line items
  app.post("/api/bid-import/apply-mapping", requireAuth, async (req, res) => {
    try {
      const { bidCollectionId, tableData, mapping } = req.body;
      
      if (!bidCollectionId || !tableData || !mapping) {
        return res.status(400).json({ message: "Missing required fields: bidCollectionId, tableData, mapping" });
      }
      
      const mappingConfig: MappingConfig = {
        description: mapping.description,
        quantity: mapping.quantity,
        unit: mapping.unit,
        unitPrice: mapping.unitPrice,
        totalPrice: mapping.totalPrice
      };
      
      const mappedItems = applyMapping(tableData, mappingConfig);
      
      const createdItems = [];
      for (const item of mappedItems) {
        if (!item.description || item.description.trim() === '') continue;
        
        const lineItem = await storage.createBidLineItem({
          bidCollectionId: parseInt(bidCollectionId),
          category: "Imported",
          description: item.description,
          quantity: item.quantity || "1",
          unit: item.unit || "LS",
          unitPrice: item.unitPrice || "0",
          totalPrice: item.totalPrice || "0",
          notes: "Imported from PDF",
          isCleanData: false
        });
        createdItems.push(lineItem);
      }
      
      res.json({
        success: true,
        itemsCreated: createdItems.length,
        items: createdItems
      });
    } catch (error) {
      console.error("Mapping application error:", error);
      res.status(500).json({ message: "Failed to apply mapping and create line items" });
    }
  });

  // PDF Mapping Templates - Get all templates
  app.get("/api/pdf-mapping-templates", requireAuth, async (req, res) => {
    try {
      const templates = await storage.getPdfMappingTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching PDF mapping templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // PDF Mapping Templates - Get templates by contractor
  app.get("/api/pdf-mapping-templates/contractor/:contractorId", requireAuth, async (req, res) => {
    try {
      const contractorId = parseInt(req.params.contractorId);
      const templates = await storage.getPdfMappingTemplatesByContractor(contractorId);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching contractor templates:", error);
      res.status(500).json({ message: "Failed to fetch contractor templates" });
    }
  });

  // PDF Mapping Templates - Get template by header signature (for auto-matching)
  app.get("/api/pdf-mapping-templates/signature/:signature", requireAuth, async (req, res) => {
    try {
      const signature = decodeURIComponent(req.params.signature);
      const template = await storage.getPdfMappingTemplateBySignature(signature);
      res.json(template || null);
    } catch (error) {
      console.error("Error fetching template by signature:", error);
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  // PDF Mapping Templates - Create new template
  app.post("/api/pdf-mapping-templates", requireAuth, async (req, res) => {
    try {
      const template = await storage.createPdfMappingTemplate(req.body);
      res.json(template);
    } catch (error) {
      console.error("Error creating PDF mapping template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // PDF Mapping Templates - Update template
  app.patch("/api/pdf-mapping-templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updated = await storage.updatePdfMappingTemplate(id, req.body);
      if (!updated) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating PDF mapping template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  // PDF Mapping Templates - Delete template
  app.delete("/api/pdf-mapping-templates/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deletePdfMappingTemplate(id);
      if (!deleted) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting PDF mapping template:", error);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // PDF Mapping Templates - Increment usage count
  app.post("/api/pdf-mapping-templates/:id/use", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.incrementTemplateUsage(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error incrementing template usage:", error);
      res.status(500).json({ message: "Failed to update template usage" });
    }
  });
  

  // Generic upload endpoint for single files
  app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
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
  app.get("/api/rfp-requests/stats", requireAuth, async (req, res) => {
    try {
      const allRequests = await storage.getAllRfpRequests();
      // "active" excludes archived and cancelled — pipeline counts only
      const activeRequests = allRequests.filter(r => r.status !== "archived" && r.status !== "cancelled");
      
      const stats = {
        total: activeRequests.length, // Total of active RFPs only
        received: allRequests.filter(r => r.status === "received").length,
        inProgress: allRequests.filter(r => r.status === "in-progress").length,
        completed: allRequests.filter(r => r.status === "completed").length,
        onHold: allRequests.filter(r => r.status === "on-hold").length,
        archived: allRequests.filter(r => r.status === "archived").length,
        cancelled: allRequests.filter(r => r.status === "cancelled").length,
      };

      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });

  // Helper: resolve selected bay IDs against live property bay configs.
  // Handles split-bay IDs (e.g. "1754328007840_south") that carry a _south/_north suffix
  // not present in the property's stored bayConfigurations. For those, the base bay is found
  // by stripping the suffix, and the split half's SF/name is preserved from the stored snapshot.
  const resolveSelectedBays = (selectedBayIds: string[], liveBayConfigs: any[], snapshotBays: any[]): any[] => {
    return selectedBayIds.map(selectedId => {
      // Exact match (full bays)
      const exactMatch = liveBayConfigs.find((bay: any) => bay.id === selectedId);
      if (exactMatch) return exactMatch;

      // Split-bay match: strip _south / _north suffix
      const suffix = selectedId.endsWith('_south') ? '_south' : selectedId.endsWith('_north') ? '_north' : null;
      if (suffix) {
        const baseId = selectedId.slice(0, selectedId.length - suffix.length);
        const baseBay = liveBayConfigs.find((bay: any) => bay.id === baseId);
        if (baseBay) {
          const snapshotBay = snapshotBays?.find((b: any) => b.id === selectedId);
          const isSouth = suffix === '_south';
          return {
            ...baseBay,
            id: selectedId,
            bayName: snapshotBay?.bayName ?? `${baseBay.bayName} (${suffix.slice(1)})`,
            // Square footage: use stored half-SF from snapshot (already correctly halved)
            rentableSquareFootage: snapshotBay?.rentableSquareFootage ?? baseBay.rentableSquareFootage,
            squareFootage: snapshotBay?.squareFootage ?? baseBay.squareFootage,
            // Door counts: use per-half fields, fall back to full-bay values
            standardDockDoors: isSouth
              ? (baseBay.splitSouthDockDoors ?? baseBay.standardDockDoors)
              : (baseBay.splitNorthDockDoors ?? baseBay.standardDockDoors),
            oversizedDockDoors: isSouth
              ? (baseBay.splitSouthOversizedDoors ?? baseBay.oversizedDockDoors)
              : (baseBay.splitNorthOversizedDoors ?? baseBay.oversizedDockDoors),
            // Boolean amenities: each half independently has/doesn't have these features
            hasStorefrontEntry: isSouth
              ? (baseBay.splitSouthStorefront ?? baseBay.hasStorefrontEntry)
              : (baseBay.splitNorthStorefront ?? baseBay.hasStorefrontEntry),
            hasSpeculativeOffice: isSouth
              ? (baseBay.splitSouthOffice ?? baseBay.hasSpeculativeOffice)
              : (baseBay.splitNorthOffice ?? baseBay.hasSpeculativeOffice),
            hasRestroom: isSouth
              ? (baseBay.splitSouthRestroom ?? baseBay.hasRestroom)
              : (baseBay.splitNorthRestroom ?? baseBay.hasRestroom),
          };
        }
      }

      // Not found in live data — fall back to snapshot entry
      const snapshotFallback = snapshotBays?.find((b: any) => b.id === selectedId);
      return snapshotFallback ?? null;
    }).filter(Boolean);
  };

  // Helper function to hydrate live bay configurations from properties
  const hydrateLiveBayConfigurations = async (rfp: any) => {
    console.log(`🔍 Hydration called for RFP ${rfp.rfpNumber}: propertyId=${rfp.propertyId}, selectedBayIds=${rfp.selectedBayIds}, property=${rfp.property}, bayConfigsLength=${rfp.selectedBayConfigurations?.length}`);
    
    try {
      // Single building RFP with bay IDs (new approach)
      if (rfp.propertyId && rfp.selectedBayIds && rfp.selectedBayIds.length > 0) {
        const property = await storage.getProperty(rfp.propertyId);
        if (property && property.bayConfigurations) {
          const liveBays = resolveSelectedBays(rfp.selectedBayIds, property.bayConfigurations, rfp.selectedBayConfigurations || []);
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
            const snapshotForBuilding = (rfp.selectedBaysPerBuilding?.[propertyName] || rfp.selectedBayConfigurations || []);
            const liveBays = resolveSelectedBays(bayIds, property.bayConfigurations, snapshotForBuilding);
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
  app.get("/api/rfp-requests", requireAuth, async (req, res) => {
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
              rfp.selectedBayConfigurations = resolveSelectedBays(rfp.selectedBayIds!, property.bayConfigurations, rfp.selectedBayConfigurations || []);
            }
          }
          // Multi-building with bay IDs per building
          else if (rfp.bayIdsPerBuilding && Object.keys(rfp.bayIdsPerBuilding).length > 0) {
            const allLiveBays: any[] = [];
            for (const [propertyIdStr, bayIds] of Object.entries(rfp.bayIdsPerBuilding)) {
              const propId = parseInt(propertyIdStr);
              const property = await storage.getProperty(propId);
              if (property?.bayConfigurations) {
                const snapshotForBuilding = rfp.selectedBayConfigurations || [];
                const baysForProperty = resolveSelectedBays(bayIds as string[], property.bayConfigurations, snapshotForBuilding);
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
  app.get("/api/rfp-requests/top-open-by-cost", requireAuth, async (req, res) => {
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
  app.get("/api/rfp-requests/:id", requireAuth, async (req, res) => {
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
          rfp.selectedBayConfigurations = resolveSelectedBays(rfp.selectedBayIds!, property.bayConfigurations, rfp.selectedBayConfigurations || []);
        }
      }
      // Multi-building with bay IDs per building
      else if (rfp.bayIdsPerBuilding && Object.keys(rfp.bayIdsPerBuilding).length > 0) {
        const allLiveBays: any[] = [];
        for (const [propertyIdStr, bayIds] of Object.entries(rfp.bayIdsPerBuilding)) {
          const propId = parseInt(propertyIdStr);
          const property = await storage.getProperty(propId);
          if (property?.bayConfigurations) {
            const snapshotForBuilding = rfp.selectedBayConfigurations || [];
            const baysForProperty = resolveSelectedBays(bayIds as string[], property.bayConfigurations, snapshotForBuilding);
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
  app.post("/api/rfp-requests", upload.array("files"), requireAuth, checkPermission('rfp.create'), async (req, res) => {
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
      
      // Create project folder structure for file organization
      const projectFolder = sanitizeProjectName(newRequest.projectName, newRequest.rfpNumber);
      await createProjectFolderStructure(projectFolder);
      
      // Automatically advance workflow from "rfp-entry" to "rfp-validation" after creation
      // Step 1 (RFP Entry) is now complete, move to Step 2 (RFP Validation)
      // Keep status as "received" (purple) until validation team completes Step 2
      console.log('Auto-advancing RFP workflow from rfp-entry to rfp-validation');
      const advancedRequest = await storage.updateRfpRequest(newRequest.id, {
        workflowPhase: "rfp-validation",
        projectFolder: projectFolder
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
  app.post("/api/rfp-requests/with-files", requireAuth, checkPermission('rfp.create'), upload.array("files"), async (req, res) => {
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
      
      // Files will be processed after RFP creation to get the projectFolder
      const multerFiles = req.files as Express.Multer.File[] || [];

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
        files: [],
        selectedBayConfigurations: selectedBayConfigurations,
        propertyId: propertyId,
        selectedBayIds: selectedBayIds,
        propertyIdsPerBuilding: propertyIdsPerBuilding,
        bayIdsPerBuilding: bayIdsPerBuilding,
        dueDate: parsed.internalDueDate,
      };

      console.log('🔍 RFP Creation Debug:');
      console.log('  - selectedBayConfigurations:', requestWithFiles.selectedBayConfigurations?.length || 0, 'bays');
      console.log('  - propertyId:', requestWithFiles.propertyId);
      console.log('  - selectedBayIds:', requestWithFiles.selectedBayIds?.length || 0, 'IDs');
      console.log('About to create RFP with selectedBayConfigurations:', requestWithFiles.selectedBayConfigurations?.length || 0);

      const newRequest = await storage.createRfpRequest(requestWithFiles);
      
      // Create project folder structure for file organization
      const projectFolder = sanitizeProjectName(newRequest.projectName, newRequest.rfpNumber);
      await createProjectFolderStructure(projectFolder);
      
      // Move uploaded files to project folder (Step 1 Entry)
      const workflowStep = "Step_1_Entry";
      const stepFolderPath = getStepFolderPath(projectFolder, "rfp-entry");
      
      if (!fs.existsSync(stepFolderPath)) {
        fs.mkdirSync(stepFolderPath, { recursive: true });
      }
      
      const uploadedFiles = [];
      for (const file of multerFiles) {
        const sourcePath = path.join(uploadsDir, file.filename);
        const sanitizedFilename = file.originalname.replace(/[<>:"/\\|?*]/g, '_').replace(/\.\./g, '_');
        const destFilename = `${Date.now()}_${sanitizedFilename}`;
        const destPath = path.join(stepFolderPath, destFilename);
        
        if (fs.existsSync(sourcePath)) {
          fs.renameSync(sourcePath, destPath);
        }
        
        const relativePath = getRelativeFilePath(projectFolder, "rfp-entry", destFilename);
        
        // Record in project_files table
        await storage.createProjectFile({
          projectId: newRequest.id,
          filePath: relativePath,
          fileName: destFilename,
          originalName: file.originalname,
          workflowStep: workflowStep,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: (req as any).userId || null,
        });
        
        uploadedFiles.push({
          id: nanoid(),
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          uploadedAt: new Date().toISOString(),
          path: relativePath,
          workflowStep: workflowStep,
        });
      }
      
      // Automatically advance workflow from "rfp-entry" to "rfp-validation" after creation
      console.log('Auto-advancing RFP workflow from rfp-entry to rfp-validation');
      let advancedRequest = await storage.updateRfpRequest(newRequest.id, {
        workflowPhase: "rfp-validation",
        projectFolder: projectFolder
      });
      
      // Add files to the RFP for backward compatibility
      for (const file of uploadedFiles) {
        advancedRequest = await storage.addFileToRfp(newRequest.id, file) || advancedRequest;
      }
      
      // Send Step 1 completion email (RFP Entry complete) with attachments
      try {
        const rfpForEmail = advancedRequest || newRequest;
        await sendWorkflowCompletionEmail(rfpForEmail, 'rfp-entry');
      } catch (emailError) {
        console.error('Failed to send RFP entry completion email:', emailError);
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
  app.patch("/api/rfp-requests/:id", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      let updates;
      try {
        updates = updateRfpRequestSchema.parse({ ...req.body, id });
      } catch (error) {
        console.error('RFP 400 parse error:', error instanceof Error ? error.message : String(error));
        return res.status(400).json({ message: error instanceof Error ? error.message : String(error) });
      }

      // isLeased transition logic: stamp or clear leasedAt automatically
      if ((updates as any).isLeased === true && (updates as any).leasedAt === undefined) {
        (updates as any).leasedAt = new Date();   // false → true: stamp now
      } else if ((updates as any).isLeased === false) {
        (updates as any).leasedAt = null;          // true → false: clear timestamp
      }

      const updatedRequest = await storage.updateRfpRequest(id, updates);
      
      if (!updatedRequest) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Advance workflow phase
  app.post("/api/rfp-requests/:id/advance-phase", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
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


  // Cancel RFP — requires a free-text reason; stamps cancelled_at server-side
  app.patch("/api/rfp-requests/:id/cancel", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) return res.status(404).json({ message: "RFP request not found" });

      if (rfp.status === "cancelled") return res.status(400).json({ message: "RFP is already cancelled" });
      if (rfp.status === "archived") return res.status(400).json({ message: "Archived RFPs cannot be cancelled" });

      const { reason } = req.body;
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ message: "A cancellation reason is required" });
      }

      const updated = await storage.updateRfpRequest(id, {
        status: "cancelled",
        cancellationReason: String(reason).trim(),
        cancelledAt: new Date(),
        priorWorkflowPhase: rfp.workflowPhase,
      } as any);

      res.json(updated);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to cancel RFP" });
    }
  });

  // Reinstate RFP — restores status to in-progress and workflow_phase to prior snapshot
  app.patch("/api/rfp-requests/:id/reinstate", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) return res.status(404).json({ message: "RFP request not found" });

      if (rfp.status !== "cancelled") return res.status(400).json({ message: "Only cancelled RFPs can be reinstated" });

      const restorePhase = (rfp as any).priorWorkflowPhase || rfp.workflowPhase;

      const updated = await storage.updateRfpRequest(id, {
        status: "in-progress",
        workflowPhase: restorePhase,
      } as any);

      res.json(updated);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to reinstate RFP" });
    }
  });

  // Create RFP Option (alternative design/scope for same project)
  app.post("/api/rfp-requests/:id/create-option", requireAuth, async (req, res) => {
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
  app.delete("/api/rfp-requests/:id", requireAuth, async (req, res) => {
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
  app.post("/api/rfp-requests/upload-files", requireAuth, upload.array("files"), async (req, res) => {
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

  // Upload additional files to existing RFP (with project folder organization)
  app.post("/api/rfp-requests/:id/files", upload.array("files"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Get or create project folder
      let projectFolder = rfp.projectFolder;
      if (!projectFolder) {
        projectFolder = sanitizeProjectName(rfp.projectName, rfp.rfpNumber);
        await createProjectFolderStructure(projectFolder);
        await storage.updateRfpProjectFolder(id, projectFolder);
      }

      // Get the workflow step folder based on current phase
      const workflowStep = getWorkflowStepFolder(rfp.workflowPhase);
      const stepFolderPath = getStepFolderPath(projectFolder, rfp.workflowPhase);

      // Ensure the step folder exists
      if (!fs.existsSync(stepFolderPath)) {
        fs.mkdirSync(stepFolderPath, { recursive: true });
      }

      const uploadedFiles = [];
      const multerFiles = req.files as Express.Multer.File[] || [];

      for (const file of multerFiles) {
        // Move file from temp uploads to project step folder
        const sourcePath = path.join(uploadsDir, file.filename);
        const sanitizedFilename = file.originalname.replace(/[<>:"/\\|?*]/g, '_').replace(/\.\./g, '_');
        const destFilename = `${Date.now()}_${sanitizedFilename}`;
        const destPath = path.join(stepFolderPath, destFilename);
        
        if (fs.existsSync(sourcePath)) {
          fs.renameSync(sourcePath, destPath);
        }

        const relativePath = getRelativeFilePath(projectFolder, rfp.workflowPhase, destFilename);

        // Record in project_files table
        await storage.createProjectFile({
          projectId: id,
          filePath: relativePath,
          fileName: destFilename,
          originalName: file.originalname,
          workflowStep: workflowStep,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: (req as any).userId || null,
        });

        // Also add to legacy files array for backward compatibility
        const uploadedFile = {
          id: nanoid(),
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          uploadedAt: new Date().toISOString(),
          path: relativePath,
          workflowStep: workflowStep,
        };
        uploadedFiles.push(uploadedFile);
      }

      let updatedRequest = rfp;
      for (const file of uploadedFiles) {
        updatedRequest = await storage.addFileToRfp(id, file) || updatedRequest;
      }

      res.json(updatedRequest);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: "Failed to upload files" });
    }
  });

  // Download file
  app.get("/api/rfp-requests/:id/files/:fileId", requireAuth, async (req, res) => {
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

      // Use secure path resolver to prevent path traversal
      const filePath = getSecureDownloadPath(file.path || file.name);
      if (!filePath) {
        return res.status(400).json({ message: "Invalid file path" });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.download(filePath, file.name);
    } catch (error) {
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Delete file
  app.delete("/api/rfp-requests/:id/files/:fileId", requireAuth, async (req, res) => {
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

      // Use secure path resolver to prevent path traversal
      const filePath = getSecureDownloadPath(file.path || file.name);
      if (!filePath) {
        return res.status(400).json({ message: "Invalid file path" });
      }

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
  app.post("/api/rfp-requests/:id/files/download-all", requireAuth, async (req, res) => {
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
  app.patch("/api/rfp-requests/:id/update-with-files", requireAuth, upload.array("files"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // DEBUG: Log what we receive
      console.log('🔧 BACKEND DEBUG - update-with-files received:', {
        id,
        hasSelectedBayConfigurations: !!req.body.selectedBayConfigurations,
        selectedBayConfigurationsLength: req.body.selectedBayConfigurations ? 
          (typeof req.body.selectedBayConfigurations === 'string' ? 
            JSON.parse(req.body.selectedBayConfigurations).length : 
            req.body.selectedBayConfigurations.length) : 0,
        selectedBayConfigurationsRaw: req.body.selectedBayConfigurations ? 
          req.body.selectedBayConfigurations.substring(0, 200) + '...' : 'none'
      });

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
      // TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.
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
      // TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.
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
      // TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.
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
      // TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.
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
      // TODO: This catch swallows ReferenceError/TypeError as if they were data errors. Should distinguish code bugs (rethrow) from invalid input (null + warn). See HANDOFF for context.
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
      
      // CRITICAL: Sync selectedBayIds with selectedBayConfigurations to prevent hydration mismatch
      // When bay configurations are saved, extract their IDs to keep the fields in sync
      if (formData.selectedBayConfigurations && Array.isArray(formData.selectedBayConfigurations) && formData.selectedBayConfigurations.length > 0) {
        formData.selectedBayIds = formData.selectedBayConfigurations.map((bay: any) => bay.id);
        console.log('🔧 Synced selectedBayIds with selectedBayConfigurations:', formData.selectedBayIds.length, 'IDs');
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
  app.get("/api/contacts", requireAuth, async (req, res) => {
    try {
      const contacts = await storage.getAllContacts();
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.get("/api/contacts/:id", requireAuth, async (req, res) => {
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

  app.post("/api/contacts", requireAuth, checkPermission('contacts.create'), async (req, res) => {
    try {
      const parsed = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(parsed);
      res.status(201).json(contact);
    } catch (error) {
      res.status(400).json({ message: "Invalid contact data" });
    }
  });

  app.patch("/api/contacts/:id", requireAuth, checkPermission('contacts.edit'), async (req, res) => {
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

  app.delete("/api/contacts/:id", requireAuth, checkPermission('contacts.delete'), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      // Self-delete guard: a contact-authenticated user cannot deactivate their own login,
      // matching the same 403 guard used on DELETE /api/admin/users/:id.
      if (req.user?.id === `contact_${id}`) {
        return res.status(403).json({ message: "You cannot delete your own account" });
      }

      const contact = await storage.getContact(id);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      // Cross-delete guard: a contact with system access (a login-holding contact) is
      // never hard-deleted. Hard-deleting would destroy business contact data (name,
      // email, company, notes, tags) at the same time it revokes their login — the two
      // are stored on the same row, so a straight DELETE could not do one without the
      // other. Instead we soft-delete: flip isActive=false, which revokes login (checked
      // in auth-routes.ts) while preserving the contact record intact. This mirrors the
      // deleteUser soft-delete pattern and satisfies "never destroy business contact
      // data when deactivating a login" (see HANDOFF.md, Part 4 session notes).
      if (contact.hasSystemAccess) {
        const updated = await storage.deactivateContact(id);
        return res.status(200).json({
          deactivated: true,
          contact: updated,
          message: "This contact has a system login; the record was preserved and their account was deactivated instead of deleted.",
        });
      }

      // No system login on this contact — behavior unchanged, hard delete.
      const deleted = await storage.deleteContact(id);
      if (!deleted) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  app.post('/api/contacts/:id/reactivate', requireAuth, checkPermission('contacts.delete'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const contact = await storage.reactivateContact(id);
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      res.status(500).json({ message: "Failed to reactivate contact" });
    }
  });

  // Invitation routes
  app.get("/api/invitations", requireAuth, async (req, res) => {
    try {
      const invitations = await storage.getAllInvitations();
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.get("/api/rfp-requests/:id/invitations", requireAuth, async (req, res) => {
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

  app.post("/api/invitations", requireAuth, async (req, res) => {
    try {
      const parsed = insertInvitationSchema.parse(req.body);
      const invitation = await storage.createInvitation(parsed);
      res.status(201).json(invitation);
    } catch (error) {
      res.status(400).json({ message: "Invalid invitation data" });
    }
  });

  app.patch("/api/invitations/:id", requireAuth, async (req, res) => {
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
  // Was duplicated at ~line 2353 (now removed). Both handlers had divergent logic —
  // merged here to include the canAdvanceToPhase business-rule gate from the dead
  // handler plus the publish-email side effect from the live one.
  // Verify before adding any new handlers for this path.
  app.patch("/api/rfp-requests/:id/workflow-phase", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const { phase } = req.body;
      if (!phase || !["rfp-entry", "rfp-validation", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"].includes(phase)) {
        return res.status(400).json({ message: "Invalid workflow phase" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Step 1: run field-level validation and surface specific errors to the client
      // Pass targetPhase so date fields are only required from bid-collection onward.
      // Merge contractorRfpRequired / architectRfpRequired from invitation_to_bid so the
      // validator can condition each due-date requirement on its RFP type being selected.
      //
      // Also merge contractorDueDate / architectDueDate from invitation_to_bid as a
      // fallback for the 27 historical rows that pre-date syncInvitationDatesToRfp —
      // those rows have dates in invitation_to_bid but NULL in rfp_requests, so without
      // this fallback the validator would block advancement even when a date exists.
      const invitation = await storage.getInvitationToBid(id);
      const rfpWithFlags = invitation
        ? {
            ...rfp,
            contractorRfpRequired: invitation.contractorRfpRequired ?? false,
            architectRfpRequired:  invitation.architectRfpRequired  ?? false,
            // Prefer rfp_requests date (synced source of truth); fall back to
            // invitation_to_bid date for rows that predate the sync function.
            contractorDueDate: rfp.contractorDueDate ?? invitation.contractorDueDate,
            architectDueDate:  rfp.architectDueDate  ?? invitation.architectDueDate,
          }
        : rfp;
      const validationResult = validateRfpForProgression(rfpWithFlags, phase);
      if (!validationResult.isValid) {
        return res.status(400).json({
          message: `Cannot advance: ${validationResult.errors.join(", ")}`,
          errors: validationResult.errors,
        });
      }

      // Step 2: phase-specific gate (fields with actual UI; legacy no-UI fields removed)
      if (!canAdvanceToPhase(rfp, phase)) {
        return res.status(400).json({
          message: "Cannot advance to next phase: phase-specific requirements not met.",
          errors: [],
        });
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

  app.get("/api/projects/phase/:phase", requireAuth, async (req, res) => {
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
  app.post("/api/rfp-requests/:id/advance-workflow", requireAuth, async (req, res) => {
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
  // Shared helper: syncs contractor/architect due dates to rfp_requests BEFORE
  // writing to invitation_to_bid. Both the POST (create) and PATCH (update) handlers
  // call this so the phase-advance validator, which reads rfp_requests, always sees
  // fresh date values regardless of which client path fired. rfp_requests is written
  // first: if the invitation write subsequently fails, the validator still has correct
  // data. Errors propagate — no silent swallowing.
  async function syncInvitationDatesToRfp(
    rfpId: number,
    dates: { contractorDueDate?: string | null; architectDueDate?: string | null }
  ): Promise<void> {
    const rfpDateUpdate: Record<string, unknown> = {};
    if (dates.contractorDueDate !== undefined) rfpDateUpdate.contractorDueDate = dates.contractorDueDate;
    if (dates.architectDueDate !== undefined) rfpDateUpdate.architectDueDate = dates.architectDueDate;
    if (Object.keys(rfpDateUpdate).length > 0) {
      await storage.updateRfpRequest(rfpId, rfpDateUpdate as any);
    }
  }

  app.post("/api/invitation-to-bid", requireAuth, async (req, res) => {
    try {
      console.log('Invitation to bid request body:', JSON.stringify(req.body, null, 2));
      const parsed = insertInvitationToBidSchema.parse(req.body);
      await syncInvitationDatesToRfp(parsed.rfpId, {
        contractorDueDate: parsed.contractorDueDate,
        architectDueDate: parsed.architectDueDate,
      });
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
  app.post("/api/rfp-requests/:id/additional-areas", requireAuth, async (req, res) => {
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

  app.get("/api/rfp-requests/:id/invitation-to-bid", requireAuth, async (req, res) => {
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

  app.patch("/api/rfp-requests/:id/invitation-to-bid", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const parsed = updateInvitationToBidSchema.parse(req.body);
      await syncInvitationDatesToRfp(id, {
        contractorDueDate: parsed.contractorDueDate,
        architectDueDate: parsed.architectDueDate,
      });
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
  app.post("/api/rfp-requests/validate", requireAuth, async (req, res) => {
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

      if (!type || !ALLOWED_RECIPIENT_TYPES.includes(type)) {
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
        recipientType: type as "architect" | "contractor" | "broker-architect" | "broker-contractor" | "contractor-enhanced" | "architect-enhanced",
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

  // Generate RFP Entry Summary Report (HTML view for printing)
  app.get("/api/rfp-requests/:id/summary-report", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const rfp = await storage.getRfpRequest(id);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }

      // Get property details
      const property = await storage.getProperty(parseInt(rfp.property));
      const propertyDisplay = property 
        ? (property.building ? `${property.propertyName} - Bldg. ${property.building}` : property.propertyName)
        : rfp.property;
      const propertyAddress = property 
        ? `${property.streetAddress}, ${property.city}, ${property.state} ${property.zip}`
        : '';

      // Get files
      const files = await storage.getRfpFiles(id);
      
      // Format dates
      const formatDateReport = (date: any) => {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      };

      // Calculate totals from bay configurations
      const bayConfigs = rfp.selectedBayConfigurations || [];
      const bayCount = bayConfigs.length;
      const totalRentableArea = bayConfigs.reduce((sum: number, bay: any) => sum + (bay.rentableSquareFootage || 0), 0);

      // Format request types with proper capitalization
      const formatRequestTypes = (types: any) => {
        if (!types) return 'N/A';
        const typeArray = Array.isArray(types) ? types : [types];
        return typeArray.map((t: string) => {
          // Handle hyphenated words like "space-plan" -> "Space Plan"
          return t.split('-').map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
          ).join(' ');
        }).join(', ');
      };

      const today = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RFP Entry Summary - ${rfp.rfpNumber}</title>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; background: white; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f7fa; margin: 0; padding: 20px;">
  <button class="no-print" onclick="window.print()" style="position: fixed; top: 80px; right: 40px; background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000;">Print Report</button>
  
  <div class="container" style="max-width: 800px; margin: 0 auto; background-color: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">RFP Entry Summary</h1>
      <p style="margin: 8px 0 0 0; opacity: 0.9;">${rfp.rfpNumber} - ${rfp.projectName}</p>
    </div>
    
    <div style="padding: 24px;">
      <!-- Project Information -->
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1e3a5f; margin-bottom: 16px; font-size: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 8px;">Project Information</h2>
        <table style="width: 100%; font-size: 14px;">
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600; width: 35%;">Property</td>
            <td style="padding: 8px 0; color: #1f2937;">${propertyDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Address</td>
            <td style="padding: 8px 0; color: #1f2937;">${propertyAddress || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Tenant Name</td>
            <td style="padding: 8px 0; color: #1f2937;">${rfp.tenantName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Sent By</td>
            <td style="padding: 8px 0; color: #1f2937;">${rfp.sentBy || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Confidential</td>
            <td style="padding: 8px 0; color: #1f2937;">${rfp.confidential ? 'Yes' : 'No'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Request Types</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatRequestTypes(rfp.requestTypes)}</td>
          </tr>
        </table>
      </div>

      <!-- Project Area -->
      <div style="border-left: 4px solid #10b981; padding: 16px; margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px 0; color: #374151; font-size: 14px;">Project Area</h3>
        <p style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600;">
          ${bayCount} Bay${bayCount !== 1 ? 's' : ''} - ${totalRentableArea.toLocaleString()} SF Rentable Area
        </p>
      </div>

      <!-- Key Dates -->
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1e3a5f; margin-bottom: 16px; font-size: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 8px;">Key Dates</h2>
        <table style="width: 100%; font-size: 14px;">
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600; width: 35%;">Received On</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDateReport(rfp.receivedOn)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Internal Due Date</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDateReport(rfp.internalDueDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Response to Broker Due</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDateReport(rfp.responseToBrokerDue)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Anticipated Lease Execution</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDateReport(rfp.anticipatedLeaseExecutionDate)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 16px 8px 0; color: #6b7280; font-weight: 600;">Tenant Desired Occupancy</td>
            <td style="padding: 8px 0; color: #1f2937;">${formatDateReport(rfp.anticipatedOccupancyDate)}</td>
          </tr>
        </table>
      </div>

      ${rfp.notes ? `
      <!-- Development Team Notes -->
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1e3a5f; margin-bottom: 16px; font-size: 16px; border-bottom: 2px solid #f59e0b; padding-bottom: 8px;">Development Team Notes</h2>
        <div style="border-left: 4px solid #f59e0b; padding: 16px;">
          <p style="margin: 0; color: #374151; white-space: pre-wrap; font-size: 14px;">${rfp.notes}</p>
        </div>
      </div>
      ` : ''}

      ${rfp.dealMetricNotes ? `
      <!-- Deal Metric Notes -->
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1e3a5f; margin-bottom: 16px; font-size: 16px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Deal Metric Notes</h2>
        <div style="border-left: 4px solid #3b82f6; padding: 16px;">
          <p style="margin: 0; color: #374151; white-space: pre-wrap; font-size: 14px;">${rfp.dealMetricNotes}</p>
        </div>
      </div>
      ` : ''}

      ${files.length > 0 ? `
      <!-- Attached Files -->
      <div style="margin-bottom: 24px;">
        <h2 style="color: #1e3a5f; margin-bottom: 16px; font-size: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 8px;">Attached Files (${files.length})</h2>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${files.map(f => `<li style="padding: 10px 12px; background: #f9fafb; margin-bottom: 6px; border-radius: 4px; border: 1px solid #e5e7eb; font-size: 14px; color: #374151;">${f.fileName}</li>`).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    
    <div style="background-color: #f9fafb; padding: 16px 24px; border-radius: 0 0 8px 8px; text-align: center; color: #6b7280; font-size: 12px;">
      <p style="margin: 0;">Generated on ${today}</p>
    </div>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error("RFP summary report generation error:", error);
      res.status(500).json({ message: "Failed to generate RFP summary report" });
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

      if (!recipientType || !(ALLOWED_RECIPIENT_TYPES as readonly string[]).includes(recipientType)) {
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

      // Resolve effective recipient type based on rfpVariant stored on the invitation.
      // Client may send "contractor-enhanced"/"architect-enhanced" directly (explicit enhanced request)
      // OR send "contractor"/"architect" and rely on rfpVariant upgrade below.
      // The client always sends "contractor" or "architect"; the server upgrades to
      // "contractor-enhanced" / "architect-enhanced" when the invitation's rfpVariant says so.
      // Broker types are never upgraded — they have their own standalone templates.
      const rfpVariant = parseRfpVariant((invitationToBid as any)?.rfpVariant);
      let effectiveRecipientType = recipientType;
      if (recipientType === 'contractor' && rfpVariant.gc === 'enhanced') {
        effectiveRecipientType = 'contractor-enhanced';
      } else if (recipientType === 'architect' && rfpVariant.architect === 'enhanced') {
        effectiveRecipientType = 'architect-enhanced';
      }

      // Get user email for contact information
      const user = (req as any).user;
      const userEmail = user?.email || user?.username || 'AReutlinger@bridgeindustrial.com';

      const pdfOptions = {
        rfp: rfpWithAddress,
        invitationToBid,
        recipientType: effectiveRecipientType as "architect" | "contractor" | "broker-architect" | "broker-contractor" | "contractor-enhanced" | "architect-enhanced",
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
        
        const isArchitectType = effectiveRecipientType === "architect" || effectiveRecipientType === "broker-architect" || effectiveRecipientType === "architect-enhanced";
        const typeLabel = effectiveRecipientType === "contractor-enhanced" ? "Enhanced GC"
          : effectiveRecipientType === "architect-enhanced" ? "Enhanced Architect"
          : effectiveRecipientType === "broker-contractor" ? "Broker GC"
          : effectiveRecipientType === "broker-architect" ? "Broker Architect"
          : isArchitectType ? "Architect" : "Contractor";
        const historyItem = {
          rfpId: id,
          generationType: isArchitectType ? "architect" : "contractor",
          generatedBy,
          invitationData: invitationToBid || null,
          generatedContent: htmlContent,
          title: `${typeLabel} RFP - ${rfp.projectName} - ${new Date().toLocaleDateString()}`,
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
  
  // Get all bid collections (for data scrubbing and project report generator)
  app.get("/api/bid-collections", requireAuth, async (req, res) => {
    try {
      const bidCollections = await storage.getAllBidCollections();
      res.json(bidCollections);
    } catch (error) {
      console.error("Error fetching all bid collections:", error);
      res.status(500).json({ message: "Failed to fetch bid collections" });
    }
  });

  // Get all bid line items (for data scrubbing view)
  app.get("/api/bid-line-items/all", requireAuth, async (req, res) => {
    try {
      const lineItems = await storage.getAllBidLineItems();
      res.json(lineItems);
    } catch (error) {
      console.error("Error fetching all bid line items:", error);
      res.status(500).json({ message: "Failed to fetch bid line items" });
    }
  });

  // Bulk update isCleanData for line items
  app.patch("/api/bid-line-items/bulk-update-clean-data", requireAuth, async (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({ message: "Updates must be an array" });
      }

      // Validate each update item
      for (const update of updates) {
        if (typeof update.id !== 'number' || typeof update.isCleanData !== 'boolean') {
          return res.status(400).json({ message: "Each update must have a numeric id and boolean isCleanData" });
        }
      }

      const results = await Promise.all(
        updates.map(async (update: { id: number; isCleanData: boolean }) => {
          return storage.updateBidLineItemCleanData(update.id, update.isCleanData);
        })
      );

      res.json({ message: "Updates applied successfully", count: results.length });
    } catch (error) {
      console.error("Error updating bid line items:", error);
      res.status(500).json({ message: "Failed to update bid line items" });
    }
  });

  // Master Categories routes
  app.get("/api/master-categories", requireAuth, async (req, res) => {
    try {
      const categories = await storage.getAllMasterCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error fetching master categories:", error);
      res.status(500).json({ message: "Failed to fetch master categories" });
    }
  });

  app.post("/api/master-categories", requireAuth, async (req, res) => {
    try {
      const { name, description, sortOrder } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }
      const category = await storage.createMasterCategory({ name, description, sortOrder: sortOrder || 0 });
      res.status(201).json(category);
    } catch (error) {
      console.error("Error creating master category:", error);
      res.status(500).json({ message: "Failed to create master category" });
    }
  });

  // Unmapped line items for data scrubbing & mapping
  app.get("/api/bid-line-items/unmapped", requireAuth, async (req, res) => {
    try {
      const lineItems = await storage.getUnmappedBidLineItems();
      res.json(lineItems);
    } catch (error) {
      console.error("Error fetching unmapped line items:", error);
      res.status(500).json({ message: "Failed to fetch unmapped line items" });
    }
  });

  // Update single line item mapping
  app.patch("/api/bid-line-items/:id/mapping", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid line item ID" });
      }
      const { masterCategoryId, isCleanData } = req.body;
      if (masterCategoryId !== null && typeof masterCategoryId !== 'number') {
        return res.status(400).json({ message: "masterCategoryId must be a number or null" });
      }
      if (typeof isCleanData !== 'boolean') {
        return res.status(400).json({ message: "isCleanData must be a boolean" });
      }
      const updated = await storage.updateBidLineItemMapping(id, masterCategoryId, isCleanData);
      if (!updated) {
        return res.status(404).json({ message: "Line item not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating line item mapping:", error);
      res.status(500).json({ message: "Failed to update line item mapping" });
    }
  });

  // Bulk update line item mappings
  app.patch("/api/bid-line-items/bulk-mapping", requireAuth, async (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({ message: "Updates must be an array" });
      }
      for (const update of updates) {
        if (typeof update.id !== 'number') {
          return res.status(400).json({ message: "Each update must have a numeric id" });
        }
        if (update.masterCategoryId !== null && typeof update.masterCategoryId !== 'number') {
          return res.status(400).json({ message: "masterCategoryId must be a number or null" });
        }
        if (typeof update.isCleanData !== 'boolean') {
          return res.status(400).json({ message: "isCleanData must be a boolean" });
        }
      }
      const results = await storage.bulkUpdateBidLineItemMapping(updates);
      res.json({ message: "Bulk update successful", count: results.length, items: results });
    } catch (error) {
      console.error("Error bulk updating line item mappings:", error);
      res.status(500).json({ message: "Failed to bulk update line item mappings" });
    }
  });

  app.get("/api/rfp-requests/:id/bid-collections", requireAuth, async (req, res) => {
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

  app.post("/api/rfp-requests/:id/bid-collections", upload.any(), requireAuth, checkPermission('rfp.edit'), async (req, res) => {
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
            title: alternate.title || alternate.description || "",
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

  app.patch("/api/rfp-requests/:rfpId/bid-collections/:id", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
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

  app.put("/api/rfp-requests/:rfpId/bid-collections/:id", upload.any(), requireAuth, checkPermission('rfp.edit'), async (req, res) => {
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
            title: alternate.title || alternate.description || "",
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
  app.get("/api/bid-collections/:id/line-items", requireAuth, async (req, res) => {
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


  // Evaluation Budget routes
  app.post("/api/rfp-requests/:rfpId/evaluation-budget", requireAuth, checkPermission('rfp.edit'), async (req, res) => {
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

      // Fire-and-forget: enqueue "Other" line items for admin review.
      // masterItemId=null AND customDescription set → user chose "Other".
      // Deduped by normalized description + status='pending'.
      // Never throws — audit failures must not break the save response.
      (async () => {
        try {
          const allItems: any[] = [
            ...((budgetData.tenantImprovements as any[]) || []),
            ...((budgetData.designSoftCosts as any[]) || []),
            ...((budgetData.existingImprovements as any[]) || []),
          ];
          const otherItems = allItems.filter(
            (item: any) =>
              item.masterItemId == null &&
              item.customDescription &&
              item.customDescription.trim()
          );
          for (const item of otherItems) {
            const descNorm = item.customDescription.trim().toLowerCase();
            const existing = await db
              .select({ id: masterItemReviewQueue.id })
              .from(masterItemReviewQueue)
              .where(
                and(
                  drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descNorm}`,
                  eq(masterItemReviewQueue.status, "pending"),
                  eq(masterItemReviewQueue.sourceType, "evaluation_budget")
                )
              )
              .limit(1);
            if (existing.length === 0) {
              await db.insert(masterItemReviewQueue).values({
                sourceType: "evaluation_budget",
                sourceLineItemId: item.id ?? null,
                customDescription: item.customDescription.trim(),
                status: "pending",
              });
            }
          }
        } catch (queueErr) {
          console.error("[review-queue] Failed to enqueue Other entries:", queueErr);
        }
      })();

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
  app.get("/api/rfp-requests/:rfpId/evaluation-budget", requireAuth, async (req, res) => {
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

      // Fetch all live ROM scope items to refresh template data
      const allRomItems = await storage.getAllRomScopeItems();
      const romItemsMap = new Map(allRomItems.map(item => [item.id, item]));

      // Convert template items to evaluation line item format
      const evaluationItems = {
        tenantImprovements: [] as any[],
        designSoftCosts: [] as any[],
        existingImprovements: [] as any[],
      };

      template.items.forEach((item: any, index: number) => {
        // Refresh from live ROM scope item if available, via the shared resolution
        // helper (also used by the Scope-of-Work import endpoint below) so both paths
        // stay in sync instead of re-implementing this logic per-route.
        const liveRomItem = item.romScopeItemId ? romItemsMap.get(item.romScopeItemId) : undefined;
        const resolved = resolveLiveRomItemPricing(liveRomItem, {
          label: item.label,
          unitPrice: item.unit_cost,
          unit: item.snapshot?.unit || item.unit || "ea.",
          category: item.snapshot?.category || "",
          snapshot: item.snapshot,
        });

        const normalizedUnit = normalizeUnit(resolved.unit);

        const lineItem = {
          id: `template-${template.id}-${index}`,
          description: resolved.label,
          quantity: item.qty || 1,
          unit: normalizedUnit,
          unitPrice: resolved.unitPrice ? resolved.unitPrice.toString() : "0",
          totalPrice: resolved.unitPrice && item.qty ? (resolved.unitPrice * item.qty).toString() : "0",
          tenantShare: item.percent || 100,
          notes: item.notes || "",
          // Stamp stable integer link to the master scope items library.
          // item.romScopeItemId is the rom_scope_items.id captured when the template was built.
          masterItemId: item.romScopeItemId ?? null,
          romSnapshot: resolved.snapshot,
        };

        // Categorize based on live category, snapshot category, tags, or type
        const tags = item.tags || [];
        const bucket = categorizeRomLineItem(resolved.category, tags);
        evaluationItems[bucket].push(lineItem);
      });

      res.json(evaluationItems);
    } catch (error) {
      console.error('Template import fetch error:', error);
      res.status(500).json({ message: "Failed to fetch template for import" });
    }
  });

  // Read-only: resolve an RFP's ITB Scope of Work rows into evaluation-line-item-shaped
  // data for the Evaluation Budget's "Import from Scope of Work" button. Never writes
  // back to invitation_to_bid. Rows with a masterItemId are refreshed against the live
  // rom_scope_items catalog (via the same resolution helper used by /for-import above);
  // free-typed rows (no masterItemId) pass through with blank pricing for manual entry.
  app.get("/api/rfp-requests/:rfpId/evaluation-import/scope-of-work", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.rfpId);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const invitation = await storage.getInvitationToBid(rfpId);
      const scopeRows: any[] = Array.isArray(invitation?.scopeOfWork) ? invitation!.scopeOfWork : [];

      const evaluationItems = {
        tenantImprovements: [] as any[],
        designSoftCosts: [] as any[],
        existingImprovements: [] as any[],
      };

      const flaggedUnknownCategory: string[] = [];
      let pricedCount = 0;
      let unpricedCount = 0;

      if (scopeRows.length > 0) {
        const allRomItems = await storage.getAllRomScopeItems();
        const romItemsMap = new Map(allRomItems.map((item) => [item.id, item]));

        scopeRows.forEach((row: any, index: number) => {
          const masterItemId = row?.masterItemId ?? null;
          const liveRomItem = masterItemId ? romItemsMap.get(masterItemId) : undefined;

          if (masterItemId && liveRomItem) {
            const resolved = resolveLiveRomItemPricing(liveRomItem, {
              label: row.description,
              unit: row.unit,
            });
            const normalizedUnit = normalizeUnit(resolved.unit);
            const quantity = row.quantity || 0;
            const unitPrice = resolved.unitPrice || 0;

            const lineItem = {
              id: `scope-import-${rfpId}-${Date.now()}-${index}`,
              description: resolved.label || row.description,
              quantity,
              unit: normalizedUnit,
              unitPrice: unitPrice.toString(),
              totalPrice: (unitPrice * quantity).toString(),
              tenantShare: 100,
              masterItemId,
              romSnapshot: resolved.snapshot,
            };

            if (!isKnownRomCategory(resolved.category)) {
              flaggedUnknownCategory.push(lineItem.description);
            }

            const bucket = categorizeRomLineItem(resolved.category);
            evaluationItems[bucket].push(lineItem);
            pricedCount++;
          } else {
            // Free-typed row (no catalog link) or the linked catalog item was deleted/deactivated
            // since the ITB was saved — import unpriced for manual pricing, same convention as
            // the Bid Collection "Import from Scope of Work" action.
            const lineItem = {
              id: `scope-import-${rfpId}-${Date.now()}-${index}`,
              description: row?.description || "",
              quantity: row?.quantity || 0,
              unit: row?.unit || "",
              unitPrice: "",
              totalPrice: "",
              tenantShare: 100,
              masterItemId: null,
              romSnapshot: undefined,
            };
            evaluationItems.tenantImprovements.push(lineItem);
            unpricedCount++;
          }
        });
      }

      res.json({
        ...evaluationItems,
        hasScopeOfWork: scopeRows.length > 0,
        pricedCount,
        unpricedCount,
        flaggedUnknownCategory,
      });
    } catch (error) {
      console.error("Scope of Work import fetch error:", error);
      res.status(500).json({ message: "Failed to fetch scope of work for import" });
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
  app.post("/api/rfp-requests/:rfpId/financial-summary-pdf", requireAuth, async (req, res) => {
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
  app.get("/api/reports/executive", requireAuth, async (req, res) => {
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
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
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
                  contactName = contactName.replace(/\s*-\s*(Bridge|Kurv)\s*Industrial/i, '').trim();
                  
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
  app.get("/api/reports/custom", requireAuth, async (req, res) => {
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
              <img src="${getBridgeLogo()}" alt="Kurv Industrial" style="height: 30px; width: auto;" />
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



  // Admin routes for user management
  app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post('/api/admin/create-user', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { username, email, firstName, lastName, role, permissions, generatePassword, customPassword } = req.body;
      if (!username || !email || !firstName || !lastName) {
        return res.status(400).json({ message: "username, email, firstName, and lastName are required" });
      }
      const password = generatePassword
        ? nanoid(12).replace(/[^a-zA-Z0-9]/g, 'x').slice(0, 12) + 'A1!'
        : customPassword;
      if (!password) {
        return res.status(400).json({ message: "A password is required" });
      }
      const user = await AuthService.createUser({
        username,
        password,
        email,
        firstName,
        lastName,
        role: role || 'user',
        permissions: permissions || [],
      });
      res.json({ user, password });
    } catch (error: any) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: error.message || "Failed to create user" });
    }
  });

  // Get contacts with system access (for user management)
  app.get('/api/admin/authorized-contacts', requireAuth, async (req, res) => {
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

  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
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

  app.delete('/api/admin/users/:id', requireAuth, checkPermission('admin.access'), async (req: any, res) => {
    try {
      const { id } = req.params;
      if (req.user?.id === id) {
        return res.status(403).json({ message: "You cannot delete your own account" });
      }
      await storage.deleteUser(id);
      res.json({ message: "User deactivated successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Hard-delete a deactivated user permanently (no FK constraints on users.id)
  app.delete('/api/admin/users/:id/hard-delete', requireAuth, checkPermission('admin.access'), async (req: any, res) => {
    try {
      const { id } = req.params;

      if (req.user?.id === id) {
        return res.status(403).json({ message: "You cannot delete your own account" });
      }

      const [userRow] = await db.select().from(users).where(eq(users.id, id));
      if (!userRow) {
        return res.status(404).json({ message: "User not found" });
      }
      if (userRow.isActive !== false) {
        return res.status(400).json({ message: "Only deactivated users can be permanently deleted. Deactivate the account first." });
      }

      await db.delete(users).where(eq(users.id, id));

      logEvent({
        eventType: 'user_hard_deleted',
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        entityType: 'user',
        entityId: id,
        metadata: { deletedUsername: userRow.username, deletedEmail: userRow.email },
      });

      res.json({ message: "User permanently deleted", deletedId: id });
    } catch (error) {
      console.error("Error hard-deleting user:", error);
      res.status(500).json({ message: "Failed to permanently delete user" });
    }
  });

  // Admin sets password for a users-table account (no current password required)
  app.post('/api/admin/users/:id/set-password', requireAuth, checkPermission('admin.access'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const [userRow] = await db.select().from(users).where(eq(users.id, id));
      if (!userRow) {
        return res.status(404).json({ message: "User not found" });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.update(users).set({ passwordHash }).where(eq(users.id, id));

      logEvent({
        eventType: 'admin_set_user_password',
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        entityType: 'user',
        entityId: id,
        metadata: { targetUsername: userRow.username },
      });

      res.json({ message: "Password set successfully" });
    } catch (error) {
      console.error("Error setting user password:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  // Set password for contact (admin only)
  app.post('/api/admin/contacts/:id/set-password', requireAuth, checkPermission('admin.access'), async (req, res) => {
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
  app.post('/api/admin/contacts/:id/generate-password', requireAuth, checkPermission('admin.access'), async (req, res) => {
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
                const contractorFolder = (bid.contractorCompany || 'Unknown-Contractor').replace(/[^a-zA-Z0-9-]/g, '-');
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
      const logoBase64 = fs.readFileSync('./bridge_logo_new_base64.txt', 'utf8').replace(/\s+/g, '');
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

  app.get('/api/reports/vendor-workload/html', requireAuth, async (req, res) => {
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


  // ============================================================================

  // RFP Electrical Capacity Validation - check if capacity is available for RFP
  app.post("/api/rfp-requests/:rfpId/validate-electrical-capacity", requireAuth, async (req, res) => {
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

  // Audit log viewer — admin only
  // GET /api/admin/audit-log/event-types — distinct event types for filter dropdown
  app.get("/api/admin/audit-log/event-types", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const rows = await db
        .selectDistinct({ eventType: auditLog.eventType })
        .from(auditLog)
        .orderBy(auditLog.eventType);
      res.json(rows.map(r => r.eventType));
    } catch (error) {
      console.error('Error fetching audit log event types:', error);
      res.status(500).json({ message: "Failed to fetch event types" });
    }
  });

  // GET /api/admin/audit-log — paginated with optional filters
  app.get("/api/admin/audit-log", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = 50;
      const offset = (page - 1) * limit;

      const eventTypes = req.query.eventTypes
        ? String(req.query.eventTypes).split(',').filter(Boolean)
        : null;
      const userEmailSearch = req.query.userEmail ? String(req.query.userEmail) : null;
      const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
      const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo) + 'T23:59:59Z') : null;

      const conditions = [];
      if (eventTypes && eventTypes.length > 0) {
        conditions.push(inArray(auditLog.eventType, eventTypes));
      }
      if (userEmailSearch) {
        conditions.push(ilike(auditLog.userEmail, `%${userEmailSearch}%`));
      }
      if (dateFrom) {
        conditions.push(gte(auditLog.createdAt, dateFrom));
      }
      if (dateTo) {
        conditions.push(lte(auditLog.createdAt, dateTo));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow] = await db
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(auditLog)
        .where(whereClause);

      const rows = await db
        .select()
        .from(auditLog)
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        entries: rows,
        total: totalRow?.count ?? 0,
        page,
        totalPages: Math.max(1, Math.ceil((totalRow?.count ?? 0) / limit)),
      });
    } catch (error) {
      console.error('Error fetching audit log:', error);
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });

  // Version endpoint
  app.get("/api/version", async (req, res) => {
    try {
      const versionData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'version.json'), 'utf-8'));
      
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
      res.json({ version: "1.0.0", environment: process.env.NODE_ENV || "production" });
    }
  });

  // ============================================================================
  // RFP TEMPLATES API ROUTES
  // ============================================================================

  // List templates with optional search and archived filter
  app.get("/api/templates", requireAuth, async (req, res) => {
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
  app.get("/api/templates/:id", requireAuth, async (req, res) => {
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
  app.post("/api/templates/:id/preview", requireAuth, async (req, res) => {
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

  // Send test status report to a specific email (any authenticated user)
  app.post("/api/admin/email/send-test", requireAuth, async (req, res) => {
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

  // Alternative test email endpoint (outside /api/admin path)
  app.post("/api/email/test", requireAuth, async (req, res) => {
    console.log("Test email endpoint called");
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ message: "Email address is required" });
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Invalid email address format" });
      }
      
      console.log(`Sending test email to: ${email}`);
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

  // ============================================================================
  // PROJECT FILES API ROUTES
  // ============================================================================

  // Get all files for a project
  app.get("/api/rfp-requests/:id/project-files", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const files = await storage.getProjectFiles(id);
      res.json(files);
    } catch (error) {
      console.error("Error fetching project files:", error);
      res.status(500).json({ message: "Failed to fetch project files" });
    }
  });

  // Get files for a specific workflow step
  app.get("/api/rfp-requests/:id/project-files/:step", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const step = req.params.step;
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }
      const files = await storage.getProjectFilesByStep(id, step);
      res.json(files);
    } catch (error) {
      console.error("Error fetching project files by step:", error);
      res.status(500).json({ message: "Failed to fetch project files" });
    }
  });


  // Reports PDF generation
  app.post("/api/reports/detailed-report-pdf", requireAuth, async (req, res) => {
    try {
      const { filters } = req.body;
      const { generateDetailedReportPdf, generateReportFilename } = await import("./detailed-report-pdf");
      
      let rfps = await storage.getAllRfpRequests();
      
      if (filters?.status) {
        rfps = rfps.filter((rfp: any) => rfp.status === filters.status);
      }
      if (filters?.property) {
        rfps = rfps.filter((rfp: any) => rfp.property === filters.property);
      }
      if (filters?.dueInDays) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + filters.dueInDays);
        rfps = rfps.filter((rfp: any) => new Date(rfp.internalDueDate) <= targetDate);
      }

      const reportData = {
        rfps,
        filters,
        generatedAt: new Date().toISOString()
      };

      const pdfBuffer = await generateDetailedReportPdf(reportData);
      const filename = generateReportFilename("detailed-report");
      
      const tempPath = path.join(process.cwd(), 'temp-' + Date.now() + '.pdf');
      fs.writeFileSync(tempPath, pdfBuffer);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(tempPath);
      fileStream.pipe(res);
      fileStream.on('end', () => { fs.unlinkSync(tempPath); });
    } catch (error) {
      console.error("Error generating detailed report PDF:", error);
      res.status(500).json({ message: "Failed to generate detailed report PDF" });
    }
  });

  // Historical Pricing Report route
  app.get("/api/reports/historical", requireAuth, async (req, res) => {
    try {
      const { generateHistoricalPricingPdf } = await import("./historical-pricing-reports");
      const pdfBuffer = await generateHistoricalPricingPdf();
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', 'inline; filename="historical-pricing-report.html"');
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating historical pricing report:", error);
      res.status(500).json({ message: "Failed to generate historical pricing report" });
    }
  });

  // Property Summary Report route
  app.get("/api/reports/property-summary", requireAuth, async (req, res) => {
    try {
      const { generatePropertySummaryReport } = await import("./property-summary-report");
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
  // Upload project files with optional subfolder
  app.post("/api/project-files/upload", requireAuth, upload.array('files', 10), async (req, res) => {
    try {
      const rfpId = parseInt(req.body.rfpId);
      const workflowStepRaw = req.body.workflowStep;
      const subfolder = req.body.subfolder || '';
      
      // Accept workflowStep as either number or string
      let workflowStep: number;
      if (typeof workflowStepRaw === 'string' && workflowStepRaw.startsWith('Step_')) {
        // Handle Step_1_Entry format - extract the number
        const match = workflowStepRaw.match(/Step_(\d+)/);
        workflowStep = match ? parseInt(match[1], 10) : NaN;
      } else {
        workflowStep = parseInt(workflowStepRaw, 10);
      }
      
      if (isNaN(rfpId) || isNaN(workflowStep) || workflowStep < 1 || workflowStep > 6) {
        return res.status(400).json({ message: "Invalid RFP ID or workflow step" });
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP not found" });
      }

      const projectFolder = rfp.projectFolder;
      if (!projectFolder) {
        return res.status(400).json({ message: "RFP does not have a project folder" });
      }

      const stepFolder = getWorkflowStepFolder(workflowStep);
      let targetDir = path.join(process.cwd(), 'uploads', 'projects', projectFolder, stepFolder);
      
      if (subfolder) {
        targetDir = path.join(targetDir, subfolder);
      }

      // Ensure target directory exists
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const uploadedFiles = [];
      for (const file of files) {
        const sanitizedName = sanitizeFilename(file.originalname);
        const targetPath = path.join(targetDir, sanitizedName);
        
        // Move file from temp location to target
        fs.renameSync(file.path, targetPath);
        
        // Compute relative path for storage
        const relativePath = path.join('uploads', 'projects', projectFolder, stepFolder, subfolder || '', sanitizedName);
        
        // Save to database
        const projectFile = await storage.createProjectFile({
          projectId: rfpId,
          filePath: relativePath,
          fileName: sanitizedName,
          originalName: file.originalname,
          workflowStep: String(workflowStep),
          mimeType: file.mimetype,
          fileSize: file.size,
          subfolder: subfolder || null,
        });
        
        uploadedFiles.push(projectFile);
      }

      res.json({
        success: true,
        message: `Uploaded ${uploadedFiles.length} file(s)`,
        files: uploadedFiles
      });
    } catch (error) {
      console.error("Error uploading project files:", error);
      res.status(500).json({ message: "Failed to upload files" });
    }
  });

  // Download a project file
  app.get("/api/project-files/:fileId/download", requireAuth, async (req, res) => {
    try {
      const fileId = parseInt(req.params.fileId);
      if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID" });
      }

      const file = await storage.getProjectFile(fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const fullPath = resolveSecureFilePath(file.filePath, process.cwd());
      if (!fullPath || !fs.existsSync(fullPath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.sendFile(fullPath);
    } catch (error) {
      console.error("Error downloading project file:", error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  // Delete a project file
  app.delete("/api/project-files/:fileId", requireAuth, async (req, res) => {
    try {
      const fileId = parseInt(req.params.fileId);
      if (isNaN(fileId)) {
        return res.status(400).json({ message: "Invalid file ID" });
      }

      const file = await storage.getProjectFile(fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      // Delete from filesystem
      const fullPath = path.join(process.cwd(), file.filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }

      // Delete from database
      await storage.deleteProjectFile(fileId);

      res.json({ success: true, message: "File deleted successfully" });
    } catch (error) {
      console.error("Error deleting project file:", error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // Migration endpoint: Create folder structure for existing RFPs
  app.post("/api/admin/migrate-project-folders", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const allRfps = await storage.getAllRfpRequests();
      const results = {
        processed: 0,
        foldersCreated: 0,
        errors: [] as string[]
      };

      for (const rfp of allRfps) {
        try {
          if (!rfp.projectFolder) {
            const projectFolder = sanitizeProjectName(rfp.projectName, rfp.rfpNumber);
            await createProjectFolderStructure(projectFolder);
            await storage.updateRfpProjectFolder(rfp.id, projectFolder);
            results.foldersCreated++;
          }
          results.processed++;
        } catch (err) {
          results.errors.push(`RFP ${rfp.rfpNumber}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      res.json({
        success: true,
        message: `Migration complete. Processed ${results.processed} RFPs, created ${results.foldersCreated} folder structures.`,
        ...results
      });
    } catch (error) {
      console.error("Error migrating project folders:", error);
      res.status(500).json({ message: "Failed to migrate project folders" });
    }
  });

  // List all files currently stored in Object Storage
  app.get("/api/admin/list-storage-files", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const files = await listObjectStorageFiles();
      res.json({ count: files.length, files });
    } catch (error) {
      console.error("Error listing object storage files:", error);
      res.status(500).json({ message: "Failed to list storage files", error: String(error) });
    }
  });

  // One-time migration: back up all existing uploads/ files to Object Storage
  app.get("/api/admin/migrate-uploads", requireAuth, checkPermission('admin.access'), async (req, res) => {
    try {
      const { runUploadsMigration } = await import('./scripts/migrate-uploads-to-object-storage');
      const result = await runUploadsMigration();
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Error running uploads migration:", error);
      res.status(500).json({ message: "Migration failed", error: String(error) });
    }
  });

  // ============================================================================
  // BID LEVELING API ROUTES
  // ============================================================================

  // Get bucket totals for all bids in an RFP (for comparison view)
  app.get("/api/rfp-requests/:id/bid-leveling", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      // Get all bid collections for this RFP
      const bidCollections = await storage.getBidCollectionsByRfp(rfpId);
      
      // Get bucket totals and adjustments for each bid
      const bidData = await Promise.all(bidCollections.map(async (bid) => {
        const bucketTotals = await storage.getBucketTotalsForBid(bid.id);
        const adjustments = await storage.getBidLevelingAdjustmentsByBidCollection(bid.id);
        
        return {
          bidCollectionId: bid.id,
          contractorName: bid.contractorName,
          contractorCompany: bid.contractorCompany,
          costCategory: bid.costCategory || 'construction',
          buckets: bucketTotals.map(bt => {
            const adjustment = adjustments.find(a => a.costBucket === bt.bucket);
            return {
              bucket: bt.bucket,
              originalTotal: bt.total, // in cents
              adjustmentAmount: adjustment?.adjustmentAmount || 0,
              adjustmentReason: adjustment?.adjustmentReason || null,
              adjustedTotal: bt.total + (adjustment?.adjustmentAmount || 0)
            };
          })
        };
      }));

      res.json(bidData);
    } catch (error) {
      console.error("Error fetching bid leveling data:", error);
      res.status(500).json({ message: "Failed to fetch bid leveling data" });
    }
  });

  // Save adjustment for a bucket
  app.post("/api/bid-leveling/adjustments", requireAuth, async (req, res) => {
    try {
      const { rfpId, bidCollectionId, costBucket, adjustmentAmount, adjustmentReason } = req.body;
      
      if (!rfpId || !bidCollectionId || !costBucket) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const adjustment = await storage.upsertBidLevelingAdjustment({
        rfpId,
        bidCollectionId,
        costBucket,
        adjustmentAmount: adjustmentAmount || 0,
        adjustmentReason: adjustmentReason || null
      });

      res.json(adjustment);
    } catch (error) {
      console.error("Error saving bid leveling adjustment:", error);
      res.status(500).json({ message: "Failed to save adjustment" });
    }
  });

  // Select primary bidder and port to Step 5
  app.post("/api/rfp-requests/:id/select-primary-bidder", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      const { bidCollectionId } = req.body;
      
      if (isNaN(rfpId) || !bidCollectionId) {
        return res.status(400).json({ message: "Invalid RFP ID or bid collection ID" });
      }

      // Get bucket totals and adjustments for the selected bid
      const bucketTotals = await storage.getBucketTotalsForBid(bidCollectionId);
      const adjustments = await storage.getBidLevelingAdjustmentsByBidCollection(bidCollectionId);

      // Delete any existing evaluation carry for this RFP
      await storage.deleteEvaluationBidCarry(rfpId);

      // Create evaluation carry records for each bucket
      const carryRecords = await Promise.all(bucketTotals.map(async (bt) => {
        const adjustment = adjustments.find(a => a.costBucket === bt.bucket);
        const adjustmentAmount = adjustment?.adjustmentAmount || 0;
        const carriedPrice = bt.total + adjustmentAmount;

        return storage.upsertEvaluationBidCarry({
          rfpId,
          selectedBidCollectionId: bidCollectionId,
          costBucket: bt.bucket,
          originalTotal: bt.total,
          adjustmentAmount,
          carriedPrice,
          isOverridden: false
        });
      }));

      res.json({
        success: true,
        message: "Primary bidder selected successfully",
        carryRecords
      });
    } catch (error) {
      console.error("Error selecting primary bidder:", error);
      res.status(500).json({ message: "Failed to select primary bidder" });
    }
  });

  // Get evaluation carry data for Step 5
  app.get("/api/rfp-requests/:id/evaluation-carry", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      if (isNaN(rfpId)) {
        return res.status(400).json({ message: "Invalid RFP ID" });
      }

      const carryData = await storage.getEvaluationBidCarry(rfpId);
      res.json(carryData);
    } catch (error) {
      console.error("Error fetching evaluation carry data:", error);
      res.status(500).json({ message: "Failed to fetch evaluation carry data" });
    }
  });

  // Update carried price (override) in Step 5
  app.patch("/api/evaluation-carry/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { carriedPrice } = req.body;
      
      if (isNaN(id) || carriedPrice === undefined) {
        return res.status(400).json({ message: "Invalid ID or carried price" });
      }

      const updated = await storage.updateCarriedPrice(id, carriedPrice);
      if (!updated) {
        return res.status(404).json({ message: "Evaluation carry record not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating carried price:", error);
      res.status(500).json({ message: "Failed to update carried price" });
    }
  });

  // Update line item cost bucket
  app.patch("/api/bid-line-items/:id/cost-bucket", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { costBucket } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid line item ID" });
      }

      const updated = await storage.updateLineItemCostBucket(id, costBucket || null);
      if (!updated) {
        return res.status(404).json({ message: "Line item not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating line item cost bucket:", error);
      res.status(500).json({ message: "Failed to update cost bucket" });
    }
  });

  // ===========================
  // MASTER SCOPE ITEMS — search endpoint for the typeahead picker.
  // Source: rom_scope_items (Step 5 Evaluation Budget). Step 4 will use a
  // separate master list; this endpoint stays specific to rom_scope_items.
  // Price resolution: active_price if non-empty (pricing intelligence result),
  // else unit_price (direct/base price). Documents the fallback explicitly.
  // ===========================
  app.get("/api/master-scope-items/search", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const limit = Math.min(parseInt(String(req.query.limit ?? "20")) || 20, 50);
      if (!q) return res.json([]);

      const items = await db
        .select({
          id: romScopeItems.id,
          name: romScopeItems.name,
          description: romScopeItems.description,
          csiDivision: romScopeItems.csiDivision,
          csiCode: romScopeItems.csiCode,
          unit: romScopeItems.unit,
          unitPrice: romScopeItems.unitPrice,
          activePrice: romScopeItems.activePrice,
        })
        .from(romScopeItems)
        .where(
          and(
            eq(romScopeItems.isActive, true),
            or(
              ilike(romScopeItems.name, `%${q}%`),
              ilike(romScopeItems.description, `%${q}%`),
              ilike(romScopeItems.csiDivision, `%${q}%`)
            )
          )
        )
        .orderBy(romScopeItems.name)
        .limit(limit);

      const result = items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        csiDivision: item.csiDivision,
        csiCode: item.csiCode,
        unit: item.unit,
        // active_price if populated by pricing intelligence, else fall back to unit_price
        unitPrice:
          item.activePrice && item.activePrice.trim() !== ""
            ? item.activePrice
            : item.unitPrice,
      }));

      res.json(result);
    } catch (error) {
      console.error("Master scope items search error:", error);
      res.status(500).json({ message: "Search failed" });
    }
  });

  // ===========================
  // MASTER ITEM REVIEW QUEUE — admin-only routes.
  // Captures "Other" entries from Evaluation Budget and legacy free-typed
  // items for admin review. Status lifecycle: pending → promoted|rejected|duplicate.
  // No line item backfill on promotion — historical items stay as-is.
  // ===========================

  // GET pending — grouped by normalized description, sorted by count desc
  app.get("/api/admin/scope-item-review/pending", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(masterItemReviewQueue)
        .where(eq(masterItemReviewQueue.status, "pending"))
        .orderBy(masterItemReviewQueue.createdAt);

      const groups: Record<string, any> = {};
      for (const row of rows) {
        const key = row.customDescription.trim().toLowerCase();
        if (!groups[key]) {
          groups[key] = {
            descriptionNormalized: key,
            displayDescription: row.customDescription.trim(),
            count: 0,
            firstSeen: row.createdAt,
            lastSeen: row.createdAt,
            sources: {} as Record<string, number>,
            entries: [] as any[],
          };
        }
        const g = groups[key];
        g.count++;
        if (new Date(row.createdAt) < new Date(g.firstSeen)) g.firstSeen = row.createdAt;
        if (new Date(row.createdAt) > new Date(g.lastSeen)) g.lastSeen = row.createdAt;
        g.sources[row.sourceType] = (g.sources[row.sourceType] || 0) + 1;
        g.entries.push({
          id: row.id,
          sourceType: row.sourceType,
          sourceLineItemId: row.sourceLineItemId,
          createdAt: row.createdAt,
        });
      }
      res.json(Object.values(groups).sort((a: any, b: any) => b.count - a.count));
    } catch (error) {
      console.error("Review queue pending error:", error);
      res.status(500).json({ message: "Failed to fetch pending queue" });
    }
  });

  app.get("/api/admin/scope-item-review/promoted", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(masterItemReviewQueue)
        .where(eq(masterItemReviewQueue.status, "promoted"))
        .orderBy(desc(masterItemReviewQueue.reviewedAt));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch promoted queue" });
    }
  });

  app.get("/api/admin/scope-item-review/rejected", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(masterItemReviewQueue)
        .where(eq(masterItemReviewQueue.status, "rejected"))
        .orderBy(desc(masterItemReviewQueue.reviewedAt));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch rejected queue" });
    }
  });

  app.get("/api/admin/scope-item-review/duplicates", requireAuth, requireAdmin, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(masterItemReviewQueue)
        .where(eq(masterItemReviewQueue.status, "duplicate"))
        .orderBy(desc(masterItemReviewQueue.reviewedAt));
      res.json(rows);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch duplicates queue" });
    }
  });

  // POST promote — create a new rom_scope_items row and move all matching
  // pending queue entries to status='promoted'. No line item backfill.
  app.post("/api/admin/scope-item-review/promote", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { descriptionNormalized, finalDescription, csiDivision, unit, defaultUnitPrice } =
        req.body;
      if (!descriptionNormalized || !finalDescription || !csiDivision || !unit) {
        return res
          .status(400)
          .json({ message: "finalDescription, csiDivision, and unit are required" });
      }

      const [newMasterItem] = await db
        .insert(romScopeItems)
        .values({
          name: finalDescription,
          unit,
          unitPrice: defaultUnitPrice ?? "0",
          category: "Tenant Improvements",
          csiDivision,
          isActive: true,
          includeByDefault: false,
        })
        .returning({ id: romScopeItems.id });

      await db
        .update(masterItemReviewQueue)
        .set({
          status: "promoted",
          promotedMasterItemId: newMasterItem.id,
          reviewedAt: new Date(),
          reviewedBy: (req as any).user?.username ?? "admin",
        })
        .where(
          and(
            drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descriptionNormalized}`,
            eq(masterItemReviewQueue.status, "pending")
          )
        );

      logEvent({
        eventType: 'scope_item_review_promoted',
        userId: (req as any).user?.id ?? null,
        userEmail: (req as any).user?.email ?? null,
        entityType: 'master_scope_item',
        entityId: String(newMasterItem.id),
        metadata: {
          customDescription: finalDescription,
          promotedMasterItemId: newMasterItem.id,
          csiDivision,
          unit,
          unitPrice: defaultUnitPrice ?? null,
        },
      });

      res.json({ masterItemId: newMasterItem.id, message: "Promoted successfully" });
    } catch (error) {
      console.error("Promote error:", error);
      res.status(500).json({ message: "Promote failed" });
    }
  });

  // POST duplicate — mark all matching pending entries as duplicate of an
  // existing master scope item. No line item backfill.
  app.post("/api/admin/scope-item-review/duplicate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { descriptionNormalized, masterItemId } = req.body;
      if (!descriptionNormalized || !masterItemId) {
        return res
          .status(400)
          .json({ message: "descriptionNormalized and masterItemId are required" });
      }
      await db
        .update(masterItemReviewQueue)
        .set({
          status: "duplicate",
          duplicateOfMasterItemId: parseInt(masterItemId),
          reviewedAt: new Date(),
          reviewedBy: (req as any).user?.username ?? "admin",
        })
        .where(
          and(
            drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descriptionNormalized}`,
            eq(masterItemReviewQueue.status, "pending")
          )
        );

      logEvent({
        eventType: 'scope_item_review_duplicated',
        userId: (req as any).user?.id ?? null,
        userEmail: (req as any).user?.email ?? null,
        entityType: 'master_scope_item',
        entityId: String(masterItemId),
        metadata: {
          customDescription: descriptionNormalized,
          duplicateOfMasterItemId: parseInt(masterItemId),
        },
      });

      res.json({ message: "Marked as duplicate" });
    } catch (error) {
      console.error("Duplicate error:", error);
      res.status(500).json({ message: "Action failed" });
    }
  });

  // POST reject — mark all matching pending entries as rejected.
  app.post("/api/admin/scope-item-review/reject", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { descriptionNormalized, notes } = req.body;
      if (!descriptionNormalized) {
        return res.status(400).json({ message: "descriptionNormalized is required" });
      }
      // Fetch queue entry IDs before update so we can reference them in the audit log
      const queueEntries = await db
        .select({ id: masterItemReviewQueue.id, customDescription: masterItemReviewQueue.customDescription })
        .from(masterItemReviewQueue)
        .where(
          and(
            drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descriptionNormalized}`,
            eq(masterItemReviewQueue.status, "pending")
          )
        );

      await db
        .update(masterItemReviewQueue)
        .set({
          status: "rejected",
          notes: notes ?? null,
          reviewedAt: new Date(),
          reviewedBy: (req as any).user?.username ?? "admin",
        })
        .where(
          and(
            drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descriptionNormalized}`,
            eq(masterItemReviewQueue.status, "pending")
          )
        );

      logEvent({
        eventType: 'scope_item_review_rejected',
        userId: (req as any).user?.id ?? null,
        userEmail: (req as any).user?.email ?? null,
        entityType: 'scope_item_review_queue',
        entityId: queueEntries[0]?.id ?? descriptionNormalized,
        metadata: {
          customDescription: queueEntries[0]?.customDescription ?? descriptionNormalized,
          notes: notes ?? null,
        },
      });

      res.json({ message: "Rejected" });
    } catch (error) {
      console.error("Reject error:", error);
      res.status(500).json({ message: "Action failed" });
    }
  });

  // POST import-legacy — one-shot: scans evaluation_budgets JSON for free-typed
  // line items (masterItemId=null, customDescription=null) and enqueues them.
  // Deduplicated by description per sourceType. Run once; idempotent thereafter.
  app.post("/api/admin/scope-item-review/import-legacy", requireAuth, requireAdmin, async (req, res) => {
    try {
      const budgets = await db
        .select({
          tenantImprovements: evaluationBudgets.tenantImprovements,
          designSoftCosts: evaluationBudgets.designSoftCosts,
          existingImprovements: evaluationBudgets.existingImprovements,
        })
        .from(evaluationBudgets);

      let imported = 0;
      let skipped = 0;

      for (const budget of budgets) {
        const allItems = [
          ...((budget.tenantImprovements as any[]) || []),
          ...((budget.designSoftCosts as any[]) || []),
          ...((budget.existingImprovements as any[]) || []),
        ];

        const legacyItems = allItems.filter(
          (item: any) =>
            item.masterItemId == null &&
            (item.customDescription == null || item.customDescription === "") &&
            item.description &&
            item.description.trim()
        );

        for (const item of legacyItems) {
          const descNorm = item.description.trim().toLowerCase();
          const existing = await db
            .select({ id: masterItemReviewQueue.id })
            .from(masterItemReviewQueue)
            .where(
              and(
                drizzleSql`LOWER(TRIM(${masterItemReviewQueue.customDescription})) = ${descNorm}`,
                eq(masterItemReviewQueue.sourceType, "legacy_freetype")
              )
            )
            .limit(1);

          if (existing.length === 0) {
            await db.insert(masterItemReviewQueue).values({
              sourceType: "legacy_freetype",
              sourceLineItemId: item.id ?? null,
              customDescription: item.description.trim(),
              status: "pending",
            });
            imported++;
          } else {
            skipped++;
          }
        }
      }

      res.json({
        imported,
        skipped,
        message: `Imported ${imported} legacy descriptions, skipped ${skipped} already present.`,
      });
    } catch (error) {
      console.error("Legacy import error:", error);
      res.status(500).json({ message: "Import failed" });
    }
  });

  // Project Alternates CRUD
  app.get("/api/rfp-requests/:id/project-alternates", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      const alternates = await db
        .select()
        .from(projectAlternates)
        .where(eq(projectAlternates.projectId, rfpId))
        .orderBy(projectAlternates.displayOrder);
      res.json(alternates);
    } catch (error) {
      console.error("Error fetching project alternates:", error);
      res.status(500).json({ message: "Failed to fetch project alternates" });
    }
  });

  app.post("/api/rfp-requests/:id/project-alternates", requireAuth, async (req, res) => {
    try {
      const rfpId = parseInt(req.params.id);
      const data = insertProjectAlternateSchema.parse({ ...req.body, projectId: rfpId });
      const [created] = await db.insert(projectAlternates).values(data).returning();
      res.json(created);
    } catch (error) {
      console.error("Error creating project alternate:", error);
      res.status(500).json({ message: "Failed to create project alternate" });
    }
  });

  app.patch("/api/project-alternates/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      const { id: _id, projectId: _pid, ...body } = req.body;
      const [updated] = await db
        .update(projectAlternates)
        .set(body)
        .where(eq(projectAlternates.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Alternate not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating project alternate:", error);
      res.status(500).json({ message: "Failed to update project alternate" });
    }
  });

  app.delete("/api/project-alternates/:id", requireAuth, async (req, res) => {
    try {
      const id = req.params.id;
      await db.delete(projectAlternates).where(eq(projectAlternates.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting project alternate:", error);
      res.status(500).json({ message: "Failed to delete project alternate" });
    }
  });

  // ─── Category Cost Breakdown Report ───────────────────────────────────────
  app.get("/api/reports/category-cost-breakdown", requireAuth, async (req, res) => {
    try {
      const { statuses, propertyIds, dateFrom, dateTo, items: itemsRaw, leased } = req.query;

      const selectedItems: Array<{ type: "category" | "scopeItem"; id: number; label: string }> =
        itemsRaw ? JSON.parse(itemsRaw as string) : [];

      const statusList: string[] = statuses
        ? (statuses as string).split(",").filter(Boolean)
        : [];
      const propertyIdList: number[] = propertyIds
        ? (propertyIds as string).split(",").map(Number).filter((n) => !isNaN(n) && n > 0)
        : [];

      // Fetch all RFPs
      let allRfps = await storage.getAllRfpRequests();

      // Status filter
      if (statusList.length > 0) {
        allRfps = allRfps.filter((r) => statusList.includes(r.status));
      }

      // Property filter — integer FK comparison (r.propertyId vs selected IDs)
      // Rows with null propertyId are excluded when a filter is active (safe degradation, not a crash)
      if (propertyIdList.length > 0) {
        const propIdSet = new Set(propertyIdList);
        allRfps = allRfps.filter((r) => r.propertyId != null && propIdSet.has(r.propertyId));
      }

      // Date filter (applied to receivedOn)
      if (dateFrom) {
        const from = new Date(dateFrom as string);
        allRfps = allRfps.filter((r) => new Date(r.receivedOn) >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo as string);
        to.setHours(23, 59, 59, 999);
        allRfps = allRfps.filter((r) => new Date(r.receivedOn) <= to);
      }

      // Leased filter
      if (leased === "true") {
        allRfps = allRfps.filter((r) => r.isLeased === true);
      }

      const categoryItems = selectedItems.filter((i) => i.type === "category");
      const scopeItemsSelected = selectedItems.filter((i) => i.type === "scopeItem");

      const parsePrice = (v: string | null | undefined): number => {
        if (!v) return 0;
        const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
        return isNaN(n) ? 0 : n;
      };

      const projects = await Promise.all(
        allRfps.map(async (rfp) => {
          const itemAmounts: Record<string, number | null> = {};

          // Evaluation budget for grandTotal + scope item amounts
          const budget = await storage.getEvaluationBudget(rfp.id);
          let grandTotal: number | null = null;
          if (budget?.grandTotal) {
            const parsed = parsePrice(budget.grandTotal);
            if (parsed > 0) grandTotal = parsed;
          }

          // Scope item matching — three-pass strategy (BACKLOG 2.3, shipped May 2026):
          //
          // Pass 1 (primary): masterItemId integer — rom_scope_items.id stamped on the
          //   line item at creation time. Immune to description rewording. 282 of 1,172
          //   line items carry this after the May 2026 backfill.
          //
          // Pass 2 (secondary): exact romSnapshot.label match — covers newly-added items
          //   before the picker stamps the ID, and any edge cases where masterItemId is null.
          //
          // Pass 3 (tertiary, CM only): description contains "construction management" /
          //   "cm fee" — covers the entire pre-2026 cohort whose budgets predate the
          //   romSnapshot system. Scope boundary intentional — only CM has reliable fuzzy
          //   description terms. No other item type uses this fallback.
          //
          // Historical CM description variants caught by pass 3:
          //   "3% CM Fee", "CM Fee (3%)", "CM Fee",
          //   "Construction Management Fee (3%)", "Construction Management (2.75%)" (no snapshot)
          //
          // DATA INTEGRITY FLAG: RFP-2026-001, RFP-2026-002, RFP-2026-003 have a CM line
          // whose description says "Construction Management (2.75%)" but whose romSnapshot.label
          // says "Construction Management (3.5%)". These three projects now match via pass 1
          // (masterItemId=29 was stamped during backfill). The displayed dollar amount is
          // correct but the rate in the description disagrees with the snapshot — the source
          // ROM rate should be verified manually for those three projects.
          if (scopeItemsSelected.length > 0) {
            const allLineItems = [
              ...((budget?.tenantImprovements as any[]) || []),
              ...((budget?.designSoftCosts as any[]) || []),
              ...((budget?.existingImprovements as any[]) || []),
            ];
            for (const si of scopeItemsSelected) {
              const key = `s_${si.id}`;
              const normalizedLabel = si.label.trim().toLowerCase();
              const isCmItem = normalizedLabel.includes("construction management");
              const matches = allLineItems.filter((li: any) => {
                // Primary: stable integer ID — immune to description rewording.
                // masterItemId is rom_scope_items.id stamped at line-item creation.
                if (li.masterItemId != null && li.masterItemId === si.id) return true;

                // Secondary: exact romSnapshot.label match (items without masterItemId,
                // or newly-added items before the picker stamps the ID).
                if (
                  typeof li.romSnapshot?.label === "string" &&
                  li.romSnapshot.label.trim().toLowerCase() === normalizedLabel
                ) {
                  return true;
                }
                // Tertiary fallback — CM items only: match by description when romSnapshot
                // is absent (covers the entire pre-2026 cohort whose budgets predate the
                // romSnapshot system). Scope boundary intentional — only CM has reliable
                // fuzzy description terms.
                if (isCmItem) {
                  const desc = (li.description || "").trim().toLowerCase();
                  return desc.includes("construction management") || desc.includes("cm fee");
                }
                return false;
              });
              if (matches.length > 0) {
                const total = matches.reduce(
                  (sum: number, li: any) => sum + parsePrice(li.totalPrice),
                  0
                );
                itemAmounts[key] = total;
              } else {
                itemAmounts[key] = null;
              }
            }
          }

          // Category amounts: sum bid_line_items tagged with that masterCategoryId
          if (categoryItems.length > 0) {
            const bidColls = await storage.getBidCollectionsByRfp(rfp.id);
            if (bidColls.length > 0) {
              const bcIds = bidColls.map((bc) => bc.id);
              const lineItems = await db
                .select()
                .from(bidLineItems)
                .where(inArray(bidLineItems.bidCollectionId, bcIds));

              for (const ci of categoryItems) {
                const key = `c_${ci.id}`;
                const matches = lineItems.filter((li) => li.masterCategoryId === ci.id);
                if (matches.length > 0) {
                  const total = matches.reduce(
                    (sum, li) => sum + parsePrice(li.totalPrice),
                    0
                  );
                  itemAmounts[key] = total;
                } else {
                  itemAmounts[key] = null;
                }
              }
            } else {
              for (const ci of categoryItems) {
                itemAmounts[`c_${ci.id}`] = null;
              }
            }
          }

          // Always extract contingency for base-backout percentage calculations
          // (CM fee % is CM / base where base = Total − CM − Contingency)
          const CONTINGENCY_LABEL = "design & construction contingency (5%)";
          const dscItems = (budget?.designSoftCosts as any[]) || [];
          const contingencyMatches = dscItems.filter(
            (li: any) =>
              typeof li.romSnapshot?.label === "string" &&
              li.romSnapshot.label.trim().toLowerCase() === CONTINGENCY_LABEL
          );
          const contingencyAmount: number | null =
            contingencyMatches.length > 0
              ? contingencyMatches.reduce(
                  (sum: number, li: any) => sum + parsePrice(li.totalPrice),
                  0
                )
              : null;

          // ── Actuals (read-only — leased projects only, source-scoped) ──────────
          // Plain SELECT only — never getOrCreate, never insert
          let actualTotal: number | null = null;
          let deltaAmount: number | null = null;
          let deltaPct: number | null = null;
          let cmRomAmount: number | null = null;
          let romCmPct: number | null = null;
          let cmActual: number | null = null;
          let actualCmPct: number | null = null;

          if (rfp.isLeased) {
            const [paRow] = await db
              .select()
              .from(projectActuals)
              .where(and(eq(projectActuals.rfpId, rfp.id), eq(projectActuals.source, "leased_actuals")));

            let paLineItems: (typeof projectActualLineItems.$inferSelect)[] = [];
            if (paRow) {
              paLineItems = await db
                .select()
                .from(projectActualLineItems)
                .where(eq(projectActualLineItems.projectActualId, paRow.id));
              if (paLineItems.length > 0) {
                actualTotal = paLineItems.reduce((s, li) => s + (li.totalCost ?? 0), 0) / 100;
              }
            }

            if (actualTotal !== null && grandTotal !== null) {
              deltaAmount = actualTotal - grandTotal;
              deltaPct = grandTotal > 0 ? (deltaAmount / grandTotal) * 100 : null;
            }

            // CM ROM extraction — mirrors contingency block; scans DSC + TI sections
            const allBudgetItems = [
              ...((budget?.designSoftCosts as any[]) || []),
              ...((budget?.tenantImprovements as any[]) || []),
            ];
            const cmRomMatches = allBudgetItems.filter((li: any) => {
              const snapshotLabel = typeof li.romSnapshot?.label === "string"
                ? li.romSnapshot.label.trim().toLowerCase() : "";
              const desc = (li.description || "").trim().toLowerCase();
              // Primary: romSnapshot.label contains CM keywords
              if (snapshotLabel.includes("construction management") || snapshotLabel.includes("cm fee")) return true;
              // Fallback for pre-2026 rows without snapshot: match description
              if (!li.romSnapshot?.label && (desc.includes("construction management") || desc.includes("cm fee"))) return true;
              return false;
            });

            cmRomAmount = cmRomMatches.length > 0
              ? cmRomMatches.reduce((s: number, li: any) => s + parsePrice(li.totalPrice), 0)
              : null;

            // romCmPct — same formula as client pctCMBase: CM / (Total − CM − Contingency)
            if (cmRomAmount !== null && grandTotal !== null) {
              const base = grandTotal - cmRomAmount - (contingencyAmount ?? 0);
              romCmPct = base > 0 ? (cmRomAmount / base) * 100 : null;
            }

            // cmActual — primary: linked_master_item_ids; fallback: category label
            if (paLineItems.length > 0) {
              const cmMasterItemIds = new Set<number>(
                cmRomMatches
                  .filter((li: any) => li.masterItemId != null)
                  .map((li: any) => Number(li.masterItemId))
              );

              // Primary: actual lines whose linkedMasterItemIds intersect CM ROM masterItemIds
              let cmActualLines = cmMasterItemIds.size > 0
                ? paLineItems.filter((li) => {
                    const linked = (li.linkedMasterItemIds as number[] | null) || [];
                    return linked.some(mid => cmMasterItemIds.has(mid));
                  })
                : [];

              // Fallback: no masterItemId or no intersection — match by category label
              if (cmActualLines.length === 0) {
                cmActualLines = paLineItems.filter((li) => {
                  const cat = (li.category || "").toLowerCase();
                  return cat.includes("construction management") || cat.includes("cm fee");
                });
              }

              if (cmActualLines.length > 0) {
                cmActual = cmActualLines.reduce((s, li) => s + (li.totalCost ?? 0), 0) / 100;
              }

              if (cmActual !== null && actualTotal !== null) {
                const base = actualTotal - cmActual;
                actualCmPct = base > 0 ? (cmActual / base) * 100 : null;
              }
            }
          }

          return {
            rfpId: rfp.id,
            rfpNumber: rfp.rfpNumber,
            tenantName: rfp.tenantName,
            property: rfp.property,
            status: rfp.status,
            receivedOn: rfp.receivedOn,
            grandTotal,
            itemAmounts,
            contingencyAmount,
            isLeased: rfp.isLeased ?? false,
            leasedAt: rfp.leasedAt ? (rfp.leasedAt as Date).toISOString() : null,
            actualTotal,
            deltaAmount,
            deltaPct,
            cmRomAmount,
            romCmPct,
            cmActual,
            actualCmPct,
          };
        })
      );

      const columns = selectedItems.map((item) => ({
        key: `${item.type === "category" ? "c" : "s"}_${item.id}`,
        label: item.label,
        type: item.type,
      }));

      return res.json({ projects, columns });
    } catch (error) {
      console.error("Error generating category cost breakdown:", error);
      res.status(500).json({ message: "Failed to generate category cost breakdown report" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
