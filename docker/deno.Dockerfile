# Deno: run smoke tests against pre-built dist/
#
# Uses a deps stage to install the peer dependency (requires shell),
# then copies node_modules into the final image. This supports both
# regular and distroless Deno images.
ARG VARIANT=debian
FROM denoland/deno:debian AS deps

WORKDIR /app
RUN echo '{"dependencies":{"@igorjs/pure-fx":"0.1.0"}}' > package.json \
    && deno install --node-modules-dir

FROM denoland/deno:${VARIANT}

WORKDIR /app

COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY dist/ ./dist/
COPY tests/runtime-smoke.mjs ./tests/

ENTRYPOINT ["deno", "run", "--allow-all", "--node-modules-dir", "tests/runtime-smoke.mjs"]
