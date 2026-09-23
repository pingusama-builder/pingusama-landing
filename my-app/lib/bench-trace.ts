import { AsyncLocalStorage } from "node:async_hooks";
import { safeEvent, type BenchEvent } from "./bench-diagnostics";
const scope=new AsyncLocalStorage<BenchEvent[]>();
export function traceBench(operation:string,status:string,data:Record<string,unknown>={}) {const events=scope.getStore();if(events&&events.length<100)events.push(safeEvent(operation,status,data));}
export async function collectBenchTrace<T extends {success:boolean}>(work:()=>Promise<T>):Promise<T&{diagnostics?:BenchEvent[]}> {
  const events:BenchEvent[]=[];
  const result=await scope.run(events,work);
  return {...result,...(events.length?{diagnostics:events}:{})};
}
