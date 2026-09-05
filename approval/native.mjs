import { createPublicKey, verify } from 'node:crypto';
import { decode, fingerprint } from './webauthn.mjs';
export function nativeBytes(proof) {
  const parts = [Buffer.from('plain-text-native/v1\0')];
  for (const name of ['origin','requestID','nonce','expiresAt','message']) {
    if (typeof proof[name] !== 'string') throw Error('Malformed native proof');
    const value = Buffer.from(proof[name], 'utf8');
    if (new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(value) !== proof[name]) throw Error('Invalid UTF-8 field');
    const length = Buffer.alloc(4); length.writeUInt32BE(value.length);
    parts.push(length, value);
  }
  return Buffer.concat(parts);
}
export async function verifyNative(proof, trusted, now = Date.now()) {
  if (!trusted?.fingerprint || !trusted?.origin) throw Error('Native signer is not enrolled');
  if (proof.version !== 'plain-text-native/v1' || proof.origin !== trusted.origin ||
      decode(proof.requestID).length !== 32 || decode(proof.nonce).length !== 32 ||
      typeof proof.message !== 'string' || Buffer.byteLength(proof.message) > 65536) throw Error('Malformed native proof');
  const expires = Date.parse(proof.expiresAt);
  if (!Number.isFinite(expires) || new Date(expires).toISOString() !== proof.expiresAt || expires <= now || expires > now + 300000) throw Error('Native proof expired or has invalid lifetime');
  const signer = await fingerprint(proof.publicKeySpki);
  if (signer !== trusted.fingerprint) throw Error('Native signer is not trusted');
  const key = createPublicKey({ key: Buffer.from(decode(proof.publicKeySpki)), format:'der', type:'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1' ||
      !verify('sha256', nativeBytes(proof), key, decode(proof.signature))) throw Error('Native signature is invalid');
  return { fingerprint: signer, payloadText: proof.message };
}
