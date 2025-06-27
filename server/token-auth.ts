/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { nanoid } from 'nanoid';
import { db } from './db';
import { sql } from 'drizzle-orm';

// Database-backed token store for persistence across restarts
class TokenStore {
  async generateToken(userId: string): Promise<string> {
    const token = nanoid(32);
    const createdAt = new Date();
    
    // Store token in database
    await db.execute(sql`
      INSERT INTO auth_tokens (token, user_id, created_at, expires_at)
      VALUES (${token}, ${userId}, ${createdAt}, ${new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)})
    `);
    
    // Clean up expired tokens
    await this.cleanup();
    
    return token;
  }

  async getUserFromToken(token: string): Promise<string | null> {
    try {
      const result = await db.execute(sql`
        SELECT user_id, expires_at 
        FROM auth_tokens 
        WHERE token = ${token} AND expires_at > NOW()
      `);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0].user_id as string;
    } catch (error) {
      console.error('Token validation error:', error);
      return null;
    }
  }

  async removeToken(token: string): Promise<boolean> {
    try {
      const result = await db.execute(sql`
        DELETE FROM auth_tokens WHERE token = ${token}
      `);
      return (result.rowCount || 0) > 0;
    } catch (error) {
      console.error('Token removal error:', error);
      return false;
    }
  }

  private async cleanup() {
    try {
      await db.execute(sql`
        DELETE FROM auth_tokens WHERE expires_at < NOW()
      `);
    } catch (error) {
      console.error('Token cleanup error:', error);
    }
  }
}

export const tokenStore = new TokenStore();