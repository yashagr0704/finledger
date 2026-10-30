# LedgerFlow — API server + web app in one image.
# Build:  docker build -t ledgerflow .
# Run:    docker run -p 8787:8787 -e APP_SECRET=... -e DATABASE_URL=postgres://... ledgerflow

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:backend && npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Amazon RDS root certificates, for verified SSL to RDS/Aurora PostgreSQL.
COPY --from=build /app/server/certs ./server/certs
# Uploaded files (and the embedded database when DATABASE_URL is unset) live here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "dist-server/index.mjs"]
