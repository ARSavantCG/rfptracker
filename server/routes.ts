import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
import { generateRfpPdf, generatePdfFilename } from "./pdf-generator";
import { generateDetailedReportPdf, generateReportFilename } from "./pdf-reports";
import { generateHistoricalPricingPdf, generateHistoricalPricingFilename } from "./historical-pricing-reports";
import multer from "multer";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";

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
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Test route for debugging preview issues
  app.get("/test", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <h1>Server is working!</h1>
        <p>Time: ${new Date().toISOString()}</p>
        <a href="/">Go to main app</a>
      </body>
      </html>
    `);
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
  app.post("/api/rfp-requests/with-files", upload.array("files"), async (req, res) => {
    try {
      console.log('Creating RFP with files - body:', req.body);
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

      // Map rfpRequest to sentBy (the field name changed)
      if (formData.rfpRequest && !formData.sentBy) {
        formData.sentBy = formData.rfpRequest;
      }

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
  app.delete("/api/rfp-requests/:id", async (req, res) => {
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

      res.status(204).send();
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
      if (!phase || !["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"].includes(phase)) {
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
      if (!["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"].includes(phase)) {
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
      if (!newPhase || !["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award", "publish"].includes(newPhase)) {
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
      
      // Get the existing RFP
      const rfp = await storage.getRfpRequest(rfpId);
      if (!rfp) {
        return res.status(404).json({ message: "RFP request not found" });
      }
      
      // Combine RFP data with validation data
      const combinedData = { ...rfp, ...validationData };
      const validationResult = validateRfpForProgression(combinedData);
      
      res.json(validationResult);
    } catch (error) {
      res.status(500).json({ message: "Failed to validate RFP" });
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

      if (returnType === "pdf") {
        // Generate actual PDF for download
        const pdfBuffer = await generateRfpPdf(pdfOptions);
        const filename = generatePdfFilename(rfp, recipientType);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
      } else {
        // Return HTML for preview/printing (existing behavior)
        const htmlContent = await generateRfpPdf(pdfOptions);
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
      }
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

  app.post("/api/rfp-requests/:id/bid-collections", upload.array("attachments"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const bidData = JSON.parse(req.body.bidData || '{}');
      const lineItems = JSON.parse(req.body.lineItems || '[]');
      
      // Convert date string back to Date object
      if (bidData.submissionDate) {
        bidData.submissionDate = new Date(bidData.submissionDate);
      }
      
      // Handle file attachments
      const attachments = (req.files as Express.Multer.File[] || []).map(file => ({
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
      console.error('Property update error:', error);
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
            th:nth-child(3), th:nth-child(4), th:nth-child(5), th:nth-child(6), th:nth-child(7) { text-align: center; }
            td:nth-child(3), td:nth-child(4), td:nth-child(5), td:nth-child(6), td:nth-child(7) { text-align: center; }
            th:nth-child(3) { width: 100px; }
            td:nth-child(3) { width: 100px; }
            th:nth-child(4), th:nth-child(5), th:nth-child(6) { width: 120px; }
            td:nth-child(4), td:nth-child(5), td:nth-child(6) { width: 120px; }
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
                if (rfp.status === 'completed' || workflowPhase === 'award') {
                  phaseDisplay = 'Completed';
                  phaseClass = 'status-completed';
                } else {
                  switch (workflowPhase) {
                    case 'rfp-entry':
                      phaseDisplay = 'RFP Entry';
                      phaseClass = 'status-received';
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
                
                return '<tr>' +
                  '<td><strong>' + (rfp.rfpNumber || 'N/A') + '</strong></td>' +
                  '<td>' + (rfp.projectName || 'N/A').replace(/ - $/, '') + '</td>' +
                  '<td>' + rentableSF + '</td>' +
                  '<td>' + receivedDate.toLocaleDateString() + '</td>' +
                  '<td>' + dueDateDisplay + '</td>' +
                  '<td>' + dayDisplay + '</td>' +
                  '<td>' + statusDisplay + '</td>' +
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
      const scopeItem = await storage.createRomScopeItem(req.body);
      res.status(201).json(scopeItem);
    } catch (error) {
      res.status(400).json({ message: "Invalid scope item data" });
    }
  });

  app.put("/api/rom-scope-items/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID" });
      }

      const scopeItem = await storage.updateRomScopeItem(id, req.body);
      if (!scopeItem) {
        return res.status(404).json({ message: "Scope item not found" });
      }

      res.json(scopeItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to update scope item" });
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

  app.post("/api/rom-pilots/:id/line-items", async (req, res) => {
    try {
      const romPilotId = parseInt(req.params.id);
      if (isNaN(romPilotId)) {
        return res.status(400).json({ message: "Invalid ROM Pilot ID" });
      }

      const { lineItems } = req.body;
      console.log("Saving ROM line items:", { romPilotId, lineItems });
      
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
  function generateRomReportHtml(romPilot: any, lineItems: any[], scopeItems: any[]): string {
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
    let totalSquareFootage = 0;
    if (romPilot.selectedBayConfigurations && Array.isArray(romPilot.selectedBayConfigurations)) {
      totalSquareFootage = romPilot.selectedBayConfigurations.reduce((sum: number, bay: any) => {
        return sum + (bay.squareFootage || 0);
      }, 0);
    }
    
    const renderCategorySection = (title: string, items: any[], categoryTotal: number, bgColor: string) => {
      if (items.length === 0) return '';
      
      const categoryPerSF = totalSquareFootage > 0 ? categoryTotal / totalSquareFootage : 0;
      
      return `
        <div style="margin-bottom: 30px;">
          <div style="background: ${bgColor}; padding: 15px; margin-bottom: 10px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #1f2937;">${title}</h2>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: bold; color: #065f46;">${formatCurrency(categoryTotal)}</div>
              <div style="font-size: 14px; color: #6b7280; margin-top: 2px;">${formatCurrency(categoryPerSF)} / sf</div>
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
            </div>
            <div class="header-right">
              <p><strong>Rentable Area:</strong> ${totalSquareFootage > 0 ? new Intl.NumberFormat('en-US').format(totalSquareFootage) + ' sf' : 'N/A'}</p>
            </div>
          </div>
        </div>

        ${renderCategorySection("Tenant Improvements", tenantImprovements, tenantImprovementsTotal, "#f0fdf4")}
        ${renderCategorySection("Design / Soft Costs / Other Fees", designSoftCosts, designSoftCostsTotal, "#fef3f2")}

        <div class="grand-total">
          <div style="display: flex; justify-content: center; align-items: center; gap: 20px;">
            <span>Grand Total: ${formatCurrency(grandTotal)}</span>
            <span style="font-size: 18px; color: #6b7280;">(${formatCurrency(totalSquareFootage > 0 ? grandTotal / totalSquareFootage : 0)} / sf)</span>
          </div>
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
  app.get("/api/rom-pilots/:id/report", async (req, res) => {
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
      
      // Generate HTML report
      const html = generateRomReportHtml(romPilot, lineItems, scopeItems);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      console.error("ROM report generation error:", error);
      res.status(500).json({ message: "Failed to generate ROM report" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
