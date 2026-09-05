import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,sign } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { requestFor,message,acceptProof } from '../approval/policy.mjs';
import { nativeBytes } from '../approval/native.mjs';
import { fingerprint } from '../approval/webauthn.mjs';
import { deliver,Ledger,confirmedDestination,trustedConfiguration,handleDelivery,REPOSITORY } from '../relay-site/lib/delivery.mjs';
import { approvalLink } from '../relay-site/lib/links.mjs';
import { returnDestination } from '../mac-relay/receipt.mjs';
const current={repository:REPOSITORY,repositoryId:42,pr:6,head:'a'.repeat(40),base:'b'.repeat(40)};
async function fixture() {
 const request=requestFor(current,1000);
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const proof={version:'plain-text-native/v1',origin:'https://approval.example',requestID:Buffer.alloc(32,1).toString('base64url'),nonce:Buffer.alloc(32,2).toString('base64url'),expiresAt:new Date(200000).toISOString(),message:message(request),publicKeySpki:keys.publicKey.export({format:'der',type:'spki'}).toString('base64url')};
 proof.signature=sign('sha256',nativeBytes(proof),keys.privateKey).toString('base64url');
 const config={iphoneSigner:{origin:proof.origin,fingerprint:await fingerprint(proof.publicKeySpki)}};
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../relay-site/drizzle/0000_elite_nightshade.sql',import.meta.url),'utf8'));
 // Real SQLite behind the D1 external boundary; no in-memory imitation of the ledger.
 const d1={prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),run:async()=>({meta:db.prepare(sql).run(...args)})};}};}};
 let posts=0,fail=false;
 const api={latest:async()=>({head_sha:current.head,external_id:`signed-proof:6:${request.id}`,output:{text:JSON.stringify(request)},status:'in_progress'}),call:async(path,method,body)=>{
  if(path==='')return {id:42,full_name:REPOSITORY};
  if(path==='/pulls/6')return {number:6,state:'open',head:{sha:current.head},base:{sha:current.base,ref:'main',repo:{id:42}}};
  if(path==='/git/ref/heads/main')return {object:{sha:current.base}};
  if(path==='/issues/6/comments'&&method==='POST'){posts++;if(fail)throw Error('Ambiguous network failure');assert.deepEqual(JSON.parse(body.body),proof);return {html_url:`https://github.com/${REPOSITORY}/pull/6#issuecomment-123`};}
  throw Error('Unexpected '+path);
 }};
 return {request,proof,config,api,ledger:new Ledger(d1),db,posts:()=>posts,fail:()=>{fail=true;}};
}
test('separately enrolled iPhone authorizes exact action; Mac enrollment does not imply iPhone enrollment',async()=>{
 const x=await fixture();assert.equal((await acceptProof(x.proof,x.request,current,x.config,2000)).state,'approved');
 await assert.rejects(acceptProof(x.proof,x.request,current,{nativeSigner:{...x.config.iphoneSigner,origin:'http://localhost:8787'}},2000));x.db.close();
});
for(const [name,edit] of [ ['revoked',x=>x.config.iphoneSigner=null],['wrong key',x=>x.config.iphoneSigner.fingerprint='sha256:unknown'],['changed request',x=>x.request.id='changed'],['changed base',x=>x.request.base='c'.repeat(40)],['changed head',x=>x.request.head='c'.repeat(40)],['changed action',x=>x.proof.message+='!'] ])test('relay rejects '+name+' without posting',async()=>{const x=await fixture();edit(x);await assert.rejects(deliver(x.proof,x.api,x.ledger,x.config,2000));assert.equal(x.posts(),0);x.db.close();});
test('concurrent delivery posts once and identical retries return only the confirmed destination',async()=>{
 const x=await fixture();const results=await Promise.allSettled([deliver(x.proof,x.api,x.ledger,x.config,2000),deliver(x.proof,x.api,x.ledger,x.config,2000)]);assert.equal(x.posts(),1);assert(results.some(r=>r.status==='fulfilled'));
 const receipt=await deliver(x.proof,x.api,x.ledger,x.config,2000);assert.equal(receipt.returnURL,`https://github.com/${REPOSITORY}/pull/6#issuecomment-123`);x.db.close();
});
test('uncertain network write stays reserved; retry cannot post again',async()=>{const x=await fixture();x.fail();await assert.rejects(deliver(x.proof,x.api,x.ledger,x.config,2000));await assert.rejects(deliver(x.proof,x.api,x.ledger,x.config,2000));assert.equal(x.posts(),1);x.db.close();});
test('untrusted return destinations, other PRs and unconfirmed receipts rejected by Mac and relay',()=>{
 const request={githubURL:`https://github.com/${REPOSITORY}/pull/6`};
 for(const url of ['https://evil.test',request.githubURL+'#issuecomment-1?next=evil',`https://github.com/${REPOSITORY}/pull/7#issuecomment-1`,request.githubURL+'#issuecomment-0']){assert.throws(()=>confirmedDestination(6,url));assert.throws(()=>returnDestination({posted:true,url},request));}
 assert.throws(()=>returnDestination({posted:false,url:request.githubURL+'#issuecomment-1'},request));
});
test('entry drops caller return and delivery URLs and preserves exact message',()=>{const text=message(requestFor(current,1000));const link=approvalLink('#'+new URLSearchParams({message:text,deliver:'https://evil.test',return:'https://evil.test'}));assert.equal(link.message,text);assert.equal(new URL(link.macURL).origin,'http://localhost:8787');assert(!link.macURL.includes('evil'));assert.throws(()=>approvalLink('#message=a&message=b'));});
test('trusted config reads main and applies owner revocation; permissions errors fail closed',async()=>{
 const x=await fixture();const calls=[];
 const api={call:async path=>{calls.push(path);if(path.startsWith('/contents/'))return {encoding:'base64',content:Buffer.from(JSON.stringify(x.config)).toString('base64')};return {variables:[{name:'NATIVE_SIGNER_REVOKED',value:'true'}]};}};
 assert.equal((await trustedConfiguration(api)).iphoneSigner,null);assert(calls[0].endsWith('?ref=main'));
 await assert.rejects(trustedConfiguration({call:async path=>{if(path.startsWith('/contents/'))return {encoding:'base64',content:Buffer.from('{}').toString('base64')};throw Error('403');}}));x.db.close();
});
test('HTTPS delivery rejects foreign browser origin and unconfigured service before writes',async()=>{
 const env={APPROVAL_ORIGIN:'https://approval.example'};
 assert.equal((await handleDelivery(new Request('https://approval.example/api/deliver',{method:'POST',headers:{origin:'https://evil.test'}}),env)).status,403);
 assert.equal((await handleDelivery(new Request('https://approval.example/api/deliver',{method:'POST'}),env)).status,503);
});
test('Mac local relay serves fixed entry and rejects remote Host headers',async()=>{
 const {macServer}=await import('../mac-relay/server.mjs');const {request:httpRequest}=await import('node:http');const server=macServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const origin='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(origin+'/native')).status,403);
  const page=await new Promise((resolve,reject)=>{const req=httpRequest(origin+'/native',{headers:{Host:'localhost:8787'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});assert.equal(page.status,200);assert.match(page.body,/Open Mac app/);
  const foreign=await fetch(origin+'/native/request',{method:'POST',headers:{host:'localhost:8787',origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
