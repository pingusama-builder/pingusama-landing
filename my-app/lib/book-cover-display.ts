import type { BookCoverAsset } from "./book-cover-types";
export function coverDisplay(coverUrl:string|null,asset?:BookCoverAsset,broken=false,legacySource?:"google"|"openlibrary"|null){
 // Older Google/Open Library covers were saved before the format flag existed.
 const trustedFront=asset?.format==="unreviewed" && (asset.source==="google" || asset.source==="openlibrary") || !asset && (legacySource==="google" || legacySource==="openlibrary");
 const flat=!!coverUrl && !broken && (asset?.status==="available" && (asset.format==="flat-front" || trustedFront) || !asset && trustedFront);
 return {texture:flat?coverUrl:null,preview:!flat&&!broken?coverUrl:null,ratio:flat&&asset?.width&&asset.height?asset.width/asset.height:2/3};
}
