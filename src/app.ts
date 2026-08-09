import Fastify from "fastify";
import { db } from "./db.js";
import {
  createLogBatchSchema,
  logEntrySchema,
  listLogsQuerySchema,
  aggregateLogsQuerySchema,
} from "./schemas.js";

type Cursor = {
  timestamp: string;
  id: string;
};

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (
      typeof decoded.timestamp !== "string" ||
      typeof decoded.id !== "string"
    ) {
      throw new Error("Invalid cursor");
    }

    return decoded;
  } catch {
    throw new Error("Invalid cursor");
  }
}

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => {
    return {
      status: "ok",
    };
  });

  app.get("/health/db", async () => {
    const result = await db.query("SELECT 1 AS ok");

    return {
      status: "ok",
      database: result.rows[0].ok === 1,
    };
  });

  app.post("/logs", async (request, reply) => {
    const bodyResult = createLogBatchSchema.safeParse(request.body);

    if (!bodyResult.success) {
      return reply.status(400).send({
        error: "Request body must contain a logs array",
      });
    }

    if (bodyResult.data.logs.length === 0) {
      return reply.status(400).send({
        error: "logs must contain at least one entry",
      });
    }

    const accepted: Array<{
      timestamp: string;
      level: "debug" | "info" | "warn" | "error";
      service: string;
      message: string;
      attributes?: Record<string, string | number | boolean>;
    }> = [];

    const rejected: Array<{
      index: number;
      reason: string;
    }> = [];

    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;

    for (let index = 0; index < bodyResult.data.logs.length; index++) {
      const entry = bodyResult.data.logs[index];

      const parsed = logEntrySchema.safeParse(entry);

      if (!parsed.success) {
        const issue = parsed.error.issues[0];

        rejected.push({
          index,
          reason: issue?.message ?? "Invalid log entry",
        });

        continue;
      }

      const timestampMs = Date.parse(parsed.data.timestamp);

      if (timestampMs > fiveMinutesFromNow) {
        rejected.push({
          index,
          reason:
            "timestamp must not be more than five minutes in the future",
        });

        continue;
      }

      accepted.push(parsed.data);
    }

    if (accepted.length === 0) {
      return reply.status(400).send({
        accepted: 0,
        rejected,
      });
    }

    try {
      const values: unknown[] = [];

      const rows = accepted.map((log) => {
        const offset = values.length;

        values.push(
          log.timestamp,
          log.level,
          log.service,
          log.message,
          log.attributes ?? null,
        );

        return `(
          $${offset + 1},
          $${offset + 2},
          $${offset + 3},
          $${offset + 4},
          $${offset + 5}
        )`;
      });

      await db.query(
        `
          INSERT INTO logs (
            timestamp,
            level,
            service,
            message,
            metadata
          )
          VALUES ${rows.join(",")}
        `,
        values,
      );

      return reply.status(200).send({
        accepted: accepted.length,
        rejected,
      });
    } catch (error) {
      request.log.error(error, "Failed to insert log batch");

      return reply.status(500).send({
        error: "Failed to store logs",
      });
    }
  });

  app.get("/logs", async (request, reply) => {
    const parsed = listLogsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    const {
      service,
      level,
      since,
      until,
      limit,
      cursor,
    } = parsed.data;

    if (since && until && new Date(until) <= new Date(since)) {
      return reply.status(400).send({
        error: "until must be later than since",
      });
    }

    const conditions: string[] = [];
    const values: unknown[] = [];

    const addValue = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (service) {
      conditions.push(`service = ${addValue(service)}`);
    }

    if (level) {
      conditions.push(`level = ${addValue(level)}`);
    }

    if (since) {
      conditions.push(`timestamp >= ${addValue(since)}`);
    }

    if (until) {
      conditions.push(`timestamp < ${addValue(until)}`);
    }

    const query = request.query as Record<string, unknown>;

    // Attribute filters: attr.<key>=<value>
    for (const [key, value] of Object.entries(query)) {
      if (!key.startsWith("attr.")) {
        continue;
      }

      const attributeKey = key.slice("attr.".length);

      if (!attributeKey || typeof value !== "string") {
        return reply.status(400).send({
          error: `Invalid attribute filter: ${key}`,
        });
      }

      const keyParam = addValue(attributeKey);
      const valueParam = addValue(value);

      conditions.push(
        `metadata ->> ${keyParam} = ${valueParam}`,
      );
    }

    // Case-insensitive substring message search
    if (typeof query.q === "string") {
      if (query.q.length === 0) {
        return reply.status(400).send({
          error: "q must not be empty",
        });
      }

      conditions.push(
        `message ILIKE ${addValue(`%${query.q}%`)}`,
      );
    }

    if (cursor) {
      try {
        const decoded = decodeCursor(cursor);

        const timestampParam = addValue(decoded.timestamp);
        const idParam = addValue(decoded.id);

        conditions.push(
          `(timestamp, id) < (${timestampParam}, ${idParam})`,
        );
      } catch {
        return reply.status(400).send({
          error: "Invalid cursor",
        });
      }
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const limitParam = addValue(limit + 1);

    try {
      const result = await db.query(
        `
          SELECT
            id,
            timestamp,
            level,
            service,
            message,
            metadata AS attributes,
            created_at
          FROM logs
          ${whereClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT ${limitParam}
        `,
        values,
      );

      const hasMore = result.rows.length > limit;

      const rows = hasMore
        ? result.rows.slice(0, limit)
        : result.rows;

      const nextCursor = hasMore
        ? encodeCursor({
            timestamp: rows[rows.length - 1].timestamp.toISOString(),
            id: String(rows[rows.length - 1].id),
          })
        : null;

      return {
        logs: rows,
        next_cursor: nextCursor,
      };
    } catch (error) {
      request.log.error(error, "Failed to query logs");

      return reply.status(500).send({
        error: "Failed to retrieve logs",
      });
    }
  });

  app.get("/logs/aggregate", async (request, reply) => {
    const parsed = aggregateLogsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query parameters",
        details: parsed.error.flatten(),
      });
    }

    const {
      service,
      level,
      since,
      until,
      bucket,
      group_by,
    } = parsed.data;

    if (new Date(until) <= new Date(since)) {
      return reply.status(400).send({
        error: "until must be later than since",
      });
    }

    const conditions: string[] = [];
    const values: unknown[] = [];

    const addValue = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    conditions.push(`timestamp >= ${addValue(since)}`);
    conditions.push(`timestamp < ${addValue(until)}`);

    if (service) {
      conditions.push(`service = ${addValue(service)}`);
    }

    if (level) {
      conditions.push(`level = ${addValue(level)}`);
    }

    const query = request.query as Record<string, unknown>;

    for (const [key, value] of Object.entries(query)) {
      if (!key.startsWith("attr.")) {
        continue;
      }

      const attributeKey = key.slice("attr.".length);

      if (!attributeKey || typeof value !== "string") {
        return reply.status(400).send({
          error: `Invalid attribute filter: ${key}`,
        });
      }

      const keyParam = addValue(attributeKey);
      const valueParam = addValue(value);

      conditions.push(
        `metadata ->> ${keyParam} = ${valueParam}`,
      );
    }

    if (typeof query.q === "string") {
      if (query.q.length === 0) {
        return reply.status(400).send({
          error: "q must not be empty",
        });
      }

      conditions.push(
        `message ILIKE ${addValue(`%${query.q}%`)}`,
      );
    }

    const bucketIntervals: Record<string, string> = {
      "1m": "1 minute",
      "5m": "5 minutes",
      "1h": "1 hour",
      "1d": "1 day",
    };

    const interval = bucketIntervals[bucket];

    const bucketExpression = `
      date_bin(
        '${interval}'::interval,
        timestamp,
        TIMESTAMP '1970-01-01'
      )
    `;

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const groupSelect =
      group_by === "service"
        ? `service AS "group"`
        : group_by === "level"
          ? `level AS "group"`
          : `NULL AS "group"`;

    const groupByClause =
      group_by === "service"
        ? `GROUP BY ${bucketExpression}, service`
        : group_by === "level"
          ? `GROUP BY ${bucketExpression}, level`
          : `GROUP BY ${bucketExpression}`;

    try {
      const result = await db.query(
        `
          SELECT
            ${bucketExpression} AS start,
            ${groupSelect},
            COUNT(*)::integer AS count
          FROM logs
          ${whereClause}
          ${groupByClause}
          ORDER BY start ASC, "group" ASC
        `,
        values,
      );

      return {
        buckets: result.rows,
      };
    } catch (error) {
      request.log.error(error, "Failed to aggregate logs");

      return reply.status(500).send({
        error: "Failed to aggregate logs",
      });
    }
  });

  return app;
}
