# RevenueTwin API + web console. Runs the TypeScript service via tsx (no build step needed).
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production deps only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App sources.
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts

# Run as non-root.
RUN useradd --user-group --create-home --shell /usr/sbin/nologin app && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \\
  CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1

CMD ["npm", "start"]
