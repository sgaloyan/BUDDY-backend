import mongoose from 'mongoose';

// Stateful, revocable refresh token. Per auth.spec.md §3.2 the token string is
// "<tokenId>.<secret>": tokenId is a public, indexed lookup handle, and only the bcrypt
// hash of the secret is stored (never the plaintext token or secret).
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenId: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true },
    // TTL index (§3.2): MongoDB reaps documents once past expiresAt, so expired refresh
    // tokens don't accumulate. Reaping is best-effort; /auth/refresh still checks expiry.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revoked: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, versionKey: false },
);

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
