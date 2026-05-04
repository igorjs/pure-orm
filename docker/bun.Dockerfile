# Bun: run smoke tests against pre-built dist/
# Avoids native module compilation issues (better-sqlite3) by using
# the same lightweight approach as the Deno containers.
ARG VARIANT=debian
FROM oven/bun:${VARIANT}

WORKDIR /app

# Install only the peer dependency needed by dist/
RUN echo '{"dependencies":{"@igorjs/pure-fx":"0.1.0"}}' > package.json \
    && bun install

COPY dist/ ./dist/
COPY tests/runtime-smoke.mjs ./tests/

ENTRYPOINT ["bun", "tests/runtime-smoke.mjs"]
