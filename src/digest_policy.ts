export type Asset = {
  id: string;
  creatorId: string;
  title: string;
  ingestedAt: string;
  state: "pending" | "ready";
};

export function selectWeeklyAssets(assets: Asset[], creatorId: string, weekStart: string): Asset[] {
  const start = Date.parse(`${weekStart}T00:00:00.000Z`);
  const end = start + 7 * 24 * 60 * 60 * 1000;
  return assets
    .filter((asset) => asset.creatorId === creatorId && asset.state === "ready"
      && Date.parse(asset.ingestedAt) >= start && Date.parse(asset.ingestedAt) < end)
    .sort((a, b) => a.ingestedAt.localeCompare(b.ingestedAt) || a.id.localeCompare(b.id));
}
