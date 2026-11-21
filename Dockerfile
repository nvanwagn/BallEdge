FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
# Data (database + uploads) goes in DATA_DIR, or the Railway volume, or /app/data.
# Mount persistent storage there; no VOLUME line because Railway rejects it.
EXPOSE 3000
# Run node directly so it receives SIGTERM and can close the database cleanly.
CMD ["node", "--no-warnings", "server.js"]
