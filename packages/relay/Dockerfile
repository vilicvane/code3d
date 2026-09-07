FROM node:24-bookworm-slim AS build
WORKDIR /build

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/relay/package.json ./packages/relay/package.json
RUN npm ci --ignore-scripts --workspace @code3d/agent --workspace @code3d/relay --include-workspace-root

COPY packages/agent/src ./packages/agent/src
COPY packages/agent/tsconfig.json ./packages/agent/tsconfig.json
COPY packages/relay/src ./packages/relay/src
COPY packages/relay/tsconfig.json ./packages/relay/tsconfig.json
RUN node node_modules/typescript/bin/tsc --build packages/agent packages/relay \
    && npm prune --omit=dev --ignore-scripts --workspace @code3d/agent --workspace @code3d/relay --include-workspace-root

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3134
WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/packages/agent/package.json ./packages/agent/package.json
COPY --from=build /build/packages/agent/bld ./packages/agent/bld
COPY --from=build /build/packages/relay/package.json ./packages/relay/package.json
COPY --from=build /build/packages/relay/bld ./packages/relay/bld
COPY LICENSE ./LICENSE
USER node
EXPOSE 3134
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3134/health', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "packages/relay/bld/main.js"]
