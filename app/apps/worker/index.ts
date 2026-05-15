/**
 * Yeyak sniper worker — Railway entrypoint.
 *
 * Uses BullMQ with a repeat rule of `0 * * * *` (every hour on the
 * hour) to run `sniperJob` against all active reservation_tasks.
 * Per-task cost is one `check_availability` call ($0.05) plus a
 * `book_reservation` call ($3.99) only if a matching slot is found,
 * so each task burns ~$1.20/day in checks until it resolves.
 *
 * Redis connection is provided by the Railway Redis plugin via REDIS_URL.
 */
import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { createServiceClient } from "./lib/supabase.js";
import { runSniperCycle } from "./jobs/sniperJob.js";

const QUEUE_NAME = "yeyak-sniper";
const CRON = "0 * * * *";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is not set");

const apifyToken = process.env.APIFY_API_TOKEN;
if (!apifyToken) throw new Error("APIFY_API_TOKEN is not set");

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function main() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const events = new QueueEvents(QUEUE_NAME, { connection });

  // Idempotent: re-adding the same repeatable job replaces it.
  await queue.add(
    "cycle",
    {},
    {
      repeat: { pattern: CRON },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const supabase = createServiceClient();
      await runSniperCycle({ supabase, apifyToken: apifyToken! });
    },
    { connection, concurrency: 1 },
  );

  worker.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on("failed", (job, err) =>
    console.error(`[worker] job ${job?.id} failed`, err),
  );
  events.on("waiting", ({ jobId }) => console.log(`[worker] job ${jobId} queued`));

  console.log(`[worker] yeyak-sniper up, cron=${CRON}`);
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
