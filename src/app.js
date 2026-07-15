import express from 'express';
import { router } from './routes/index.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';

// Builds the Express app without binding a port, so tests can drive it in-process
// via supertest and server.js remains the only place that opens sockets/DB connections.
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use(router);

  // 404 + centralized error handling must come last.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
