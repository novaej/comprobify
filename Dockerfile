# Pinned by digest, not just the `20-slim` tag - a mutable tag can be
# rebuilt upstream at any time with different contents, silently changing
# what ships to production between builds. Update by resolving the current
# digest for the tag (`docker buildx imagetools inspect node:20-slim`) and
# bumping this line deliberately, not automatically.
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

RUN apt-get update && apt-get install -y --no-install-recommends libxml2-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "app.js"]
