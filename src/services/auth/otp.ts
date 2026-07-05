import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { getSupabaseClient } from '../../lib/supabase';
import { ValidationError, RateLimitError, AppError } from '../../lib/errors';
import { sendOtp } from '../sms/provider';
import { AuthResponse, UserRow, ProfileRow, OtpSessionRow } from '../../types';

// In-memory rate limiters
const phoneRateLimits: Map<string, { count: number; windowStart: number }> = new Map();
const ipRateLimits: Map<string, { count: number; windowStart: number }> = new Map();

const PHONE_RATE_LIMIT = 5; // max 5 OTP requests per phone per hour
const IP_RATE_LIMIT = 20; // max 20 OTP requests per IP per hour
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes in ms

/**
 * Validate phone number format.
 * Accepts international format: +<country_code><number>
 */
function validatePhone(phone: string): boolean {
  // International phone format: + followed by 7-15 digits
  const phoneRegex = /^\+[1-9]\d{6,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Generate a random 6-digit OTP code.
 */
function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Check rate limit for a given key.
 */
function checkRateLimit(
  limiterMap: Map<string, { count: number; windowStart: number }>,
  key: string,
  maxRequests: number
): void {
  const now = Date.now();
  const entry = limiterMap.get(key);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    // New window
    limiterMap.set(key, { count: 1, windowStart: now });
    return;
  }

  if (entry.count >= maxRequests) {
    throw new RateLimitError('Too many OTP requests. Please try again later.');
  }

  entry.count++;
}

/**
 * Request an OTP for the given phone number.
 * Validates phone format, checks rate limits, generates OTP, stores it, and sends via SMS.
 */
export async function requestOtp(phone: string, ip: string): Promise<{ message: string }> {
  // Validate phone format
  if (!validatePhone(phone)) {
    throw new ValidationError('Invalid phone number format. Use international format: +<country_code><number>');
  }

  // Check rate limits
  checkRateLimit(phoneRateLimits, phone, PHONE_RATE_LIMIT);
  checkRateLimit(ipRateLimits, ip, IP_RATE_LIMIT);

  // Generate OTP
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS).toISOString();

  // Store OTP session in database
  const supabase = getSupabaseClient();
  const { error: insertError } = await supabase
    .from('otp_sessions')
    .insert({
      phone,
      code,
      expires_at: expiresAt,
      verified: false,
    });

  if (insertError) {
    console.error('Failed to store OTP session:', insertError);
    throw new AppError('Failed to process OTP request', 500, 'OTP_STORE_FAILED');
  }

  // Send OTP via SMS
  const smsResult = await sendOtp(phone, code);
  if (!smsResult.success) {
    console.error('Failed to send OTP SMS:', smsResult.error);
    throw new AppError('Failed to send OTP. Please try again.', 500, 'SMS_SEND_FAILED');
  }

  return { message: 'OTP sent successfully' };
}

/**
 * Verify an OTP code and issue a session token.
 * Validates OTP against stored value + expiry, creates/finds user by phone,
 * issues JWT session token, returns auth response.
 */
export async function verifyOtp(phone: string, code: string): Promise<AuthResponse> {
  if (!validatePhone(phone)) {
    throw new ValidationError('Invalid phone number format');
  }

  if (!code || code.length !== 6) {
    throw new ValidationError('Invalid OTP code format');
  }

  // ─── TEST BYPASS: accept "123456" when BYPASS_OTP=true ─────────────────
  if (config.bypassOtp && code === '123456') {
    console.warn(`[OTP BYPASS] Accepting test code for phone: ${phone}`);
    return await issueTokenForPhone(phone);
  }
  // ─── END BYPASS ────────────────────────────────────────────────────────

  const supabase = getSupabaseClient();

  // Find the most recent unverified OTP session for this phone
  const { data: otpSession, error: fetchError } = await supabase
    .from('otp_sessions')
    .select('*')
    .eq('phone', phone)
    .eq('verified', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !otpSession) {
    throw new ValidationError('No pending OTP found for this phone number');
  }

  const session = otpSession as OtpSessionRow;

  // Check expiry
  if (new Date(session.expires_at) < new Date()) {
    throw new ValidationError('OTP has expired. Please request a new one.');
  }

  // Check code match
  if (session.code !== code) {
    throw new ValidationError('Invalid OTP code');
  }

  // Mark OTP as verified
  await supabase
    .from('otp_sessions')
    .update({ verified: true })
    .eq('id', session.id);

  return await issueTokenForPhone(phone);
}

/**
 * Find or create a user by phone number and issue a JWT session token.
 * Shared by both the normal OTP verify path and the test bypass path.
 */
async function issueTokenForPhone(phone: string): Promise<AuthResponse> {
  const supabase = getSupabaseClient();

  // Find or create user by phone
  let { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  let user: UserRow;

  if (!existingUser) {
    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        phone,
        auth_provider: 'phone',
        role: 'user',
      })
      .select()
      .single();

    if (createError || !newUser) {
      throw new AppError('Failed to create user account', 500, 'USER_CREATE_FAILED');
    }
    user = newUser as UserRow;
  } else {
    user = existingUser as UserRow;
  }

  // Check if user has completed profile setup
  const { data: profile } = await supabase
    .from('profiles')
    .select('setup_complete')
    .eq('user_id', user.id)
    .single();

  const needsSetup = !profile || !(profile as ProfileRow).setup_complete;

  // Issue JWT token
  const tokenOptions: jwt.SignOptions = {
    expiresIn: '7d',
  };
  const token = jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      email: user.email,
      role: user.role,
    },
    config.jwt.secret,
    tokenOptions
  );

  return {
    token,
    user: {
      id: user.id,
      phone: user.phone || undefined,
      email: user.email || undefined,
      role: user.role,
    },
    needsSetup,
  };
}
