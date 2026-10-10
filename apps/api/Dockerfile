FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/index.js"]
