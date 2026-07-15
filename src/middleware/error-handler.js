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

  // Honor a client-error status carried by non-HttpError errors instead of collapsing
  // everything to 500 — e.g. body-parser tags a malformed JSON body with status 400
  // (§6). Only 4xx statuses are echoed (with the error's message); 5xx and status-less
  // errors fall through to a generic 500 so we never leak server internals.
  const status = err.status ?? err.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: { message: err.message || 'Bad request' } });
  }

  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  return res.status(500).json({ error: { message: 'Internal server error' } });
}
