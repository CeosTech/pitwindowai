FROM node:20-slim AS base
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

ENV NODE_ENV=production
# Cloud Run provides PORT; default fallback
ENV PORT=8080

# Expose the HTTP port
EXPOSE 8080

CMD ["node", "server.js"]
