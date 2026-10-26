export interface BenchEvent{at:string;operation:string;status:string;data:Record<string,string|number|boolean>;}
export const BENCH_EVENT_LIMIT=500;
const key="pingu-bench-diagnostics-v1";
let memory:BenchEvent[]=[];
const fields=new Set(["isbn","provider","code","durationMs","count","warnings","width","height","bytes","format","httpStatus","force","page","runId","market","strategy","kind","rank","score","sourcePage","imageUrl","query"]);
function publicLogUrl(value:string):string|null{
 try{const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.port||!url.hostname.includes(".")||/^[\d.]+$|:|(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname))return null;url.search="";url.hash="";return url.toString().slice(0,1500);}catch{return null;}
}
export function safeEvent(operation:string,status:string,data:Record<string,unknown>={}):BenchEvent{
 const clean:BenchEvent["data"]={};
 for(const[k,v]of Object.entries(data))if(fields.has(k)){
  if(k==="sourcePage"||k==="imageUrl"){if(typeof v==="string"){const value=publicLogUrl(v);if(value)clean[k]=value;}}
  else if(k==="query"){if(typeof v==="string")clean[k]=v.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,500);}
  else if(typeof v==="number"&&Number.isFinite(v)||typeof v==="boolean")clean[k]=v;
  else if(typeof v==="string"&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v)&&(k!=="isbn"||/^\d{13}$/.test(v)))clean[k]=v;
 }
 const label=(value:string)=>/^[a-zA-Z0-9_.-]{1,60}$/.test(value)?value:"unknown";
 return{at:new Date().toISOString(),operation:label(operation),status:label(status),data:clean};
}
export function readBenchEvents():BenchEvent[]{
 try{
  const saved=JSON.parse(sessionStorage.getItem(key)||"[]");
  if(Array.isArray(saved))return saved.slice(-BENCH_EVENT_LIMIT).filter(event=>event&&typeof event.operation==="string"&&typeof event.status==="string").map(event=>({...safeEvent(event.operation,event.status,event.data??{}),at:typeof event.at==="string"&&/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(event.at)?event.at:new Date().toISOString()}));
 }catch{}
 return memory;
}
export function recordBenchEvent(operation:string,status:string,data:Record<string,unknown>={}){
 memory=[...readBenchEvents(),safeEvent(operation,status,data)].slice(-BENCH_EVENT_LIMIT);
 try{sessionStorage.setItem(key,JSON.stringify(memory));}catch{}
}
export function clearBenchEvents(){memory=[];try{sessionStorage.removeItem(key);}catch{}}
export async function diagnoseBench<T extends{success:boolean}>(operation:string,work:()=>Promise<T>):Promise<T>{
 const start=Date.now();recordBenchEvent(operation,"started");
 try{
  const result=await work(),trace=(result as T&{diagnostics?:BenchEvent[]}).diagnostics;
  if(Array.isArray(trace))for(const event of trace)recordBenchEvent(event.operation,event.status,event.data);
  recordBenchEvent(operation,result.success?"success":"failed",{durationMs:Date.now()-start,code:result.success?"ok":"action_rejected"});return result;
 }catch(error){recordBenchEvent(operation,"failed",{durationMs:Date.now()-start,code:"transport_or_unhandled"});throw error;}
}
