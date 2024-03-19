# syntax=docker/dockerfile:1
FROM node:20-alpine
LABEL org.opencontainers.image.title="mta-gtfs-rt-consolidation-service"
LABEL org.opencontainers.image.description="An HTTP service consolidating & normalizing the MTA (NYCT) GTFS-Realtime feeds."
LABEL org.opencontainers.image.authors="Jannis R <mail@jannisr.de>"
LABEL org.opencontainers.image.documentation="https://github.com/derhuerst/mta-gtfs-rt-consolidation-service"
# todo: does docker buildx add this automatically?
LABEL org.opencontainers.image.source="https://github.com/derhuerst/mta-gtfs-rt-consolidation-service"
LABEL org.opencontainers.image.revision="1"
LABEL org.opencontainers.image.licenses="ISC"

WORKDIR /app

# install production-only dependencies
# RUN apk add --update --no-cache bash wget postgresql-client
ADD package.json package-lock.json /app
RUN npm ci --omit dev && npm cache clean --force

ADD . /app

EXPOSE 3000

ENV PORT 3000

CMD ["node", "index.js"]
