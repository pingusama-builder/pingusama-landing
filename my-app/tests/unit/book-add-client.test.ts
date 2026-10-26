import {expect,it,vi} from "vitest";
import {confirmBookAdd,bookAddTraceMessage} from "@/lib/book-add-client";
import type {BookAddEvent} from "@/lib/book-add-types";
const input={section:"tbr" as const,entry:{isbn13:"9780593321461",note:""}};
it("delivers split UTF-8 progress immediately while waiting for a terminal result",async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;
 const fetcher=vi.fn().mockResolvedValue(new Response(new ReadableStream({start(value){controller=value;}})));
 const events:BookAddEvent[]=[];
 const pending=confirmBookAdd(input,event=>events.push(event),fetcher);
 const bytes=new TextEncoder().encode(JSON.stringify({type:"progress",step:"metadata",status:"running",message:"核對書名中"})+"\n");
 controller.enqueue(bytes.slice(0,bytes.length-5));controller.enqueue(bytes.slice(bytes.length-5));
 await vi.waitFor(()=>expect(events).toHaveLength(1));
 expect(events[0]).toMatchObject({message:"核對書名中"});
 controller.enqueue(new TextEncoder().encode(JSON.stringify({type:"result",success:true,entry:input.entry,warnings:[],alreadyPresent:false})+"\n"));controller.close();
 expect(await pending).toMatchObject({success:true});
 expect(fetcher).toHaveBeenCalledWith("/api/bench/add-book",expect.objectContaining({credentials:"same-origin",method:"POST"}));
});
it("does not report success when the stream closes without a persistence result",async()=>{
 const body=JSON.stringify({type:"progress",step:"save",status:"running",message:"保存中"})+"\n";
 await expect(confirmBookAdd(input,vi.fn(),vi.fn().mockResolvedValue(new Response(body)))).rejects.toThrow("未能確認保存");
});
it("recognizes an expired login before reading any progress",async()=>{
 await expect(confirmBookAdd(input,vi.fn(),vi.fn().mockResolvedValue(new Response("",{status:401})))).rejects.toThrow("重新登入");
});
it("turns image verification events into readable outcomes",()=>{
 expect(bookAddTraceMessage({at:"now",operation:"cover.decode",status:"accepted",data:{width:300,height:450}})).toContain("300 × 450");
 expect(bookAddTraceMessage({at:"now",operation:"cover.decode",status:"rejected",data:{code:"placeholder"}})).toContain("未通過");
});
