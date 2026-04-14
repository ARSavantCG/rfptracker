/**
 * RFP Tracker - Shared Middleware and Configuration
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */
import type { Express } from 'express';
import { tokenStore } from './token-auth';
import { storage } from './storage';
import { AuthService } from './auth';
import { db } from './db';
import { contacts, users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { backupToObjectStorage } from './storage-backup';

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
// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Custom storage engine: saves to disk then asynchronously backs up to Object Storage
class DiskWithBackupStorage implements multer.StorageEngine {
  _handleFile(req: any, file: Express.Multer.File, cb: (error?: any, info?: Partial<Express.Multer.File>) => void) {
    const filename = `${nanoid()}-${file.originalname}`;
    const dest = path.join(uploadsDir, filename);
    const outStream = fs.createWriteStream(dest);
    file.stream.pipe(outStream);
    outStream.on('error', cb);
    outStream.on('finish', () => {
      cb(null, { destination: uploadsDir, filename, path: dest, size: outStream.bytesWritten });
      // Fire-and-forget backup — does not block the upload response
      backupToObjectStorage(dest, filename).catch(err =>
        console.error('[OS Backup] Failed to back up file:', filename, err)
      );
    });
  }
  _removeFile(req: any, file: Express.Multer.File, cb: (error: Error | null) => void) {
    fs.unlink(file.path, cb);
  }
}

const upload = multer({
  storage: new DiskWithBackupStorage(),
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

// Memory-based multer for PDF parsing (needs buffer access)
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are supported"));
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


export { checkPermission, uploadsDir, upload, pdfUpload, setupSession, requireAuth, requireAdmin };
