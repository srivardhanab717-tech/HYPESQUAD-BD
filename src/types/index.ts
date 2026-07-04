import { Request } from 'express';

// Extend Express Request to include authenticated user
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export interface JwtPayload {
  sub: string; // user id
  phone?: string;
  email?: string;
  role: 'user' | 'moderator' | 'admin';
  iat?: number;
  exp?: number;
}

// Auth
export interface OtpRequestBody {
  phone: string;
}

export interface OtpVerifyBody {
  phone: string;
  code: string;
}

export interface OAuthBody {
  idToken: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    phone?: string;
    email?: string;
    role: string;
  };
  needsSetup: boolean;
}

// Database row types
export interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  auth_provider: string | null;
  role: string;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  name: string;
  avatar_color: string | null;
  interests: string[] | null;
  default_visibility: 'public' | 'squad' | null;
  bio: string | null;
  handle: string | null;
  timezone: string;
  setup_complete: boolean;
  updated_at: string;
}

export interface GoalRow {
  id: string;
  owner_id: string;
  category: string | null;
  description: string | null;
  deadline: string | null;
  cadence: 'daily' | 'weekly' | 'custom' | null;
  target_checkins: number | null;
  visibility: 'public' | 'squad' | null;
  status: 'active' | 'complete' | 'expired';
  created_at: string;
}

export interface OtpSessionRow {
  id: string;
  phone: string;
  code: string;
  expires_at: string;
  verified: boolean;
  created_at: string;
}

// Error response shape
export interface ErrorResponse {
  error: string;
  code: string;
  statusCode: number;
}
