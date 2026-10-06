# Used when deploying the frontend for real (not needed for local dev — for
# local dev you run `npm run dev`, see the root README.md).
#
# This is a "multi-stage" build: stage 1 uses Node to turn the React/
# TypeScript source into a folder of plain HTML/CSS/JS (`npm run build`);
# stage 2 throws Node away entirely and just serves that folder with
# nginx, a lightweight production web server. The image you actually run
# never has Node, npm, or your source code in it — just the finished
# static files — which makes it smaller and gives it a smaller attack
# surface than shipping Node into production.

# --- Stage 1: build the static files ---------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# The frontend talks to the backend at whatever VITE_API_BASE_URL was set
# to when `npm run build` ran (Vite bakes it into the built files — it
# can't be changed later just by restarting the container). "/api" is a
# *relative* path, so the browser always calls whatever domain served the
# page itself — the nginx config below (stage 2) is what forwards that to
# the backend container. This means you don't need to know or hard-code
# your server's domain name here at all.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# --- Stage 2: serve the built files with nginx ------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
