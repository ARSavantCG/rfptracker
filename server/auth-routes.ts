/**
 * RFP Tracker - Authentication Routes
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 */
import type { Express } from 'express';
import { tokenStore } from './token-auth';
import { storage } from './storage';
import { AuthService } from './auth';
import { db } from './db';
import { contacts, users } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { requireAuth, upload } from './middleware';
import { logEvent } from './audit-log';

export function registerAuthRoutes(app: Express): void {
  // Authentication routes - supports both admin users and contact emails
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // First try admin user login
      const authResult = await AuthService.authenticateUser({ username, password });
      if (authResult.user) {
        const token = await tokenStore.generateToken(authResult.user.id);
        logEvent({
          eventType: 'login_success',
          userId: authResult.user.id,
          userEmail: authResult.user.email ?? null,
          entityType: 'user',
          entityId: authResult.user.id,
          metadata: { authMethod: 'admin' },
        });
        return res.json({
          user: authResult.user,
          token,
          message: "Login successful"
        });
      }

      // Unexpected internal error during admin auth (DB down, etc.) — log and reject.
      // Without this branch the 'error' reason would silently fall through to the
      // contact-lookup path, producing misleading behaviour under infrastructure failures.
      if (authResult.reason === 'error') {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: username,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'auth_error', authMethod: 'admin' },
        });
        return res.status(500).json({ message: "Login failed" });
      }

      // If an admin user was found but the password was wrong, reject immediately.
      // Previously this fell through to the contact path — a bug where a wrong
      // admin password silently ran contact-lookup logic and produced confusing results.
      if (authResult.reason === 'bad_password') {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: username,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'bad_password', authMethod: 'admin' },
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // No admin user matched this username — fall through to contact login
      const [contact] = await db.select().from(contacts).where(eq(sql`LOWER(${contacts.email})`, username.toLowerCase()));

      if (!contact) {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: username,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'no_user', authMethod: 'contact' },
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }

      if (!contact.hasSystemAccess) {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: contact.email,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'no_access', authMethod: 'contact' },
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }

      if (!contact.passwordHash) {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: contact.email,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'no_password_set', authMethod: 'contact' },
        });
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const isValidPassword = await bcrypt.compare(password, contact.passwordHash);
      if (!isValidPassword) {
        logEvent({
          eventType: 'login_failure',
          userId: null,
          userEmail: contact.email,
          entityType: 'user',
          entityId: null,
          metadata: { reason: 'bad_password', authMethod: 'contact' },
        });
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
      logEvent({
        eventType: 'login_success',
        userId: `contact_${contact.id}`,
        userEmail: contact.email,
        entityType: 'user',
        entityId: `contact_${contact.id}`,
        metadata: { authMethod: 'contact' },
      });

      res.json({
        user: userObj,
        token,
        message: "Login successful"
      });
    } catch (error) {
      console.error("Login error:", error);
      // Belt-and-suspenders: instrument unexpected exceptions so that an
      // uncaught throw in the login handler is never a silent failure.
      // logEvent swallows its own errors internally, so this call is safe
      // even inside a catch block (no double-fault risk).
      logEvent({
        eventType: 'login_failure',
        userId: null,
        userEmail: req.body?.username ?? null,
        entityType: 'user',
        entityId: null,
        metadata: { reason: 'exception', authMethod: 'unknown' },
      });
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
}
