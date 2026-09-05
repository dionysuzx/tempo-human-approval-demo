import test from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Delivery,deliveryServer} from '../approval/delivery.mjs';
import {nativeBytes} from '../approval/native.mjs';
import {fingerprint,encode} from '../approval/webauthn.mjs';
import {requestFor,message} from '../approval/policy.mjs';
async function fixture(fail=false,number=2){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const current={repository:'dionysuzx/tempo-human-approval-demo',repositoryId:42,pr:number,head:'a'.repeat(40),base:'b'.repeat(40)};
 const request=requestFor(current,1000);
 const proof={version:'plain-text-native/v1',origin:'http://localhost:8787',requestID:encode(new Uint8Array(32).fill(1)),nonce:encode(new Uint8Array(32).fill(2)),expiresAt:new Date(200000).toISOString(),message:message(request),publicKeySpki:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url')};
 proof.signature=sign('sha256',nativeBytes(proof),keys.privateKey).toString('base64url');
 const calls=[];
 const api={latest:async()=>({status:'in_progress',head_sha:current.head,external_id:`signed-proof:${number}:${request.id}`,output:{text:JSON.stringify(request)}}),call:async(path,method,body)=>{
  if(path==='')return {id:42,full_name:current.repository};
  if(path===`/pulls/${number}`)return {number,state:'open',head:{sha:current.head},base:{ref:'main',sha:current.base,repo:{id:42}}};
  if(path==='/git/ref/heads/main')return {object:{sha:current.base}};
  if(path===`/issues/${number}/comments`){calls.push(body);if(fail)throw Error('Network outcome unknown');return {html_url:'https://github.com/dionysuzx/tempo-human-approval-demo/pull/2#issuecomment-1'};}
  throw Error('Unexpected destination');
 }};
 const db=new DatabaseSync(':memory:');
 const delivery=new Delivery(api,{nativePrs:[2,3],nativeSigner:{fingerprint:await fingerprint(proof.publicKeySpki),origin:proof.origin}},db,()=>2000);
 return {proof,calls,delivery,db};
}
test('delivery verifies native proof and posts once despite concurrent retries',async()=>{
 const x=await fixture();try{
  const results=await Promise.allSettled([x.delivery.deliver(x.proof),x.delivery.deliver(x.proof)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.calls.length,1);
  assert.equal(JSON.parse(x.calls[0].body).message,x.proof.message);
 }finally{x.db.close();}
});
test('ambiguous delivery failure remains reserved and is not retried',async()=>{
 const x=await fixture(true);try{
  await assert.rejects(x.delivery.deliver(x.proof),/Network/);await assert.rejects(x.delivery.deliver(x.proof),/uncertain/);assert.equal(x.calls.length,1);
 }finally{x.db.close();}
});
test('untrusted native proof never gets posted',async()=>{
 const x=await fixture();try{x.proof.message+='tampered';await assert.rejects(x.delivery.deliver(x.proof));assert.equal(x.calls.length,0);}finally{x.db.close();}
});
test('delivery HTTP rejects other origins and endpoints before credentials are used',async()=>{
 let called=false;const http=deliveryServer({deliver:async()=>{called=true;return {};}});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${http.address().port}`;
 try{
  const post=(path,origin)=>new Promise((resolve,reject)=>{const req=httpRequest(url+path,{method:'POST',headers:{Host:'localhost:8792',Origin:origin,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});
  assert.equal(await post('/deliver','https://evil.test'),403);
  assert.equal(await post('/other','http://localhost:8787'),404);
  assert.equal(called,false);
 }finally{await new Promise(resolve=>http.close(resolve));}
});

test('recording PR3 uses its own exact request and delivery destination',async()=>{const x=await fixture(false,3);try{await x.delivery.deliver(x.proof);assert.equal(x.calls.length,1);assert.match(JSON.parse(x.calls[0].body).message,/Pull request: #3/);}finally{x.db.close();}});
