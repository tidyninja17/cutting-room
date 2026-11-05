# ---- build: vendor libraries and fonts, assemble the offline app ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts ./scripts
COPY src ./src
ARG BUILD_SHA=dev
RUN BUILD_SHA=$BUILD_SHA node scripts/build.mjs

# ---- runtime: Node only, no npm dependencies ----
FROM node:22-alpine
LABEL org.opencontainers.image.title="Cutting Room" \
      org.opencontainers.image.description="Bespoke trouser drafting, self-hosted and offline" \
      org.opencontainers.image.source="https://github.com/tidyninja17/cutting-room"
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TZ=Europe/London
WORKDIR /app
RUN apk add --no-cache tzdata
COPY server ./server
COPY --from=build /app/dist/public ./public
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
