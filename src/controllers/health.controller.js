// Liveness probe for Cloud Run. Intentionally cheap and dependency-free so it stays
// green even when downstream services (e.g. MongoDB) are degraded.
export function healthCheck(_req, res) {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
}
