FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/shared ./dist/shared
COPY --from=build /app/dist/relay ./dist/relay
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
ENV RELAY_PORT=8787 RELAY_HOST=0.0.0.0 RELAY_DATA_FILE=/data/relay.sqlite
EXPOSE 8787
CMD ["node","dist/relay/index.js"]
