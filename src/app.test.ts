import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { db } from "./db.js";

describe("Log Ingestion API", () => {
  const app = buildApp();

  beforeEach(async () => {
    await db.query("DELETE FROM logs");
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it("GET /health returns ok", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
    });
  });

  it("GET /health/db confirms database connection", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/db",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      database: true,
    });
  });

  it("POST /logs accepts a valid batch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "error",
            service: "checkout",
            message: "payment declined",
            attributes: {
              user_id: "42",
              region: "eu-west",
              retries: 3,
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.accepted).toBe(1);
    expect(body.rejected).toEqual([]);
  });

  it("POST /logs rejects invalid entries without rejecting valid entries", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "error",
            service: "checkout",
            message: "payment declined",
          },
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "critical",
            service: "checkout",
            message: "invalid level",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.accepted).toBe(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(1);
  });

  it("POST /logs returns 400 when every entry is invalid", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "critical",
            service: "checkout",
            message: "invalid",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();

    expect(body.accepted).toBe(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(0);
  });

  it("GET /logs filters by service", async () => {
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "error",
            service: "checkout",
            message: "payment declined",
          },
          {
            timestamp: "2026-07-20T14:33:01.123Z",
            level: "info",
            service: "auth",
            message: "login successful",
          },
        ],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/logs?service=checkout",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].service).toBe("checkout");
    expect(body.logs[0].message).toBe("payment declined");
    expect(body.next_cursor).toBeNull();
  });

  it("GET /logs filters by level", async () => {
    await app.inject({
      method: "POST",
      url: "/logs",
      payload: {
        logs: [
          {
            timestamp: "2026-07-20T14:32:01.123Z",
            level: "error",
            service: "checkout",
            message: "payment declined",
          },
          {
            timestamp: "2026-07-20T14:33:01.123Z",
            level: "info",
            service: "checkout",
            message: "payment started",
          },
        ],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/logs?level=error",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].level).toBe("error");
  });

  it("GET /logs rejects an invalid cursor", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/logs?cursor=invalid",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Invalid cursor");
  });
});
