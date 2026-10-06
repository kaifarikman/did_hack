FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
ENV BACKEND_URL=http://backend:8000 \
    DATA_SOURCE=live
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/10-resolver.envsh docker/40-runtime-config.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/10-resolver.envsh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
