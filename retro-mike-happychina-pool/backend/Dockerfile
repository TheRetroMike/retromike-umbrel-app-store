FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN CXXFLAGS="-std=c++17" npm install --production

COPY src/ ./src/

RUN mkdir -p /app/data

EXPOSE 8080
EXPOSE 3333-3344

CMD ["node", "src/index.js"]

LABEL org.opencontainers.image.source=https://github.com/bobparkerbob888-tech/happychina-pool-umbrel
