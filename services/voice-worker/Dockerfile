FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
