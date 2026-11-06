# Arogya web app: build with Node, serve with nginx. Traefik routes "/" here.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_MODE=http
ARG VITE_SHOW_DEMO_USERS=true
ARG VITE_DEMO_PASSWORD=OralScreen@2026
ENV VITE_API_MODE=$VITE_API_MODE VITE_SHOW_DEMO_USERS=$VITE_SHOW_DEMO_USERS VITE_DEMO_PASSWORD=$VITE_DEMO_PASSWORD
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
