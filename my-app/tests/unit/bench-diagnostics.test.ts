import { afterEach, describe, expect, it, vi } from "vitest";
import { safeEvent, recordBenchEvent, readBenchEvents, clearBenchEvents, diagnoseBench } from "@/lib/bench-diagnostics";
import { collectBenchTrace, traceBench } from "@/lib/bench-trace";
describe("bounded export diagnostics",()=>{
 afterEach(()=>{clearBenchEvents();vi.unstubAllGlobals();});
 it("drops arbitrary content and secrets rather than exporting raw errors",()=>{
  const event=safeEvent("cover.http","failed",{isbn:"9789865580704",provider:"google",error:"secret",url:"https://example.com/?token=secret",code:"message with secret",note:"private"});
  expect(event.data).toEqual({isbn:"9789865580704",provider:"google"});
 });
 it("keeps only 500 events and survives reading session storage",()=>{
  const storage=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>storage.get(k),setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  for(let i=0;i<505;i++)recordBenchEvent("test","ok",{count:i});
  expect(readBenchEvents()).toHaveLength(500);expect(readBenchEvents()[0].data.count).toBe(5);
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

it("exports regional evidence while stripping tracking credentials and private fields",()=>{const event=safeEvent("cover.candidate","selected",{isbn:"9780241968628",market:"uk",kind:"publisher",rank:5,score:440,runId:"run-1",sourcePage:"https://www.penguin.co.uk/books/1/title/9780241968628?token=secret#private",query:'"9780241968628" UK book cover publisher',note:"private note",Authorization:"Bearer secret"});expect(event.data).toMatchObject({market:"uk",kind:"publisher",rank:5,sourcePage:"https://www.penguin.co.uk/books/1/title/9780241968628"});expect(JSON.stringify(event)).not.toContain("secret");expect(JSON.stringify(event)).not.toContain("private");});
it("gives simultaneous server runs separate correlation identifiers",async()=>{const run=()=>collectBenchTrace(async()=>{traceBench("cover.route","started");return{success:true};});const[a,b]=await Promise.all([run(),run()]);expect(a.diagnostics?.[0].data.runId).toBeTruthy();expect(a.diagnostics?.[0].data.runId).not.toBe(b.diagnostics?.[0].data.runId);});
