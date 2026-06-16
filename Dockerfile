FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends libxml2-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "app.js"]
