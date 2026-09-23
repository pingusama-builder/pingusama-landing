export interface BookCoverAsset {
  editionKey: string;
  status: "available" | "missing" | "failed" | "pending";
  format: "unreviewed" | "flat-front" | "product-photo";
  checkedAt: string;
  refreshStatus?: "missing" | "failed";
  url?: string;
  source?: "google" | "openlibrary" | "web" | "manual";
  sourceUrl?: string;
  sourcePage?: string;
  sha256?: string;
  width?: number;
  height?: number;
}
