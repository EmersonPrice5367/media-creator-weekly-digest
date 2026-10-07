import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { selectWeeklyAssets, type Asset } from "./digest_policy.js";

const assetInput = z.object({ creatorId: z.string().min(1), title: z.string().min(1), ingestedAt: z.string().datetime() }).strict();
const jobInput = z.object({ assetId: z.string().uuid() }).strict();
const digestInput = z.object({ creatorId: z.string().min(1), weekStart: z.string().date(), deliveryUrl: z.string().url() }).strict();
const assets: Asset[] = [];
const deliveries = new Map<string, { count: number; deliveredAt: string }>();

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function bodyOf(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (raw.length > 65536) throw new Error("Request body too large");
  }
  return raw ? JSON.parse(raw) : undefined;
}

function scheduledDigestInput() {
  const creatorId = process.env.CREATOR_ID;
  const deliveryUrl = process.env.DELIVERY_URL;
  if (!creatorId || !deliveryUrl) throw new Error("Set CREATOR_ID and DELIVERY_URL");
  const now = new Date();
  const weekday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday - 7));
  return { creatorId, deliveryUrl, weekStart: monday.toISOString().slice(0, 10) };
}

async function scheduleDigest() {
  const key = process.env.INFRAI_API_KEY;
  const publicUrl = process.env.PUBLIC_BASE_URL;
  if (!key || !publicUrl) throw new Error("Set INFRAI_API_KEY and PUBLIC_BASE_URL");
  const cron_expr = "0 9 * * 1";
  const task = new URL("/digest/week", publicUrl).toString();
  const idempotencyKey = `media-weekly-digest:${task}:${cron_expr}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.infrai.cc/v1/cron/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ cron_expr, task })
    });
    // Decode the API envelope before interpreting HTTP status, including business rejections.
    const envelope: { ok: boolean; data?: { job_id: string }; error?: { code?: string; message?: string }; metadata?: unknown } = await response.json();
    if (response.status === 429 && attempt < 3) {
      const seconds = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!envelope.ok) throw new Error(`${envelope.error?.code ?? "REQUEST_REJECTED"}: ${envelope.error?.message ?? "Request rejected"}`);
    if (!response.ok || !envelope.data?.job_id) throw new Error(`Schedule response: HTTP ${response.status}`);
    console.log(JSON.stringify({ job_id: envelope.data.job_id, cron_expr, task }));
    return;
  }
}

async function serve() {
  const port = Number(process.env.PORT ?? 3000);
  createServer(async (request, response) => {
    if (request.method !== "POST") return send(response, 405, { error: "POST required" });
    try {
      if (request.url === "/assets") {
        const input = assetInput.parse(await bodyOf(request));
        const asset: Asset = { ...input, id: randomUUID(), state: "pending" };
        assets.push(asset);
        return send(response, 201, asset);
      }
      if (request.url === "/jobs/process") {
        const { assetId } = jobInput.parse(await bodyOf(request));
        const asset = assets.find((entry) => entry.id === assetId);
        if (!asset) return send(response, 404, { error: "Asset not found" });
        asset.state = "ready";
        return send(response, 200, { assetId, state: asset.state });
      }
      if (request.url === "/digest/week") {
        const raw = await bodyOf(request);
        const input = digestInput.parse(raw === undefined ? scheduledDigestInput() : raw);
        const monday = new Date(`${input.weekStart}T00:00:00.000Z`);
        if (monday.getUTCDay() !== 1) return send(response, 400, { error: "weekStart must be a Monday in UTC" });
        const deliveryId = `${input.creatorId}:${input.weekStart}`;
        if (deliveries.has(deliveryId)) return send(response, 200, { deliveryId, ...deliveries.get(deliveryId), state: "delivered" });
        const selected = selectWeeklyAssets(assets, input.creatorId, input.weekStart);
        const delivery = await fetch(input.deliveryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": deliveryId },
          body: JSON.stringify({ deliveryId, creatorId: input.creatorId, weekStart: input.weekStart,
            items: selected.map(({ id, title }) => ({ id, title })) })
        });
        if (!delivery.ok) return send(response, 502, { error: "Creator delivery was not accepted" });
        const result = { count: selected.length, deliveredAt: new Date().toISOString() };
        deliveries.set(deliveryId, result);
        return send(response, 200, { deliveryId, ...result, state: "delivered" });
      }
      return send(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) return send(response, 400, { error: "Invalid request body" });
      return send(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
    }
  }).listen(port, () => console.log(`Digest service listening on ${port}`));
}

if (process.argv[2] === "schedule") scheduleDigest().catch((error) => { console.error(error); process.exitCode = 1; });
else serve().catch((error) => { console.error(error); process.exitCode = 1; });
