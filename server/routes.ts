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
  updateInvitationToBidSchema
} from "@shared/schema";
import { validateRfpForProgression, canAdvanceToPhase } from "./validation";
import { generateRfpPdf, generatePdfFilename } from "./pdf-generator";
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
  app.post("/api/rfp-requests", upload.array("files"), async (req, res) => {
    try {
      console.log('Raw req.body:', req.body);
      console.log('Uploaded files:', req.files);
      
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

      console.log('Parsed form data:', formData);

      const parsed = insertRfpRequestSchema.parse(formData);
      
      // Handle uploaded files
      const uploadedFiles = (req.files as Express.Multer.File[] || []).map(file => ({
        id: nanoid(),
        name: file.originalname,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: file.filename, // Store the disk filename for later retrieval
      }));

      const requestWithFiles = {
        ...parsed,
        files: uploadedFiles,
      };

      const newRequest = await storage.createRfpRequest(requestWithFiles);
      res.status(201).json(newRequest);
    } catch (error) {
      console.error('RFP creation error:', error);
      console.error('Error details:', error);
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
      res.status(500).json({ message: "Failed to delete RFP request" });
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
      if (!phase || !["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award"].includes(phase)) {
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
      if (!["rfp-entry", "invitation-to-bid", "bid-collection", "evaluation", "award"].includes(phase)) {
        return res.status(400).json({ message: "Invalid workflow phase" });
      }

      const projects = await storage.getProjectsByPhase(phase);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch projects by phase" });
    }
  });

  // Invitation to Bid routes
  app.post("/api/invitation-to-bid", async (req, res) => {
    try {
      const parsed = insertInvitationToBidSchema.parse(req.body);
      const invitation = await storage.createInvitationToBid(parsed);
      res.status(201).json(invitation);
    } catch (error) {
      res.status(400).json({ message: "Invalid invitation to bid data" });
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
      res.status(400).json({ message: "Failed to update invitation to bid" });
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

  const httpServer = createServer(app);
  return httpServer;
}
