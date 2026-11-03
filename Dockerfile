# Single-container deployment: Vite-built UI + Express API.
FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm install --no-audit --no-fund
COPY apps/web apps/web
COPY apps/api apps/api
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web/dist UPLOAD_DIR=/app/uploads
WORKDIR /app/api
COPY apps/api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/web/dist /app/web/dist
RUN mkdir -p /app/uploads
EXPOSE 8080
CMD ["node", "dist/index.js"]
