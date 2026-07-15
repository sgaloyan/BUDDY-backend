import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { RefreshToken } from '../models/refresh-token.model.js';
import { loadEnv } from '../config/env.js';
import { HttpError } from '../lib/http-errors.js';

const BCRYPT_ROUNDS = 10;
// Refresh-token lifetime — auth.spec.md R-4: 7 days.
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Generate a URL-safe random string for token parts (tokenId / secret).
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Sign a 15-min access JWT. Payload is { userId, email } per R-3.
async function issueAccessToken(user) {
  const env = await loadEnv();
  return jwt.sign(
    { userId: user._id.toString(), email: user.email },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

// Create and persist a refresh token, returning the plaintext "<tokenId>.<secret>".
// Only bcrypt(secret) is stored (R-4).
async function issueRefreshToken(userId) {
  const tokenId = randomToken(16);
  const secret = randomToken(32);
  const tokenHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
  await RefreshToken.create({
    userId,
    tokenId,
    tokenHash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    revoked: false,
  });
  return `${tokenId}.${secret}`;
}

// POST /auth/signup — create a user only; no tokens (§4.1).
// `email` is expected already normalized (trim + lowercase) by the validation layer.
export async function signup({ email, password }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw new HttpError(409, 'Email already registered');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const user = await User.create({ email, passwordHash, createdAt: new Date() });
    return { id: user._id.toString(), email: user.email };
  } catch (err) {
    // The pre-check above races under concurrency; the unique email index is the
    // authoritative guard. A duplicate that slips past it raises a MongoDB duplicate-key
    // error (code 11000) — translate to 409 per §3.1 / §4.1, never surface as 500.
    if (err?.code === 11000) {
      throw new HttpError(409, 'Email already registered');
    }
    throw err;
  }
}

// POST /auth/login — verify credentials, issue access + refresh tokens (§4.2).
// User-enumeration protection (R-5): unknown email and wrong password yield the
// identical 401 error.
export async function login({ email, password }) {
  const user = await User.findOne({ email });
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const accessToken = await issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user._id);
  return { accessToken, refreshToken };
}

// POST /auth/refresh — exchange a valid refresh token for a new access token (§4.3).
// No rotation: the refresh token itself is unchanged.
export async function refresh({ refreshToken }) {
  const invalid = new HttpError(401, 'Invalid refresh token');

  // Split on the FIRST '.' only.
  const dot = typeof refreshToken === 'string' ? refreshToken.indexOf('.') : -1;
  if (dot <= 0) throw invalid;
  const tokenId = refreshToken.slice(0, dot);
  const secret = refreshToken.slice(dot + 1);
  if (!secret) throw invalid;

  const record = await RefreshToken.findOne({ tokenId });
  if (!record) throw invalid;
  if (record.revoked || record.expiresAt.getTime() <= Date.now()) throw invalid;

  const secretOk = await bcrypt.compare(secret, record.tokenHash);
  if (!secretOk) throw invalid;

  const user = await User.findById(record.userId);
  if (!user) throw invalid;

  const accessToken = await issueAccessToken(user);
  return { accessToken };
}
