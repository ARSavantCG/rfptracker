/**
 * RFP Tracker - Request for Proposals Management System
 * Copyright (c) 2025 Savant Consulting Group LLC. All rights reserved.
 * 
 * This software is proprietary and confidential. Unauthorized copying, 
 * distribution, or use of this software is strictly prohibited.
 */

import { nanoid } from 'nanoid';

// Simple in-memory token store for development
class TokenStore {
  private tokens = new Map<string, { userId: string, createdAt: Date }>();

  generateToken(userId: string): string {
    const token = nanoid(32);
    this.tokens.set(token, { userId, createdAt: new Date() });
    
    // Clean up old tokens (older than 24 hours)
    this.cleanup();
    
    return token;
  }

  getUserFromToken(token: string): string | null {
    const tokenData = this.tokens.get(token);
    if (!tokenData) return null;

    // Check if token is expired (24 hours)
    const now = new Date();
    const diff = now.getTime() - tokenData.createdAt.getTime();
    if (diff > 24 * 60 * 60 * 1000) {
      this.tokens.delete(token);
      return null;
    }

    return tokenData.userId;
  }

  removeToken(token: string): boolean {
    return this.tokens.delete(token);
  }

  private cleanup() {
    const now = new Date();
    for (const [token, data] of this.tokens.entries()) {
      const diff = now.getTime() - data.createdAt.getTime();
      if (diff > 24 * 60 * 60 * 1000) {
        this.tokens.delete(token);
      }
    }
  }
}

export const tokenStore = new TokenStore();