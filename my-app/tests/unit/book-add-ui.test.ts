import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import BenchEditor from "@/components/BenchEditor";
function render(){
 return renderToStaticMarkup(createElement(BenchEditor,{
  initialShelf:{currentlyReading:[{isbn13:"9780307473394",note:"reading"}],tbr:[{isbn13:"",note:""}]},initialVault:{clips:[]},initialBookStatuses:[],
  saveShelf:async()=>({success:true as const}),saveVault:async()=>({success:true as const}),warmBooks:async()=>({success:true as const,results:[],statuses:[]}),
 }));
}
it("keeps independent book confirmation and shelf saving visible in both sections",()=>{
 const html=render();expect(html.match(/確認 Add book/g)).toHaveLength(2);expect(html).toContain("Save shelf");expect(html).toContain("Currently reading");expect(html).toContain("To be read");
});
it("requires book details before enabling confirmation for an empty row",()=>{
 const confirmations=[...render().matchAll(/<button\b[^>]*>確認 Add book<\/button>/g)].map(value=>value[0]);
 expect(confirmations[0]).not.toContain('disabled=""');expect(confirmations[1]).toContain('disabled=""');
});
