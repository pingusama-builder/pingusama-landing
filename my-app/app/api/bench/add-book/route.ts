import { getCurrentUser, isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { runBookAdd } from "@/lib/book-add";
import { collectBenchTrace } from "@/lib/bench-trace";
import type { BookAddInput, BookAddEvent } from "@/lib/book-add-types";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){
  const url=new URL(request.url),host=request.headers.get("host")??url.host,protocol=request.headers.get("x-forwarded-proto")??url.protocol.slice(0,-1);
  if(!["http","https"].includes(protocol)||request.headers.get("origin")!==`${protocol}://${host}`)return Response.json({error:"請由書架管理頁確認加入。"},{status:403});
  const user=await getCurrentUser();
  if(!isAdmin(user))return Response.json({error:"登入已過期，請重新登入。"},{status:401});
  let input:BookAddInput;
  try{
    if(Number(request.headers.get("content-length"))>64000)throw new Error();
    const text=await request.text();if(text.length>64000)throw new Error();
    input=JSON.parse(text);
    if(!input||!["currentlyReading","tbr"].includes(input.section)||!input.entry)throw new Error();
  }catch{return Response.json({error:"書目資料無效。"},{status:400});}
  let disconnected=false;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const send=(event:BookAddEvent)=>{if(!disconnected)try{controller.enqueue(encoder.encode(JSON.stringify(event)+"\n"));}catch{disconnected=true;}};
      try{
        const result=await collectBenchTrace(()=>runBookAdd(input,send),event=>send({type:"trace",event}));
        if(result.success){revalidatePath("/");revalidatePath("/admin/bench");}
        const terminal={...result};delete terminal.diagnostics;send(terminal);
      }catch{send({type:"result",success:false,error:"處理未完成；請重新載入書架確認結果後重試。"});}
      finally{if(!disconnected)try{controller.close();}catch{disconnected=true;}}
    },cancel(){disconnected=true;},
  });
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"}});
}
