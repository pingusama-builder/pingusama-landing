import { beforeEach, expect, it, vi } from "vitest";
import type { ShelfData } from "@/lib/books";
vi.mock("@/lib/auth",()=>({requireAdmin:vi.fn().mockResolvedValue({id:"admin"})}));
vi.mock("@/lib/db/bench",()=>({loadShelf:vi.fn(),saveShelf:vi.fn()}));
vi.mock("@/lib/covers",()=>({decodeCoverBytes:vi.fn()}));
vi.mock("@/lib/shelf-covers",()=>({editionKey:(e:{isbn13:string})=>`isbn:${e.isbn13}`,storeCoverAsset:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import { updateBookCoverAction } from "@/app/admin/bench/cover-actions";
import { requireAdmin } from "@/lib/auth";
import { loadShelf,saveShelf } from "@/lib/db/bench";
import { decodeCoverBytes } from "@/lib/covers";
import { storeCoverAsset } from "@/lib/shelf-covers";
const asset={editionKey:"isbn:9789865580704",status:"available" as const,format:"unreviewed" as const,checkedAt:"2026-09-23",url:"https://storage.example/cover.jpg",sha256:"saved-hash"};
const shelf:ShelfData={currentlyReading:[{isbn13:"9789865580704",note:"keep",selection:{source:"web",language:"zh-Hant",match:"exact",book:{googleBooksId:"web:9789865580704",title:"ZOO",authors:["乙一"],isbn13:"9789865580704",isbn10:null,subtitle:null,publisher:null,publishedDate:null,pageCount:null,infoLink:null,thumbnail:null,coverUrl:asset.url,coverSource:null,coverAsset:asset}}}],tbr:[]};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadShelf).mockResolvedValue(structuredClone(shelf));});
const form=()=>{const f=new FormData();f.set("format","product-photo");return f;};
it("classifies only the saved image and preserves the shelf's notes",async()=>{
 const result=await updateBookCoverAction(shelf.currentlyReading[0],form());expect(result).toMatchObject({success:true,asset:{format:"product-photo"}});expect(vi.mocked(saveShelf).mock.calls[0][0].currentlyReading[0].note).toBe("keep");
});
it("rejects stale image confirmation",async()=>{
 const input=structuredClone(shelf.currentlyReading[0]);input.selection!.book.coverAsset!.sha256="stale";expect(await updateBookCoverAction(input,form())).toMatchObject({success:false});expect(saveShelf).not.toHaveBeenCalled();
});
it("stores an uploaded validated image for the selected edition",async()=>{
 const f=form();f.set("cover",new File([new Uint8Array(1200)],"cover.jpg",{type:"image/jpeg"}));vi.mocked(decodeCoverBytes).mockResolvedValue({bytes:Buffer.from("decoded"),mimeType:"image/jpeg",width:300,height:400});vi.mocked(storeCoverAsset).mockResolvedValue({...asset,source:"manual",format:"product-photo"});
 expect(await updateBookCoverAction(shelf.currentlyReading[0],f)).toMatchObject({success:true,asset:{source:"manual"}});expect(saveShelf).toHaveBeenCalledOnce();
});
it("does not fetch, upload or persist before admin authentication",async()=>{
 vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("Unauthorized"));expect(await updateBookCoverAction(shelf.currentlyReading[0],form())).toMatchObject({success:false});expect(loadShelf).not.toHaveBeenCalled();expect(storeCoverAsset).not.toHaveBeenCalled();
});
