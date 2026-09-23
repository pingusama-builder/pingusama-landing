import {expect,it} from "vitest";
import {coverDisplay} from "@/lib/book-cover-display";
const asset={editionKey:"isbn:test",status:"available" as const,format:"flat-front" as const,checkedAt:"2026-09-23",width:400,height:400};
it("uses only confirmed front artwork as texture at its original ratio",()=>expect(coverDisplay("cover",asset)).toEqual({texture:"cover",preview:null,ratio:1}));
it("keeps photos, unknown and legacy images out of the book texture",()=>{for(const candidate of [undefined,{...asset,format:"product-photo" as const},{...asset,format:"unreviewed" as const}])expect(coverDisplay("photo",candidate)).toEqual({texture:null,preview:"photo",ratio:2/3});});
it("uses the title placeholder for unavailable/broken images",()=>{expect(coverDisplay(null,asset).texture).toBeNull();expect(coverDisplay("bad",asset,true)).toEqual({texture:null,preview:null,ratio:2/3});});
