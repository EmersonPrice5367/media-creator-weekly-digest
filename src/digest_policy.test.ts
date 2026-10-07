import assert from "node:assert/strict";
import test from "node:test";
import { selectWeeklyAssets, type Asset } from "./digest_policy.js";

test("a creator receives only processed assets ingested within the requested UTC week", () => {
  const assets: Asset[] = [
    { id: "early", creatorId: "ava", title: "Last week", ingestedAt: "2026-09-13T23:59:59Z", state: "ready" },
    { id: "pending", creatorId: "ava", title: "Encoding", ingestedAt: "2026-09-14T10:00:00Z", state: "pending" },
    { id: "other", creatorId: "ben", title: "Other channel", ingestedAt: "2026-09-15T10:00:00Z", state: "ready" },
    { id: "selected", creatorId: "ava", title: "New episode", ingestedAt: "2026-09-16T10:00:00Z", state: "ready" },
    { id: "late", creatorId: "ava", title: "Next week", ingestedAt: "2026-09-21T00:00:00Z", state: "ready" }
  ];
  assert.deepEqual(selectWeeklyAssets(assets, "ava", "2026-09-14").map((asset) => asset.id), ["selected"]);
});
