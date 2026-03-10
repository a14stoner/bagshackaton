FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --filter @bags/api... --no-frozen-lockfile

COPY apps/api apps/api
COPY packages/shared packages/shared
COPY packages/ui packages/ui

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["pnpm", "dev"]
