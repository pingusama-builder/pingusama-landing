export interface BenchEvent { at: string; operation: string; status: string; data: Record<string,string|number|boolean>; }
const key = "pingu-bench-diagnostics-v1";
let memory: BenchEvent[] = [];
const fields = new Set(["isbn","provider","code","durationMs","count","warnings","width","height","bytes","format","httpStatus","force","page"]);
export function safeEvent(operation:string,status:string,data:Record<string,unknown>={}):BenchEvent {
  const clean:BenchEvent["data"]={};
  for(const [k,v] of Object.entries(data)) if(fields.has(k)) {
    if(typeof v==="number" && Number.isFinite(v) || typeof v==="boolean") clean[k]=v;
    else if(typeof v==="string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v) && (k!=="isbn" || /^\d{13}$/.test(v))) clean[k]=v;
  }
  const label=(s:string)=>/^[a-zA-Z0-9_.-]{1,60}$/.test(s)?s:"unknown";
  return {at:new Date().toISOString(),operation:label(operation),status:label(status),data:clean};
}
export function readBenchEvents():BenchEvent[] {
  try { const saved=JSON.parse(sessionStorage.getItem(key)||"[]");
    if(Array.isArray(saved)) return saved.slice(-200).filter(e=>e&&typeof e.operation==="string"&&typeof e.status==="string").map(e=>({...safeEvent(e.operation,e.status,e.data??{}),at:typeof e.at==="string"&&/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(e.at)?e.at:new Date().toISOString()}));
  } catch {} return memory;
}
export function recordBenchEvent(operation:string,status:string,data:Record<string,unknown>={}) {
  memory=[...readBenchEvents(),safeEvent(operation,status,data)].slice(-200);
  try {sessionStorage.setItem(key,JSON.stringify(memory));} catch {}
}
export function clearBenchEvents(){memory=[];try{sessionStorage.removeItem(key);}catch{}}
export async function diagnoseBench<T extends {success:boolean}>(operation:string,work:()=>Promise<T>):Promise<T> {
  const start=Date.now();recordBenchEvent(operation,"started");
  try {const result=await work();
    const trace=(result as T&{diagnostics?:BenchEvent[]}).diagnostics;
    if(Array.isArray(trace)) for(const e of trace) recordBenchEvent(e.operation,e.status,e.data);
    recordBenchEvent(operation,result.success?"success":"failed",{durationMs:Date.now()-start,code:result.success?"ok":"action_rejected"});return result;
  } catch(error) {recordBenchEvent(operation,"failed",{durationMs:Date.now()-start,code:"transport_or_unhandled"});throw error;}
}
