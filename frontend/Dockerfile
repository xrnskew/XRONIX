# Сервис web: docker build -t xronix-web frontend → nginx на порту 8080, /api проксируется в backend:8000
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# По умолчанию — настоящий API; VITE_USE_MOCKS=true собирает витрину на моках
ARG VITE_USE_MOCKS=false
# Сайт в compose открывается по http, в том числе не с localhost: без upgrade-insecure-requests в CSP
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS VITE_CSP_ALLOW_HTTP=true
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
