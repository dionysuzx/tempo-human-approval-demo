import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleNative } from './lib/native-bridge/http.mjs';
const files = new Map([
  ['/native',['./index.html','text/html']],
  ['/app.mjs',['./app.mjs','text/javascript']],
  ['/links.mjs',['../relay-site/lib/links.mjs','text/javascript']],
  ['/receipt.mjs',['./receipt.mjs','text/javascript']],
]);
export function macServer() {
  return createServer(async(req,res)=>{
    if(req.headers.host !== 'localhost:8787') {res.writeHead(403);return res.end();}
    const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' http://localhost:8792; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
    try {
      if(req.method==='GET' && files.has(req.url)) {
        const [path,type]=files.get(req.url);
        res.writeHead(200,{...headers,'Content-Type':type});return res.end(readFileSync(new URL(path,import.meta.url)));
      }
      const response=await handleNative(new Request('http://localhost:8787'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})}));
      res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(400,headers);res.end('Invalid request');}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))macServer().listen(8787,'localhost',()=>console.log('Mac relay ready at http://localhost:8787/native'));
