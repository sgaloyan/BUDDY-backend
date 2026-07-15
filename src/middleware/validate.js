import { HttpError } from '../lib/http-errors.js';

// Validates a request section against a zod schema and replaces it with the parsed
// result, so controllers always receive clean, well-typed input.
//   router.post('/x', validate(schema), controller)
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new HttpError(400, 'Validation failed', details));
    }
    req[source] = result.data;
    next();
  };
}
