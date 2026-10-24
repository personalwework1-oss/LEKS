# The messenger server. Build from the repository root:
#   docker build -f apps/server/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/protocol packages/protocol
COPY apps/server apps/server
# Only the app's manifest, so the lockfile matches the workspace; its packages are not installed.
COPY apps/mobile/package.json apps/mobile/package.json
RUN pnpm install --frozen-lockfile --filter "@leks/server..."
RUN pnpm --filter @leks/protocol run build && pnpm --filter @leks/server run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/protocol/package.json packages/protocol/package.json
COPY --from=build /repo/packages/protocol/dist packages/protocol/dist
COPY --from=build /repo/apps/server/package.json apps/server/package.json
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/migrations apps/server/migrations
COPY --from=build /repo/apps/server/node_modules apps/server/node_modules
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
