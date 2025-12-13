FROM node:24-alpine

RUN apk add --no-cache ffmpeg

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

EXPOSE 3003

CMD ["node", "dist/index.js"]
