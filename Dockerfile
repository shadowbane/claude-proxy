# ── Build stage ──────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json tsconfig.web.json ./
COPY vite.config.ts tailwind.config.ts postcss.config.js ./
COPY src/ src/

RUN npm run build

# ── Runtime stage ────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist dist/

RUN mkdir -p /app/data/logs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
