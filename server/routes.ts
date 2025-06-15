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
  updatePropertySchema
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

      // Ensure date fields remain as strings for schema validation
      if (formData.receivedOn instanceof Date) {
        formData.receivedOn = formData.receivedOn.toISOString().split('T')[0];
      }
      if (formData.dueOn instanceof Date) {
        formData.dueOn = formData.dueOn.toISOString().split('T')[0];
      }

      const parsed = insertRfpRequestSchema.parse(formData);
      
      // Handle uploaded files
      const uploadedFiles = (req.files as Express.Multer.File[] || []).map(file => ({
        id: nanoid(),
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: file.filename,
      }));

      const requestWithFiles = {
        ...parsed,
        files: uploadedFiles,
        dueDate: parsed.internalDueDate, // Map internalDueDate to dueDate for validation
      };

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

      // Ensure date fields remain as strings for schema validation
      if (formData.receivedOn instanceof Date) {
        formData.receivedOn = formData.receivedOn.toISOString().split('T')[0];
      }
      if (formData.dueOn instanceof Date) {
        formData.dueOn = formData.dueOn.toISOString().split('T')[0];
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

      const parsed = updateContactSchema.parse(req.body);
      const contact = await storage.updateContact(id, parsed);
      
      if (!contact) {
        return res.status(404).json({ message: "Contact not found" });
      }

      res.json(contact);
    } catch (error) {
      res.status(400).json({ message: "Invalid contact data" });
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
      
      // For now, just acknowledge the save - in a full implementation, 
      // you would save this to the evaluation_budgets table
      res.status(201).json({ 
        message: "Evaluation budget saved successfully",
        rfpId,
        data: budgetData
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to save evaluation budget" });
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

      // Generate PDF using existing PDF generator
      const { generateRfpPdf } = await import("./pdf-generator");
      
      const pdfBuffer = await generateRfpPdf({
        rfp: {
          ...rfp,
          bidCollections,
          allLineItems
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
  app.post("/api/reports/detailed", async (req, res) => {
    try {
      const { filters, rfps } = req.body;
      console.log("Generating executive summary with", rfps?.length || 0, "RFPs");
      
      // If no RFPs provided in request, fetch all RFPs from storage
      let rfpData = rfps;
      if (!rfpData || rfpData.length === 0) {
        rfpData = await storage.getAllRfpRequests();
        console.log("Fetched", rfpData.length, "RFPs from storage");
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
            .status-badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; color: white; }
            .status-received { background: #8B5CF6; }
            .status-in-progress { background: #F59E0B; }
            .status-completed { background: #10B981; }
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
                <th>Due Date</th>
                <th>Status</th>
                <th>Days Until Due</th>
              </tr>
            </thead>
            <tbody>
              ${(rfpData || []).map((rfp: any) => {
                const dueDate = new Date(rfp.internalDueDate);
                const daysUntil = Math.ceil((dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                const statusClass = `status-${(rfp.status || '').replace('-', '')}`;
                
                let dayDisplay;
                if (rfp.status === 'completed') {
                  dayDisplay = '-';
                } else if (daysUntil < 0) {
                  dayDisplay = Math.abs(daysUntil) + ' days overdue';
                } else {
                  dayDisplay = daysUntil + ' days';
                }
                
                // Handle status display - ensure we have a status or show as blank
                const statusText = rfp.status ? rfp.status.replace('-', ' ').toUpperCase() : '';
                const statusDisplay = statusText ? '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' : '';
                
                return '<tr>' +
                  '<td><strong>' + (rfp.rfpNumber || 'N/A') + '</strong></td>' +
                  '<td>' + (rfp.projectName || 'N/A') + '</td>' +
                  '<td>' + dueDate.toLocaleDateString() + '</td>' +
                  '<td>' + statusDisplay + '</td>' +
                  '<td>' + dayDisplay + '</td>' +
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
  app.post("/api/reports/historical-pricing", async (req, res) => {
    try {
      const pdfBuffer = await generateHistoricalPricingPdf();
      const filename = generateHistoricalPricingFilename();
      
      // Check if it's HTML (fallback) or actual PDF
      const content = pdfBuffer.toString('utf8', 0, 50);
      if (content.includes('<!DOCTYPE html>')) {
        // Return HTML for browser-based PDF generation
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `inline; filename="${filename.replace('.pdf', '.html')}"`);
        res.send(pdfBuffer);
      } else {
        // Return actual PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
      }
    } catch (error) {
      console.error("Error generating historical pricing PDF:", error);
      res.status(500).json({ message: "Failed to generate historical pricing PDF" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
