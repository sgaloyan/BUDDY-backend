import { HttpError } from '../lib/http-errors.js';

// Converts any unmatched route into a 404 that flows through the error handler.
export function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}
