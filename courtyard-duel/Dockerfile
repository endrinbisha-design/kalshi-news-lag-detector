# ---- build stage: bundles the browser client (Vite) and the server (esbuild)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: only `ws` is needed at runtime (three.js is bundled into the client)
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 TRUST_PROXY=1 HSTS=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/server/index.js"]
