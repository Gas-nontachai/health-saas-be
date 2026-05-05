FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl fonts-noto-core fonts-thai-tlwg \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY prisma ./prisma
COPY assets ./assets
COPY scripts ./scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npx prisma generate
RUN SKIP_PRISMA_MIGRATE=1 npm run build
RUN npm prune --omit=dev

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/assets ./assets
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/server.js"]
