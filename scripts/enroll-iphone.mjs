// Run locally by the owner only after comparing the fingerprint ON THE IPHONE.
// This prepares a reviewable config change; it never commits, pushes, or unlocks.
import { readFileSync,writeFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { fingerprint,decode } from '../approval/webauthn.mjs';
const [file,expected] = process.argv.slice(2);
if (!file || !expected) throw Error('Usage: node scripts/enroll-iphone.mjs public-record.json sha256:FINGERPRINT-READ-FROM-IPHONE');
const record=JSON.parse(readFileSync(file,'utf8'));
const origin=new URL(record.origin);
if(origin.protocol!=='https:' || origin.origin!==record.origin || origin.hostname.endsWith('.invalid'))throw Error('Use the actual deployed HTTPS origin');
if(record.fingerprint!==expected || await fingerprint(record.publicKeySpki)!==expected)throw Error('Fingerprint does not match the independently compared record');
const key=createPublicKey({format:'der',type:'spki',key:Buffer.from(decode(record.publicKeySpki))});
if(key.asymmetricKeyType!=='ec' || key.asymmetricKeyDetails.namedCurve!=='prime256v1')throw Error('P-256 key required');
const path=new URL('../approval/config.json',import.meta.url);
const config=JSON.parse(readFileSync(path,'utf8'));
if(config.iphoneSigner && config.iphoneSigner.fingerprint!==expected)throw Error('Revoke and remove the old iPhone enrollment through owner review before replacement');
config.iphoneSigner={fingerprint:expected,origin:record.origin,publicKeySpki:record.publicKeySpki};
config.mobileApprovalSite=record.origin+'/native';
writeFileSync(path,JSON.stringify(config,null,2)+'\n');
console.log('Prepared the iPhone enrollment change. Review it through the trusted owner process; approval remains unchanged until it reaches main.');
