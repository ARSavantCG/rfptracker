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
// Resolves a token string to a populated user object, or null if invalid.
// Shared by requireAuth (header-only) and requireAuthFlexible (header or query).
async function resolveUserFromToken(token: string | null): Promise<any | null> {
  if (!token) return null;
  const userId = await tokenStore.getUserFromToken(token);
  if (!userId) return null;
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
    return user ? { user, userId } : null;
  } catch (error) {
    console.error("Error resolving user from token:", error);
    throw error;
  }
}

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

  try {
    const resolved = await resolveUserFromToken(token);
    if (!resolved) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.user = resolved.user;
    req.userId = resolved.userId;
    console.log(`Token authenticated user: ${resolved.user.username}`);
    return next();
  } catch (error) {
    return res.status(500).json({ message: "Authentication error" });
  }
}

// Like requireAuth, but also accepts the token via ?token= query param. Needed for
// resources loaded by browser navigation (window.open, <img>, <a href>) where an
// Authorization header can't be attached. NOTE: token appears in the URL (history,
// logs) — acceptable given short-lived tokens; migrate to signed URLs to remove that.
async function requireAuthFlexible(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = headerToken || queryToken;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const resolved = await resolveUserFromToken(token);
    if (!resolved) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.user = resolved.user;
    req.userId = resolved.userId;
    return next();
  } catch (error) {
    return res.status(500).json({ message: "Authentication error" });
  }
}

// requireAdmin — synchronous gate that reads req.user populated by the
// preceding requireAuth middleware. MUST be used after requireAuth in the
// middleware chain; calling it standalone would always return 401.
// No DB call is made here — requireAuth already fetched and validated the
// user object (role + permissions) before this function runs.
function requireAdmin(req: any, res: any, next: any) {
  const user = req.user; // already populated by requireAuth
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  if (user.role !== 'admin' && !(user.permissions && user.permissions.includes('admin.access'))) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}


export { checkPermission, uploadsDir, upload, pdfUpload, setupSession, requireAuth, requireAuthFlexible, requireAdmin };
