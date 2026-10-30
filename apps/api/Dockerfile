# Build from the repo root:  docker build -f apps/api/Dockerfile -t lumen-api .
# No native modules: SQLite comes from node:sqlite (Node >= 22.13).

FROM node:22-alpine AS base
RUN npm i -g pnpm@10.18.0 && pnpm config set store-dir /pnpm/store
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter api
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
RUN pnpm --filter api build

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
WORKDIR /app/apps/api
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "dist/index.js"]
