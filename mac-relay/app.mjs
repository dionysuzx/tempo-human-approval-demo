import { approvalLink } from '/links.mjs';
import { returnDestination } from '/receipt.mjs';
const status=document.querySelector('#status'),button=document.querySelector('#approve');
let request;
try {request=approvalLink(location.hash);document.querySelector('#message').textContent=request.message;document.querySelector('#pr').href=request.githubURL;button.disabled=false;}
catch(error){status.textContent=error.message;}
async function json(url,options){const response=await fetch(url,{cache:'no-store',...options});const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');return value;}
button.addEventListener('click',async()=>{
 button.disabled=true;
 try {
  const ready=await json('http://localhost:8792/status');if(ready.ready!==true)throw Error('Enroll your Mac key and start its delivery service first.');
  const pending=await json('/native/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:request.message})});
  // Only the local server constructs the custom-scheme launch URL.
  if(!/^hardwaresigningbridge:\/\/approve\?request=[A-Za-z0-9_-]{43}$/.test(pending.launchURL))throw Error('Invalid app launch');
  location.assign(pending.launchURL);status.textContent='Review the message in Native Signing Bridge and approve with Touch ID.';
  while(Date.now()<Date.parse(pending.expiresAt)) {
   await new Promise(resolve=>setTimeout(resolve,1000));
   const result=await json('/native/result/'+pending.requestID,{headers:{'X-Result-Token':pending.resultToken}});
   if(result.status!=='completed')continue;
   document.querySelector('#proof').value=JSON.stringify(result.proof,null,2);
   try {
    const receipt=await json('http://localhost:8792/deliver',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proof:result.proof})});
    const destination=returnDestination(receipt,request);
    status.textContent='Proof delivered. Returning to GitHub…';location.replace(destination);return;
   } catch(error){document.querySelector('#fallback').hidden=false;throw error;}
  }
  throw Error('Request expired. Open a fresh link.');
 } catch(error){status.textContent=error.message;button.disabled=false;}
});
