import { z } from 'zod';
import { resolveSecrets } from './secrets.js';

// Env vars whose values may be sm:// Secret Manager references, resolved at boot.
const SECRET_KEYS = ['MONGODB_URI', 'JWT_SECRET'];

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  // Access-token lifetime. Spec auth.spec.md R-3 pins this at 15 minutes.
  JWT_EXPIRES_IN: z.string().default('15m'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

let cached;

// Loads .env locally, resolves Secret Manager references, then validates everything.
// Fail-fast: a bad or missing var throws here rather than surfacing deep in a request.
export async function loadEnv({ reload = false } = {}) {
  if (cached && !reload) return cached;

  if (process.env.NODE_ENV !== 'production') {
    const { config } = await import('dotenv');
    config();
  }

  const resolved = await resolveSecrets(process.env, SECRET_KEYS);
  const parsed = schema.safeParse(resolved);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
