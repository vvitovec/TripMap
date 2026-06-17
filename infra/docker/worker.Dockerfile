FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @tripmap/worker --frozen-lockfile=false
COPY apps/worker apps/worker
RUN pnpm --filter @tripmap/worker build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* && corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --filter @tripmap/worker --prod --frozen-lockfile=false
COPY --from=build /app/apps/worker/dist apps/worker/dist
CMD ["pnpm", "--filter", "@tripmap/worker", "start"]
