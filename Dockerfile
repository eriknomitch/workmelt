# Workmelt — multiplayer build.
# One image builds the client and runs the relay+host on a single port.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Only what the server needs at runtime: the built client, the server, and ws.
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8787
ENV PORT=8787
CMD ["node", "server/index.mjs"]
