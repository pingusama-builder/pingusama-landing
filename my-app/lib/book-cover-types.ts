export type CoverFailureReason="isbn-required"|"search-not-configured"|"search-unavailable"|"source-unavailable"|"image-unavailable"|"no-verified-cover"|"storage-failed";
export function coverFailureMessage(asset:BookCoverAsset):string {
  if(asset.status==="pending")return "呢個版本未完成封面搜尋，可以按自動搵封面繼續。";
  const messages:Record<CoverFailureReason,string>={
    "isbn-required":"未有可核對嘅 ISBN；請先選擇版本，或上傳封面圖片。",
    "search-not-configured":"替補搜尋暫時未啟用；可以貼上出版社／書店來源頁，或上傳圖片。",
    "search-unavailable":"搜尋服務暫時無法查詢；今次未完成搜尋，可以稍後重試。",
    "source-unavailable":"部分來源暫時無法讀取；今次未完成搜尋，可以稍後重試或提供其他來源。",
    "image-unavailable":"已核對書目版本，但圖片未能讀取；可以重試或提供其他來源。",
    "no-verified-cover":"已完成搜尋，暫未搵到同一 ISBN 嘅可用封面；可以提供其他來源或上傳圖片。",
    "storage-failed":"已搵到封面，但保存失敗；請重試。",
  };
  return asset.failureReason?messages[asset.failureReason]:"暫未搵到已核實嘅同版本圖片，可以稍後重試或上傳。";
}
export interface BookCoverAsset {
  editionKey: string;
  status: "available" | "missing" | "failed" | "pending";
  format: "unreviewed" | "flat-front" | "product-photo";
  checkedAt: string;
  refreshStatus?: "missing" | "failed";
  failureReason?: CoverFailureReason;
  url?: string;
  source?: "google" | "openlibrary" | "web" | "manual";
  sourceUrl?: string;
  sourcePage?: string;
  sha256?: string;
  width?: number;
  height?: number;
}
