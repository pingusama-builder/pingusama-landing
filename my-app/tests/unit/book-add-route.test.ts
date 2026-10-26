import {beforeEach,expect,it,vi} from "vitest";
vi.mock("@/lib/auth",()=>({getCurrentUser:vi.fn(),isAdmin:(user:{app_metadata?:{role?:string}}|null)=>user?.app_metadata?.role==="admin"}));
vi.mock("@/lib/book-add",()=>({runBookAdd:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {getCurrentUser} from "@/lib/auth";
import {runBookAdd} from "@/lib/book-add";
import {POST} from "@/app/api/bench/add-book/route";
import {revalidatePath} from "next/cache";
import {traceBench} from "@/lib/bench-trace";
import type {BookAddResult} from "@/lib/book-add-types";
const request=(origin="https://site.example",body=JSON.stringify({section:"tbr",entry:{isbn13:"9780593321461",note:""}}))=>new Request("https://site.example/api/bench/add-book",{method:"POST",headers:{origin,"Content-Type":"application/json"},body});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(getCurrentUser).mockResolvedValue({id:"admin",app_metadata:{role:"admin"}});});
it("rejects unauthenticated and cross-origin requests before starting any work",async()=>{
 expect((await POST(request("https://attacker.example"))).status).toBe(403);
 vi.mocked(getCurrentUser).mockResolvedValue(null);
 expect((await POST(request())).status).toBe(401);expect(runBookAdd).not.toHaveBeenCalled();
});
it("rejects invalid and oversized input before acquisition",async()=>{
 expect((await POST(request("https://site.example","invalid json"))).status).toBe(400);
 expect((await POST(request("https://site.example"," ".repeat(64001)))).status).toBe(400);
 expect(runBookAdd).not.toHaveBeenCalled();
});
it("streams real progress before the workflow finishes and refreshes caches before final success",async()=>{
 let finish!:(value:BookAddResult)=>void;
 vi.mocked(runBookAdd).mockImplementation(async(_input,emit)=>{
  emit({type:"progress",step:"metadata",status:"running",message:"核對中"});
  traceBench("book.metadata","started",{provider:"google",token:"private"});
  return new Promise(resolve=>{finish=resolve;});
 });
 const response=await POST(request()),reader=response.body!.getReader();
 expect(response.headers.get("content-type")).toContain("application/x-ndjson");
 const first=new TextDecoder().decode((await reader.read()).value);
 expect(first).toContain("核對中");expect(revalidatePath).not.toHaveBeenCalled();
 finish({type:"result",success:true,entry:{isbn13:"9780593321461",note:""},warnings:[],alreadyPresent:false});
 let rest="";while(true){const chunk=await reader.read();if(chunk.done)break;rest+=new TextDecoder().decode(chunk.value);}
 expect(rest).not.toContain("private");
 expect(rest).toContain('"success":true');expect(revalidatePath).toHaveBeenCalledWith("/");expect(revalidatePath).toHaveBeenCalledWith("/admin/bench");
});
it("keeps failure as a terminal result and does not refresh an unsaved shelf",async()=>{
 vi.mocked(runBookAdd).mockResolvedValue({type:"result",success:false,error:"保存未成功"});
 const text=await(await POST(request())).text();
 expect(text).toContain('"success":false');expect(revalidatePath).not.toHaveBeenCalled();
});
