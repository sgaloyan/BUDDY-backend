import mongoose from 'mongoose';

// User account. Per auth.spec.md §3.1: email is unique and stored already-normalized
// (trim + lowercase, done in the service/validation layer). Only the bcrypt hash of the
// password is stored — never the plaintext.
const userSchema = new mongoose.Schema(
  {
    // `unique` builds the authoritative unique index (§3.1) — the real guard against
    // duplicate emails under concurrency, not the service's pre-insert existence check.
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { versionKey: false },
);

export const User = mongoose.model('User', userSchema);
