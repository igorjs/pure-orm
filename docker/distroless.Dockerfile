# Distroless: verify library works in minimal production environment.
# No shell, no package manager, no build tools. Just Node + the built library.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

RUN (command -v corepack >/dev/null 2>&1 || npm install -g --force corepack) && corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Create a flat node_modules for the distroless stage (pnpm uses symlinks
# that COPY cannot follow across stages).
RUN mkdir -p /deps && cd /deps \
    && echo '{"dependencies":{"@igorjs/pure-fx":"0.1.0"}}' > package.json \
    && npm install --no-package-lock

FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /deps/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/tests/runtime-smoke.mjs ./tests/

ENTRYPOINT ["/nodejs/bin/node", "tests/runtime-smoke.mjs"]
