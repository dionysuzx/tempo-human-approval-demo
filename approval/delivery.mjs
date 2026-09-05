import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from './run.mjs';
import { snapshot, acceptProof } from './policy.mjs';
const REPO = 'dionysuzx/tempo-human-approval-demo';
class CLIAPI extends API {
  constructor() { super(REPO, ''); }
  async call(path, method='GET', body) {
    const args=['api','--method',method,`repos/${REPO}${path}`];
    if(body!==undefined)args.push('--input','-');
    const output=execFileSync('gh',args,{input:body===undefined?undefined:JSON.stringify(body),encoding:'utf8',timeout:20000,maxBuffer:2_000_000});
    return output.trim()?JSON.parse(output):null;
  }
}
export class Delivery {
  constructor(api, config, db, clock=Date.now) {
    Object.assign(this,{api,config,db,clock}); this.queue=Promise.resolve();
    db.exec('CREATE TABLE IF NOT EXISTS delivery (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, url TEXT)');
  }
  deliver(proof) {
    const operation=this.queue.then(()=>this.post(proof));this.queue=operation.catch(()=>{});return operation;
  }
  async post(proof) {
    if(proof?.version!=='plain-text-native/v1')throw Error('This delivery route accepts native proofs only');
    const pr=await this.api.call('/pulls/2');
    const repo=await this.api.call('');
    const base=await this.api.call('/git/ref/heads/main');
    const current=snapshot(repo,{...pr,base:{...pr.base,sha:base.object.sha}});
    const check=await this.api.latest(current.head,2);
    if(!check)throw Error('No current approval request; refresh the PR signing link');
    const request=JSON.parse(check.output.text);
    if(check.external_id!==`signed-proof:2:${request.id}` || check.head_sha!==request.head)throw Error('Invalid request record');
    const existing=this.db.prepare('SELECT * FROM delivery WHERE request_id=?').get(request.id);
    if(existing)throw Error(existing.status==='posted'?'This request was already delivered; check the PR.':'Delivery outcome uncertain; check the PR before retrying.');
    if(check.status==='completed')throw Error('Approval request already completed');
    await acceptProof(proof,request,current,this.config,this.clock());
    this.db.prepare('INSERT INTO delivery VALUES (?, ?, NULL)').run(request.id,'reserved');
    // Reserve before network write: ambiguous failures never create blind duplicate comments.
    const comment=await this.api.call('/issues/2/comments','POST',{body:JSON.stringify(proof,null,2)});
    this.db.prepare("UPDATE delivery SET status='posted',url=? WHERE request_id=?").run(comment.html_url,request.id);
    return {posted:true,url:comment.html_url};
  }
}
export function deliveryServer(delivery) {
 return createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.headers.host!=='localhost:8792' || req.headers.origin!=='http://localhost:8787')return send(403,{error:'Untrusted origin'});
  res.setHeader('Access-Control-Allow-Origin','http://localhost:8787');res.setHeader('Vary','Origin');
  if(req.url==='/status' && req.method==='GET')return send(200,{ready:!!delivery.config?.nativeSigner?.fingerprint,reason:delivery.config?.nativeSigner?.fingerprint?undefined:'Register your native signing key before approving.',repository:REPO,pullRequest:2,signerFingerprint:delivery.config?.nativeSigner?.fingerprint});
  if(!['/deliver','/deliver/2'].includes(req.url))return send(404,{error:'Unknown delivery target'});
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);return res.end();}
  if(req.method!=='POST' || req.headers['content-type']!=='application/json')return send(415,{error:'Use a JSON POST'});
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>96000)return send(413,{error:'Proof too large'});}
   send(200,await delivery.deliver(JSON.parse(body).proof));
  }catch(error){send(409,{error:error.message});}
 });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);mkdirSync('.state',{recursive:true,mode:0o700});
 const config=JSON.parse(readFileSync(new URL('./config.json',import.meta.url)));
 const delivery=new Delivery(new CLIAPI(),config,new DatabaseSync('.state/delivery.sqlite'));
 deliveryServer(delivery).listen(8792,'localhost',()=>console.log('Native proof delivery ready for demo PR #2 on localhost:8792'));
}
