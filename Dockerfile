ARG NODE_VERSION=22.23.4
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

FROM base AS media-tools
RUN apk add --no-cache bash build-base python3 meson ninja pkgconf nasm linux-headers curl tar xz
COPY ops/build-media.sh ops/media-sources.json ./ops/
COPY docs/MEDIA-NOTICES.md ./docs/MEDIA-NOTICES.md
ARG MEDIA_JOBS=2
RUN JOBS=${MEDIA_JOBS} bash ops/build-media.sh --prefix /media-work --out /media-build --cache /media-cache

FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
COPY src ./src
COPY types ./types
COPY public ./public
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY next.config.ts tsconfig.json postcss.config.mjs tailwind.config.ts eslint.config.mjs ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN AUTH_SECRET=temporary-build-only-placeholder npm run build
RUN node -e "const fs=require('fs'); for (const name of ['ffmpeg-static','ffprobe-static']) fs.rmSync('.next/standalone/node_modules/'+name,{recursive:true,force:true})"

FROM builder AS production-deps
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4250
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV FFMPEG_PATH=/app/media-tools/bin/ffmpeg
ENV FFPROBE_PATH=/app/media-tools/bin/ffprobe
RUN apk add --no-cache libc6-compat openssl dos2unix su-exec
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs && adduser nextjs nodejs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma-template/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma-template/migrations
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=media-tools --chown=nextjs:nodejs /media-build ./media-tools
COPY docker-entrypoint.sh ./
RUN dos2unix docker-entrypoint.sh && chmod +x docker-entrypoint.sh && mkdir -p public/uploads && chown nextjs:nodejs public/uploads
ARG REVISION
LABEL org.opencontainers.image.revision=${REVISION}
EXPOSE 4250
ENTRYPOINT ["./docker-entrypoint.sh"]
