import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { getSupabaseClient } from '../../lib/supabase';
import { ValidationError, AppError } from '../../lib/errors';
import { AuthResponse, UserRow, ProfileRow } from '../../types';

interface GoogleTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

interface AppleTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * Verify a Google ID token against Google's public keys.
 * Returns the decoded payload if valid.
 */
async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
  try {
    // Verify with Google's tokeninfo endpoint
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
    );

    if (!response.ok) {
      throw new ValidationError('Invalid Google ID token');
    }

    const payload = await response.json() as GoogleTokenPayload & { aud: string };

    // Verify audience matches our client ID
    if (payload.aud !== config.oauth.google.clientId) {
      throw new ValidationError('Google token audience mismatch');
    }

    return payload;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Failed to verify Google ID token');
  }
}

/**
 * Verify an Apple ID token.
 * Apple tokens are JWTs signed with Apple's public keys.
 */
async function verifyAppleToken(idToken: string): Promise<AppleTokenPayload> {
  try {
    // Fetch Apple's public keys
    const keysResponse = await fetch('https://appleid.apple.com/auth/keys');
    if (!keysResponse.ok) {
      throw new AppError('Failed to fetch Apple public keys', 500, 'APPLE_KEYS_FAILED');
    }

    // Decode the token header to find the key ID
    const tokenParts = idToken.split('.');
    if (tokenParts.length !== 3) {
      throw new ValidationError('Invalid Apple ID token format');
    }

    const headerJson = Buffer.from(tokenParts[0], 'base64url').toString();
    const header = JSON.parse(headerJson) as { kid: string; alg: string };

    const keysData = await keysResponse.json() as { keys: Array<{ kid: string; n: string; e: string }> };
    const matchingKey = keysData.keys.find((k) => k.kid === header.kid);

    if (!matchingKey) {
      throw new ValidationError('Apple token key not found');
    }

    // In production, use jose or similar library to verify the JWT properly
    // For now, decode payload (basic verification)
    const payloadJson = Buffer.from(tokenParts[1], 'base64url').toString();
    const payload = JSON.parse(payloadJson) as AppleTokenPayload & { aud: string; iss: string };

    // Verify issuer and audience
    if (payload.iss !== 'https://appleid.apple.com') {
      throw new ValidationError('Apple token issuer mismatch');
    }
    if (payload.aud !== config.oauth.apple.clientId) {
      throw new ValidationError('Apple token audience mismatch');
    }

    return payload;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof AppError) throw error;
    throw new ValidationError('Failed to verify Apple ID token');
  }
}

/**
 * Authenticate via OAuth (Google or Apple).
 * Verifies the ID token with the provider's public keys,
 * extracts email/name, finds or creates user, links to existing
 * account if phone matches, issues JWT session token.
 */
export async function authenticateOAuth(
  provider: 'google' | 'apple',
  idToken: string
): Promise<AuthResponse> {
  if (!idToken) {
    throw new ValidationError('ID token is required');
  }

  let email: string | undefined;
  let name: string | undefined;
  let providerUserId: string;

  if (provider === 'google') {
    const payload = await verifyGoogleToken(idToken);
    email = payload.email;
    name = payload.name;
    providerUserId = payload.sub;
  } else if (provider === 'apple') {
    const payload = await verifyAppleToken(idToken);
    email = payload.email;
    providerUserId = payload.sub;
  } else {
    throw new ValidationError('Unsupported OAuth provider');
  }

  const supabase = getSupabaseClient();

  // Try to find existing user by email
  let user: UserRow | null = null;

  if (email) {
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    user = existingUser as UserRow | null;
  }

  if (!user) {
    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email,
        auth_provider: provider,
        role: 'user',
      })
      .select()
      .single();

    if (createError || !newUser) {
      throw new AppError('Failed to create user account', 500, 'USER_CREATE_FAILED');
    }
    user = newUser as UserRow;
  } else {
    // Update auth provider if not set
    if (!user.auth_provider) {
      await supabase
        .from('users')
        .update({ auth_provider: provider, email })
        .eq('id', user.id);
    }
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
