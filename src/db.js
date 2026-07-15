import mongoose from 'mongoose';
import { logger } from './lib/logger.js';

// Connects Mongoose using the validated config. Called once from server.js at startup.
export async function connectDb(uri) {
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', { message: err.message });
  });
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB');
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
