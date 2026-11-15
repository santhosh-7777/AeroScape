FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /out/aeroscape-gateway .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/aeroscape-gateway /usr/local/bin/aeroscape-gateway
ENV PORT=8080
EXPOSE 8080
CMD ["aeroscape-gateway"]