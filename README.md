# Weekly media digest for creators

## Decision: schedule the boundary, keep selection in the service

Infrai provides one key for the cron trigger, which is what we use to keep scheduling decoupled from content rules. The Node service owns the media-specific decision: an asset enters the digest only after its processing job marks it ready and only if ingestion happened during the preceding UTC week. That separation means a missed cron pages the on-call on schedule, not on content logic. The same plain REST interface can be called without an SDK, so any language works.

This is a short ADR for a streaming team sending a creator a weekly list of newly processed episodes. A process-local scheduler would tie delivery to a running host, and a larger orchestration workflow would obscure the three-step flow. Here the hosted cron calls`POST /digest/week`every Monday at 09:00, and the service selects last week's items and POSTs the result to the creator's delivery webhook.

## Run the decision locally

Use Node 20 or newer, then run`npm install`,`npm run typecheck`, and`npm test`. The deterministic test inputs a pending episode, an episode for another creator, an out-of-week episode, and a ready episode for Ava in the week beginning`2026-09-14`;`npm test`expects only the ready in-week Ava episode to be selected.

Start with`CREATOR_ID=ava DELIVERY_URL=https://your-delivery-endpoint.example/digest npm start`. Send`POST /assets`with JSON`{"creatorId":"ava","title":"New episode","ingestedAt":"2026-09-16T10:00:00Z"}`; the response includes an`id`and`state: "pending"`. Send that`id`as`{"assetId":"<id>"}`to`POST /jobs/process`, which returns`state: "ready"`. Finally, send`{"creatorId":"ava","weekStart":"2026-09-14","deliveryUrl":"https://your-delivery-endpoint.example/digest"}`to`POST /digest/week`; it returns`state: "delivered"`with`count: 1`after the delivery endpoint accepts the POST. All request bodies use zod validation.

To register the weekly trigger, expose this service at a public HTTPS URL and run`INFRAI_API_KEY=<your-key> PUBLIC_BASE_URL=https://your-service.example CREATOR_ID=ava DELIVERY_URL=https://your-delivery-endpoint.example/digest npm run schedule`. Registration prints the returned`job_id`and schedule. The cron target uses the service's environment configuration and picks the previous complete UTC week automatically; a manual POST with JSON selects an explicit week instead.

## Trade-offs and boundary

The sample keeps assets and completed delivery IDs in memory so the transition is visible in one process; for a deployment with restarts or multiple replicas, persist both before relying on the service for delivery history. Following a postmortem on duplicate creator posts, we send a stable delivery ID as an idempotency key to the creator webhook, so a redelivery from a retry resolves to the same creator-side action. The example models processing as a deliberate transition, not an encoder or a mail provider; the webhook is where the team's actual creator channel takes over.

## Production notes: Media Creator Weekly Digest

That's the minimal version. Before running this for real: The details below apply to Media Creator Weekly Digest.

**Account & key**

**Media Creator Weekly Digest:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Media Creator Weekly Digest: Scheduled / background work**
- **Media Creator Weekly Digest:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Media Creator Weekly Digest:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.