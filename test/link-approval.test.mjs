import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFor, message, acceptProof, parseComment, signingLink } from '../approval/policy.mjs';
import { fingerprint } from '../approval/webauthn.mjs';
import { fixture } from './proof-fixture.mjs';
import { run } from '../approval/run.mjs';
const current = {repository:'owner/demo',repositoryId:42,pr:1,head:'a'.repeat(40),base:'b'.repeat(40)};
async function sample() {
  const request = requestFor(current, 1000);
  const proof = await fixture(message(request));
  const config = {signingSite:'http://localhost:8787/',signer:{fingerprint:await fingerprint(proof.publicKeySpki),origin:proof.origin,credentialId:proof.credentialId}};
  return {request,proof,config};
}
test('real WebAuthn signature proof authorizes exact request',async()=>{
  const x=await sample(); assert.equal((await acceptProof(x.proof,x.request,current,x.config,2000)).state,'approved');
});
for (const [name,edit] of [
  ['unconfigured signer',x=>x.config.signer=null],
  ['wrong pinned signer',x=>x.config.signer.fingerprint='sha256:wrong'],
  ['wrong origin',x=>x.config.signer.origin='https://elsewhere.test'],
  ['expired',x=>x.now=901000],['future',x=>x.now=999],
  ['replayed',x=>x.request.state='approved'],
  ['changed head',x=>x.current.head='c'.repeat(40)],['changed base',x=>x.current.base='c'.repeat(40)],
  ['other PR',x=>x.current.pr=2],['other repo id',x=>x.current.repositoryId=43],
  ['other request',x=>x.request.id='different'],
]) test(`link proof rejects ${name}`,async()=>{
  const x={...await sample(),current:{...current},now:2000}; edit(x);
  await assert.rejects(acceptProof(x.proof,x.request,x.current,x.config,x.now));
});
test('prefill preserves exact bytes and proof comment parser accepts JSON fence',async()=>{
  const x=await sample(); const link=new URL(signingLink('http://localhost:8787/',x.request));
  assert.equal(new URLSearchParams(link.hash.slice(1)).get('message'),message(x.request));
  assert.deepEqual(parseComment('```json\n'+JSON.stringify(x.proof)+'\n```'),x.proof);
});
test('workflow adapter issues challenge then consumes proof once',async()=>{
  let check, commentBody; const comments=[];
  const api={latest:async()=>check,call:async(path,method='GET',body)=>{
    if(path==='/git/ref/heads/main')return {object:{sha:current.base}};
    if(path==='')return {id:42,full_name:'owner/demo'};
    if(path==='/pulls/1')return {number:1,state:'open',head:{sha:current.head},base:{sha:current.base,ref:'main',repo:{id:42}}};
    if(path==='/check-runs' && method==='POST'){check={...body,id:5,head_sha:current.head};return check;}
    if(path==='/issues/1/comments'){comments.push(body.body);return {};}
    if(path==='/issues/comments/8')return {id:8,body:commentBody,html_url:'https://github.com/owner/demo/pull/1#issuecomment-8'};
    if(path==='/check-runs/5' && method==='PATCH'){check={...check,...body};return check;}
    throw Error('Unexpected boundary call '+path);
  }};
  const config={signingSite:'http://localhost:8787/',signer:null};
  await run(api,{pull_request:{number:1}},config,1000);
  assert.equal(check.status,'in_progress'); assert.match(comments[0],/Set up Native Signing Bridge/);
  const proof=await fixture(message(JSON.parse(check.output.text)));
  config.signer={fingerprint:await fingerprint(proof.publicKeySpki),origin:proof.origin,credentialId:proof.credentialId};
  commentBody=JSON.stringify(proof);
  await run(api,{issue:{number:1,pull_request:{}},comment:{id:8}},config,2000);
  assert.equal(check.conclusion,'success'); assert.equal(JSON.parse(check.output.text).commentId,8);
  await assert.rejects(run(api,{issue:{number:1,pull_request:{}},comment:{id:8}},config,3000),/replay rejected/);
  assert.equal(check.conclusion,'success');
});

for (const number of [1,3,1001]) test(`new PR ${number} automatically receives native signing link`, async()=>{
 const comments=[]; let check;
 const api={latest:async()=>null,call:async(path,method,body)=>{
  if(path==='')return {id:42,full_name:'owner/demo'};
  if(path===`/pulls/${number}`)return {number,state:'open',head:{sha:current.head},base:{ref:'main',sha:current.base,repo:{id:42}}};
  if(path==='/git/ref/heads/main')return {object:{sha:current.base}};
  if(path==='/check-runs'){check={...body,id:9};return check;}
  if(path===`/issues/${number}/comments`){comments.push(body.body);return {id:10};}
  if(path==='/check-runs/9')return {};
  throw Error('Unexpected destination '+path);
 }};
 await run(api,{pull_request:{number}},{signingSite:'http://localhost:8787/',nativeSigner:{fingerprint:'registered'}},1000);
 assert.match(comments[0],/Open Mac app/);
 assert.doesNotMatch(comments[0],/Open the signing page|copy the proof/);
 const link=new URL(comments[0].match(/\[Open Native Signing Bridge\]\(([^)]+)\)/)[1]);
 assert.equal(link.pathname,'/native');
 const fragment=new URLSearchParams(link.hash.slice(1));
 assert.equal(fragment.get('deliver'),'http://localhost:8792/deliver');
 assert.equal(fragment.get('message'),message(JSON.parse(check.output.text)));
});
