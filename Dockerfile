# Railway deploy image for RFP Tracker.
# Explicit Dockerfile so the build doesn't depend on Nixpacks auto-detection.
#
# Puppeteer's Chromium download is skipped: the costs-in-place reports and the
# rest of the app-under-test render client-side (window.print()), so no server
# Chromium is needed. Puppeteer-based PDF endpoints (email summaries, historical
# pricing) will error if invoked here — acceptable for a staging test box.
FROM node:22-slim

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

# Install deps first for layer caching. NODE_ENV is deliberately NOT set to
# production here — that would make npm skip devDependencies (vite, esbuild),
# which the build step needs. --ignore-scripts avoids the puppeteer postinstall.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

# Copy source and build (vite client + esbuild server → dist/).
COPY . .
RUN npm run build

# Only now switch to production for the runtime.
ENV NODE_ENV=production

# Railway provides PORT at runtime; the server reads process.env.PORT.
EXPOSE 8080
CMD ["npm", "run", "start"]
