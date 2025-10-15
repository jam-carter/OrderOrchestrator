import Fastify from "fastify";
import amqplib from "amqplib";
import { Client } from "pg";

const port = Number(process.env.PORT ?? 8080);

const app = Fastify({
    logger: {
        level: "info",
        transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
});

app.get("/healthz", async () => ({ status: "ok" }));

// lightweight ready check - quick conn/disconn
app.get("/readyz", async (_req, reply) => {
    const result = { status: "ok" as const, postgres: "down", rabbitmq: "down" };
    let ok = true;

    // postgres
    try {
        const pg = new Client({
            host: process.env.PG_HOST ?? "postgres",
            port: Number(process.env.PG_PORT ?? 5432),
            database: process.env.PG_DB ?? "orders",
            user: process.env.PG_USER ?? "postgres",
            password: process.env.PG_PASSWORD ?? "postgres",
            connectionTimeoutMillis: 1000,
        });
        await pg.connect();
        await pg.query("select 1");
        await pg.end();
        result.postgres = "up";
    } catch (err) {
        ok = false;
        app.log.warn({ err }, "postgres readiness failed");
    }

    // rabbitMQ
    try {
        const url = process.env.RABBITMQ_URL ?? "amqp://guest:guest@rabbitmq:5672";
        const conn = await amqplib.connect(url, {
            //small hb for quick shutdown incase broker is down
            heartbeat: 5,
            timeout: 1000 as any, // socket timeout
        });
        await conn.close();
        result.rabbitmq = "up";
    } catch (err) {
        ok = false;
        app.log.warn({ err }, "rabbitmq readiness failed");
    }

    return reply.code(ok ? 200 : 503).send(result);
});

const start = async () => {
    try {
        await app.listen({ port, host: "0.0.0.0" });
        app.log.info({ port }, "order-api up");
    } catch (err) {
        app.log.error(err, "order-api failed to start");
        process.exit(1);
    }
};
const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
