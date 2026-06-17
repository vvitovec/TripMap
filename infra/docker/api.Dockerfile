FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @tripmap/api --frozen-lockfile=false
COPY apps/api apps/api
RUN pnpm --filter @tripmap/api build

FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @tripmap/api --prod --frozen-lockfile=false
COPY --from=build /app/apps/api/dist apps/api/dist
CMD ["pnpm", "--filter", "@tripmap/api", "start"]
