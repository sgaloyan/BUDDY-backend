import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../../src/models/user.model.js';
import { RefreshToken } from '../../src/models/refresh-token.model.js';

let mongod;

// Spin up an in-memory MongoDB and point the app's config at it. Env is set BEFORE any
// service call so config/env.js reads these values (JWT_SECRET satisfies the 16-char min).
export async function startTestDb() {
  mongod = await MongoMemoryServer.create();
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-at-least-16-chars-long';
  await mongoose.connect(process.env.MONGODB_URI);
  // Ensure unique indexes (e.g. email) are built before tests run.
  await Promise.all([User.init(), RefreshToken.init()]);
}

export async function stopTestDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export async function clearDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
