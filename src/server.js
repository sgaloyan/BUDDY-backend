import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { connectDb, disconnectDb } from './db.js';
import { logger } from './lib/logger.js';

// Composition root: load config, open the DB connection, then start listening.
async function start() {
  const env = await loadEnv();
  await connectDb(env.MONGODB_URI);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('BUDDY API listening', { port: env.PORT, env: env.NODE_ENV });
  });

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Failed to start server', { message: err.message, stack: err.stack });
  process.exit(1);
});
