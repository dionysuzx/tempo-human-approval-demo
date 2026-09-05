// Deliberately administrative: uses the operator's authenticated gh CLI. Never run from PR input.
import { execFileSync } from 'node:child_process';
const kind=process.argv[2];
if(!['browser','native'].includes(kind))throw Error('Use npm run revoke -- browser OR npm run revoke -- native');
const repo='dionysuzx/tempo-human-approval-demo';
const api=(args,input)=>execFileSync('gh',['api',...args],{input,encoding:'utf8'});
const protection=JSON.parse(api([`repos/${repo}/branches/main/protection`]));
// Lock first: previously green checks and already-running jobs cannot enable a merge.
api(['--method','PUT',`repos/${repo}/branches/main/protection`,'--input','-'],JSON.stringify({
 required_status_checks:{strict:true,checks:protection.required_status_checks.checks},
 enforce_admins:true,required_pull_request_reviews:null,restrictions:null,
 allow_force_pushes:false,allow_deletions:false,lock_branch:true,required_conversation_resolution:true,
}));
try{
 execFileSync('gh',['variable','set',`${kind.toUpperCase()}_SIGNER_REVOKED`,'--repo',repo,'--body','true'],{stdio:'inherit'});
 console.log(`${kind} authorization revoked for future workflow runs. All demo merges are locked, including previously approved commits.`);
 console.log('Register a replacement key through the trusted owner before clearing the revocation flag and restoring the normal check-only gate.');
}catch(error){console.error('The repository is safely locked, but the revocation flag could not be saved. Keep it locked and retry as the repository owner.');throw error;}
