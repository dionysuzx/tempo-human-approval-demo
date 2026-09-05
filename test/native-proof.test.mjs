import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { nativeBytes, verifyNative } from '../approval/native.mjs';
import { fingerprint, encode } from '../approval/webauthn.mjs';
import { acceptProof,requestFor,message } from '../approval/policy.mjs';
const current={repository:'owner/demo',repositoryId:1,pr:1,head:'a'.repeat(40),base:'b'.repeat(40)};
async function fixture(){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const request=requestFor(current,1000);
 const proof={version:'plain-text-native/v1',origin:'http://localhost:8787',requestID:encode(new Uint8Array(32).fill(1)),nonce:encode(new Uint8Array(32).fill(2)),expiresAt:new Date(200000).toISOString(),message:message(request),publicKeySpki:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url')};
 proof.signature=sign('sha256',nativeBytes(proof),keys.privateKey).toString('base64url');
 return {proof,request,trusted:{fingerprint:await fingerprint(proof.publicKeySpki),origin:proof.origin}};
}
test('native distinct signature clears exact-action policy with separately pinned key',async()=>{
 const x=await fixture();const result=await acceptProof(x.proof,x.request,current,{nativeSigner:x.trusted},2000);assert.equal(result.proofKind,'native');
});
for(const [name,edit] of [['wrong pin',x=>x.trusted.fingerprint='sha256:wrong'],['changed message',x=>x.proof.message+='!'],['changed nonce',x=>x.proof.nonce=encode(new Uint8Array(32))],['changed expiry',x=>x.proof.expiresAt=new Date(300000).toISOString()],['expired',x=>x.now=200001],['unregistered',x=>x.trusted=null]])test(`native rejects ${name}`,async()=>{
 const x={...await fixture(),now:2000};edit(x);await assert.rejects(verifyNative(x.proof,x.trusted,x.now));
});
