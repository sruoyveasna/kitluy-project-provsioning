# Container definition (SCAFFOLDED — not yet built in CI; see repo evidence register).
# Immutable tags + digests are required for production (infra spec §19.1).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@kitluy-services/kitluy-api-gateway..." \
 && pnpm --filter "@kitluy-services/kitluy-api-gateway..." build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=base /repo /app
USER node
CMD ["node", "services/kitluy-api-gateway/dist/main.js"]
