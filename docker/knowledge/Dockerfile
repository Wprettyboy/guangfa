FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production \
    KNOWLEDGE_API_HOST=0.0.0.0 \
    KNOWLEDGE_API_PORT=8787

EXPOSE 8787

CMD ["node", "server/knowledge-service.js"]
