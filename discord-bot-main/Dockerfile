FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production \
    DASHBOARD_PORT=3000 \
    DATA_DIR=/data
EXPOSE 3000
CMD ["node", "src/index.js"]
