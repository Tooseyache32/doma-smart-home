FROM node:22.22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app
ENV NODE_ENV=production PORT=3001 DB_PATH=/app/data/doma.sqlite
USER node
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["npm", "start"]
