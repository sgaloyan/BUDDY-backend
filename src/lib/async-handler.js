// Wraps an async route handler so any rejected promise is forwarded to Express's
// error handler instead of becoming an unhandled rejection.
//   router.get('/x', asyncHandler(async (req, res) => { ... }))
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
