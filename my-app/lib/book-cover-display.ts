import type { BookCoverAsset } from "./book-cover-types";
export function coverDisplay(coverUrl:string|null,asset?:BookCoverAsset,broken=false){
 const flat=!!coverUrl && !broken && asset?.status==="available" && asset.format==="flat-front";
 return {texture:flat?coverUrl:null,preview:!flat&&!broken?coverUrl:null,ratio:flat&&asset?.width&&asset.height?asset.width/asset.height:2/3};
}
