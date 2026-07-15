# syntax=docker/dockerfile:1

# --- deps stage: install production deps (compiles native modules like bcrypt) ---
FROM node:22-slim AS deps
WORKDIR /app
# Build toolchain required to compile bcrypt's native addon.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage: slim image with only what the app needs to run ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Cloud Run injects PORT (defaults to 8080); the app reads it from the environment.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
