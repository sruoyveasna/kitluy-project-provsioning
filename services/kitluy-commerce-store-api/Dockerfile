# Container definition (SCAFFOLDED — not yet built in CI; see repo evidence register).
# Immutable tags + digests are required for production (infra spec §19.1).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@kitluy-services/kitluy-commerce-store-api..." \
 && pnpm --filter "@kitluy-services/kitluy-commerce-store-api..." build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=base /repo /app
USER node
CMD ["node", "services/kitluy-commerce-store-api/dist/main.js"]
