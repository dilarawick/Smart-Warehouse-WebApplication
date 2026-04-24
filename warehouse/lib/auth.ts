import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET || 'smart-warehouse-secret-key-change-in-production';
const secret = new TextEncoder().encode(JWT_SECRET);

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
}

export async function createToken(userId: number, username: string, role: string): Promise<string> {
  return new SignJWT({ userId, username, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
