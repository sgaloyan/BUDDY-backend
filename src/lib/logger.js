// Minimal structured logger. Emits JSON lines with a `severity` field, which Cloud
// Logging parses into log levels automatically on Cloud Run.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    severity: level.toUpperCase(),
    message,
    ...(meta ?? {}),
    time: new Date().toISOString(),
  };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'error' || level === 'warn') process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (message, meta) => log('debug', message, meta),
  info: (message, meta) => log('info', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  error: (message, meta) => log('error', message, meta),
};
