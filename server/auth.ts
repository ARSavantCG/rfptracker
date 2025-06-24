import bcrypt from 'bcryptjs';
import { users, type User } from '@shared/schema';
import { db } from './db';
import { eq } from 'drizzle-orm';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface CreateUserData {
  username: string;
  email?: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  permissions?: string[];
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  static async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  static async authenticateUser(credentials: LoginCredentials): Promise<User | null> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, credentials.username))
        .limit(1);

      if (!user || !user.isActive) {
        return null;
      }

      const isPasswordValid = await this.verifyPassword(credentials.password, user.passwordHash);
      if (!isPasswordValid) {
        return null;
      }

      // Return user without password hash
      const { passwordHash, ...userWithoutPassword } = user;
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }

  static async createUser(userData: CreateUserData): Promise<User> {
    const passwordHash = await this.hashPassword(userData.password);
    
    const [newUser] = await db
      .insert(users)
      .values({
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        username: userData.username,
        email: userData.email || null,
        passwordHash,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        role: userData.role || 'user',
        permissions: userData.permissions || [],
        isActive: true,
      })
      .returning();

    // Return user without password hash
    const { passwordHash: _, ...userWithoutPassword } = newUser;
    return userWithoutPassword as User;
  }

  static async getUserById(id: string): Promise<User | null> {
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
      return userWithoutPassword as User;
    } catch (error) {
      console.error('Get user error:', error);
      return null;
    }
  }
}