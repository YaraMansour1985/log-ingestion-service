# Log Ingestion and Query Service

A TypeScript/Fastify API for ingesting structured logs into PostgreSQL and querying them with filtering, cursor pagination, and time-bucketed aggregation.

## Tech Stack

- TypeScript
- Fastify
- PostgreSQL
- Zod
- node-pg-migrate
- Vitest
- Docker Compose

## Setup

Start the complete service with:

docker compose up --build

The API is available on http://localhost:8080.

## API

GET /health

Returns the service health status.

GET /health/db

Checks PostgreSQL connectivity.

POST /logs

Accepts a batch of structured logs. Each entry contains timestamp, level, service, message, and optional flat attributes.

Invalid entries are rejected individually while valid entries are accepted.

Supported levels: debug, info, warn, error.

GET /logs

Supports service, level, since, until, attr.<key>, q, limit, and cursor filters.

Results are ordered by timestamp descending and use cursor-based pagination.

GET /logs/aggregate

Supports since, until, bucket, service, level, attr.<key>, q, and group_by.

Supported buckets are 1m, 5m, 1h, and 1d.

## Database Design

Logs are stored in PostgreSQL in the logs table.

Columns:

- id: BIGSERIAL primary key
- timestamp: timestamptz
- level: log level
- service: service name
- message: log message
- metadata: JSONB attributes
- created_at: insertion timestamp

## Attribute Storage

Attributes are stored as PostgreSQL JSONB.

The API accepts flat objects containing strings, numbers, and booleans. Nested objects and arrays are rejected.

Attribute filters use JSONB extraction and compare values as strings.

## Indexes

The database uses an index on (timestamp, id) for descending log queries and cursor pagination.

A second index on (service, timestamp, id) supports service-filtered queries.

## Migrations

node-pg-migrate applies database migrations before the application starts.

Docker Compose waits for PostgreSQL to become healthy before starting the application.

## Testing

Build:

npm run build

Run tests:

npm test

Build and test:

npm run build && npm test

The current automated suite contains 8 tests and passes successfully.

## Docker Verification

The service has been verified with Docker Compose.

GET /health returns status ok.

GET /health/db confirms the PostgreSQL connection.

## Retention

Automatic retention deletion is not currently implemented.

A production implementation could use controlled batch deletion or time-based PostgreSQL partitioning to remove expired logs while limiting table bloat and disruption to ingestion.

## Performance

The TypeScript build, automated tests, Docker startup, health checks, database health check, ingestion, filtering, aggregation, and cursor validation have been verified locally.

A formal 15,000 logs/second load test and 1,000,000-row benchmark have not yet been completed, so no unmeasured performance numbers are claimed.

## Known Limitations

- Automated retention is not implemented.
- Formal high-volume load testing has not been completed.
- One-million-row performance measurements have not been completed.
- CI configuration has not yet been added.
- No optional authentication or rate limiting features are enabled.

## Optional Features

No optional features are enabled.

The default Docker Compose configuration provides the unauthenticated core service required by the project.

## Project Status

The core ingestion and query service is implemented and verified locally with Docker Compose and automated tests.
