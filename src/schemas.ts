import { z } from "zod";

const attributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const logEntrySchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  level: z.enum(["debug", "info", "warn", "error"]),
  service: z.string().min(1),
  message: z.string().min(1),
  attributes: z
    .record(z.string(), attributeValueSchema)
    .optional(),
});

export const createLogBatchSchema = z.object({
  logs: z.array(z.unknown()),
});

export const listLogsQuerySchema = z.object({
  service: z.string().min(1).optional(),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});

export const aggregateLogsQuerySchema = z
  .object({
    service: z.string().min(1).optional(),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    since: z.string().datetime({ offset: true }),
    until: z.string().datetime({ offset: true }),
    bucket: z.enum(["1m", "5m", "1h", "1d"]),
    group_by: z.enum(["service", "level"]).optional(),
  })
  .passthrough();

export type LogEntry = z.infer<typeof logEntrySchema>;
export type CreateLogBatch = z.infer<typeof createLogBatchSchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
