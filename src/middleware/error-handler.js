import { HttpError } from '../lib/http-errors.js';
import { logger } from '../lib/logger.js';

// Centralized error handler. Renders known HttpErrors as clean JSON and hides the
// internals of everything else behind a generic 500.
// Express identifies error handlers by their arity (4 params), so `_next` must stay.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: {
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return res.status(500).json({ error: { message: 'Internal server error' } });
}
