import { afterEach, describe, expect, it, vi } from "vitest";
import { safeEvent, recordBenchEvent, readBenchEvents, clearBenchEvents, diagnoseBench } from "@/lib/bench-diagnostics";
import { collectBenchTrace, traceBench } from "@/lib/bench-trace";
describe("bounded export diagnostics",()=>{
 afterEach(()=>{clearBenchEvents();vi.unstubAllGlobals();});
 it("drops arbitrary content and secrets rather than exporting raw errors",()=>{
  const event=safeEvent("cover.http","failed",{isbn:"9789865580704",provider:"google",error:"secret",url:"https://example.com/?token=secret",code:"message with secret",note:"private"});
  expect(event.data).toEqual({isbn:"9789865580704",provider:"google"});
 });
 it("keeps only 200 events and survives reading session storage",()=>{
  const storage=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  for(let i=0;i<205;i++)recordBenchEvent("test","ok",{count:i});
  expect(readBenchEvents()).toHaveLength(200);expect(readBenchEvents()[0].data.count).toBe(5);
  clearBenchEvents();expect(readBenchEvents()).toEqual([]);
 });
 it("records transport failure without raw thrown text",async()=>{
  await expect(diagnoseBench("shelf.save",async()=>{throw new Error("secret");})).rejects.toThrow("secret");
  expect(readBenchEvents().at(-1)?.data.code).toBe("transport_or_unhandled");expect(JSON.stringify(readBenchEvents())).not.toContain("secret");
 });
 it("isolates concurrent request traces",async()=>{
  const run=(count:number)=>collectBenchTrace(async()=>{traceBench("search.provider","completed",{count});await Promise.resolve();return {success:true};});
  const [a,b]=await Promise.all([run(1),run(2)]);
  expect(a.diagnostics?.map(e=>e.data.count)).toEqual([1]);expect(b.diagnostics?.map(e=>e.data.count)).toEqual([2]);
 });
});
