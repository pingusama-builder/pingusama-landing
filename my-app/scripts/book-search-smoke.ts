import { config } from "dotenv";
import { searchBooks, type BookSearchInput } from "../lib/book-search";
config({path:".env.local",quiet:true});
const cases:BookSearchInput[]=[{isbn:"9789865580704",title:"ZOO",author:"乙一",language:"zh-Hant"},{title:"Deep Work",author:"Cal Newport",language:"en"},{isbn:"9787020114115",title:"动物园",author:"乙一",language:"zh-Hans"}];
async function main(){
 console.log(JSON.stringify({configured:{google:!!process.env.GOOGLE_BOOKS_API_KEY,tavily:!!process.env.TAVILY_API_KEY}}));
 for(const input of cases.filter(c=>!process.argv[2]||c.language===process.argv[2])){const start=Date.now();const r=await searchBooks(input);console.log(JSON.stringify({input,ms:Date.now()-start,candidates:r.candidates.map(c=>({title:c.book.title,isbn:c.book.isbn13,source:c.source,match:c.match,language:c.language})),leads:r.leads,warnings:r.warnings}));}
}
main().catch(()=>{console.error("Book search smoke failed.");process.exitCode=1;});
