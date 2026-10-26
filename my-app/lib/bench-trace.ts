import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import {safeEvent,type BenchEvent} from "./bench-diagnostics";
const scope=new AsyncLocalStorage<{runId:string;events:BenchEvent[];onEvent?:(event:BenchEvent)=>void}>();
export function traceBench(operation:string,status:string,data:Record<string,unknown>={}){
 const current=scope.getStore();
 if(current&&current.events.length<200){const event=safeEvent(operation,status,{...data,runId:current.runId});current.events.push(event);current.onEvent?.(event);}
}
export async function collectBenchTrace<T extends{success:boolean}>(work:()=>Promise<T>,onEvent?:(event:BenchEvent)=>void):Promise<T&{diagnostics?:BenchEvent[]}>{
 const events:BenchEvent[]=[];
 const result=await scope.run({runId:randomUUID(),events,onEvent},work);
 return{...result,...(events.length?{diagnostics:events}:{})};
}
