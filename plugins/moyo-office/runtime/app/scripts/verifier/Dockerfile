FROM node:22.15.1-bookworm-slim
WORKDIR /opt/check
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
USER node
