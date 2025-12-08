FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile --prod

COPY . .

RUN pnpm build

EXPOSE 3001

CMD ["node", "dist/index.js"]
