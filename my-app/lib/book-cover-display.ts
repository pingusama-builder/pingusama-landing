import type { BookCoverAsset } from "./book-cover-types";

export function coverDisplay(
  coverUrl: string | null,
  asset?: BookCoverAsset,
  broken = false,
  legacySource?: "google" | "openlibrary" | null,
) {
  // Older Google/Open Library covers were saved before the format flag existed.
  const trustedFront = asset
    ? asset.format === "unreviewed" && (asset.source === "google" || asset.source === "openlibrary")
    : legacySource === "google" || legacySource === "openlibrary";
  const available = !!coverUrl && !broken && (!asset || asset.status === "available");
  // Saved edition images display intact before format review. Confirmation
  // gates only the simulated book spine/pages, never the cover image itself.
  const image = available && (asset || trustedFront) ? coverUrl : null;
  const texture = image && (asset?.format === "flat-front" || trustedFront) ? image : null;
  return {
    image,
    texture,
    preview: available && !texture ? coverUrl : null,
    ratio: image && asset?.width && asset.height ? asset.width / asset.height : 2 / 3,
  };
}
