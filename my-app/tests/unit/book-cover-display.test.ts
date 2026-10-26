import {expect,it} from "vitest";
import {coverDisplay} from "@/lib/book-cover-display";
const asset={editionKey:"isbn:test",status:"available" as const,format:"flat-front" as const,checkedAt:"2026-09-23",width:400,height:400};
it("uses confirmed front artwork as an image and texture at its original ratio",()=>expect(coverDisplay("cover",asset)).toEqual({image:"cover",texture:"cover",preview:null,ratio:1}));
it("restores pre-flag Google and Open Library covers without trusting product photos",()=>{
 for(const source of ["google","openlibrary"] as const){
  expect(coverDisplay("cover",{...asset,format:"unreviewed",source})).toEqual({image:"cover",texture:"cover",preview:null,ratio:1});
  expect(coverDisplay("cover",undefined,false,source).texture).toBe("cover");
 }
 expect(coverDisplay("photo",{...asset,format:"product-photo",source:"google"}).texture).toBeNull();
});
it("shows saved same-edition fallback artwork without requiring texture confirmation",()=>{
 expect(coverDisplay("cover",{...asset,format:"unreviewed",source:"web"})).toEqual({image:"cover",texture:null,preview:"cover",ratio:1});
});
it("displays product photos intact without turning them into book textures",()=>{
 expect(coverDisplay("photo",{...asset,format:"product-photo",source:"web",width:600,height:400})).toEqual({image:"photo",texture:null,preview:"photo",ratio:1.5});
});
it("keeps unknown legacy sources in details until an asset has been saved",()=>{
 expect(coverDisplay("unknown")).toEqual({image:null,texture:null,preview:"unknown",ratio:2/3});
});
it("uses the title placeholder for unavailable or broken images",()=>{
 for(const status of ["missing","failed","pending"] as const)expect(coverDisplay("stale",{...asset,status})).toEqual({image:null,texture:null,preview:null,ratio:2/3});
 expect(coverDisplay(null,asset).image).toBeNull();
 expect(coverDisplay("bad",asset,true)).toEqual({image:null,texture:null,preview:null,ratio:2/3});
});
