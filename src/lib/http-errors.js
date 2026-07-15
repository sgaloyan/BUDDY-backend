// Application error carrying an HTTP status (and optional structured details).
// The centralized error handler renders these directly to the client.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}
