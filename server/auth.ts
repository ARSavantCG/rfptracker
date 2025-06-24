/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import bcrypt from 'bcryptjs';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'manager' | 'user';
  permissions?: string[];
}

export class AuthService {
  private static readonly SALT_ROUNDS = 12;

  static async authenticateUser(credentials: LoginCredentials) {
    try {
      const { username, password } = credentials;
      
      // Find user by username
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!user) {
        return null;
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
      if (!isPasswordValid) {
        return null;
      }

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }

  static async createUser(userData: CreateUserData) {
    try {
      console.log('AuthService.createUser called with:', { ...userData, password: '[REDACTED]' });
      
      const { password, ...userInfo } = userData;
      
      // Hash password
      console.log('Hashing password...');
      const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);
      console.log('Password hashed successfully');
      
      // Create user record
      const userRecord = {
        id: nanoid(),
        username: userData.username,
        passwordHash,
        email: userData.email || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        role: userData.role || 'user',
        permissions: userData.permissions || [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      console.log('Inserting user record:', { ...userRecord, passwordHash: '[REDACTED]' });
      
      const [newUser] = await db
        .insert(users)
        .values(userRecord)
        .returning();

      console.log('User created successfully:', { ...newUser, passwordHash: '[REDACTED]' });

      // Return user without password hash
      const { passwordHash: _, ...userWithoutPassword } = newUser;
      return userWithoutPassword;
    } catch (error) {
      console.error('Create user error details:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  static async getUserById(id: string) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        return null;
      }

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      console.error('Get user by ID error:', error);
      return null;
    }
  }

  static async updateUser(id: string, updates: Partial<CreateUserData>) {
    try {
      const updateData: any = { ...updates };
      
      // Hash new password if provided
      if (updates.password) {
        updateData.passwordHash = await bcrypt.hash(updates.password, this.SALT_ROUNDS);
        delete updateData.password;
      }

      updateData.updatedAt = new Date();

      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, id))
        .returning();

      if (!updatedUser) {
        return null;
      }

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = updatedUser;
      return userWithoutPassword;
    } catch (error) {
      console.error('Update user error:', error);
      throw error;
    }
  }

  static async deleteUser(id: string) {
    try {
      const [deletedUser] = await db
        .delete(users)
        .where(eq(users.id, id))
        .returning();

      return !!deletedUser;
    } catch (error) {
      console.error('Delete user error:', error);
      return false;
    }
  }

  static async getAllUsers() {
    try {
      const allUsers = await db.select().from(users);
      
      // Return users without password hashes
      return allUsers.map(({ passwordHash, ...user }) => user);
    } catch (error) {
      console.error('Get all users error:', error);
      return [];
    }
  }
}