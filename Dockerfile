# syntax=docker/dockerfile:1
FROM node:20-alpine as builder

WORKDIR /app

# install build dependencies
RUN apk add --update --no-cache \
	bash \
	git
ADD package.json package-lock.json /app/
RUN npm ci
# This expects the repo's submodules to be checked out already.
ADD --link google-transit /app/google-transit
ADD --link python-nyct-gtfs /app/python-nyct-gtfs

# run build step
ADD build.sh /app/
RUN npm run build

# ---

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
RUN apk add --update --no-cache \
	moreutils \
	postgresql-client
ADD package.json package-lock.json /app
RUN npm ci --omit dev && npm cache clean --force

# add source code
# todo: exclude google-transit & python-nyct-gtfs, using `syntax=docker/dockerfile:1.7-labs` & --exclude
# --exclude google-transit --exclude python-nyct-gtfs
ADD . /app
COPY --from=builder \
	/app/lib/gtfs-realtime.proto /app/lib/mta-gtfs-realtime.proto /app/lib/mta-gtfs-realtime.pb.js \
	./lib/

EXPOSE 3000

ENV PORT 3000

CMD ["node", "index.js"]
