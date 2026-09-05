// Portable browser/Node verifier. No storage or network dependencies.
export const VERSION = 'plain-text-webauthn/v1';
export const utf8 = (s) => new TextEncoder().encode(s);
export function encode(bytes) {
  return btoa(
    Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join(''),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export function decode(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s))
    throw Error('Invalid base64url');
  const bytes = Uint8Array.from(
    atob(s.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  );
  if (encode(bytes) !== s) throw Error('Noncanonical base64url');
  return bytes;
}
export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
export const hash = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
export async function challenge(payload, nonce) {
  if (nonce.length !== 32) throw Error('Nonce must contain 32 bytes');
  return hash(concat(utf8(VERSION + '\0'), nonce, await hash(payload)));
}
export async function publicKey(spki) {
  return crypto.subtle.importKey(
    'spki',
    decode(spki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}
export async function fingerprint(spki) {
  const key = await publicKey(spki);
  return (
    'sha256:' + encode(await hash(await crypto.subtle.exportKey('spki', key)))
  );
}
// WebAuthn ES256 signatures use ASN.1 DER; Web Crypto takes 64-byte r || s.
export function derToRaw(der) {
  if (
    der.length < 8 ||
    der.length > 72 ||
    der[0] !== 0x30 ||
    der[1] !== der.length - 2
  )
    throw Error('Invalid DER signature');
  let offset = 2;
  const readInteger = () => {
    if (der[offset++] !== 2) throw Error('Invalid DER integer');
    const len = der[offset++];
    const n = der.slice(offset, offset + len);
    offset += len;
    if (
      !len ||
      len > 33 ||
      n.length !== len ||
      n[0] & 128 ||
      (len > 1 && n[0] === 0 && !(n[1] & 128))
    )
      throw Error('Invalid DER integer');
    const significant = n[0] === 0 ? n.slice(1) : n;
    if (significant.length > 32) throw Error('Oversized integer');
    const out = new Uint8Array(32);
    out.set(significant, 32 - significant.length);
    return out;
  };
  const raw = concat(readInteger(), readInteger());
  if (offset !== der.length) throw Error('Trailing signature bytes');
  return raw;
}
export function parseRecord(raw) {
  if (
    !raw ||
    raw.version !== VERSION ||
    typeof raw.credentialId !== 'string' ||
    !decode(raw.credentialId).length ||
    typeof raw.publicKeySpki !== 'string'
  )
    throw Error('Invalid public credential record');
  const url = new URL(raw.origin);
  if (
    url.origin !== raw.origin ||
    url.hostname !== raw.rpId ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && url.hostname === 'localhost')
    )
  )
    throw Error('Invalid origin or relying-party ID');
  return {
    version: VERSION,
    credentialId: raw.credentialId,
    publicKeySpki: raw.publicKeySpki,
    origin: raw.origin,
    rpId: raw.rpId,
  };
}
export async function verifyProof(proof, expectedFingerprint = '') {
  if (
    !proof ||
    proof.version !== VERSION ||
    proof.algorithm !== 'ES256' ||
    typeof proof.payloadText !== 'string'
  )
    throw Error('Unsupported proof format');
  const record = parseRecord(proof);
  const payload = decode(proof.payloadBase64url);
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      payload,
    ) !== proof.payloadText
  )
    throw Error('Text is not the exact valid UTF-8 message');
  if (encode(utf8(proof.payloadText)) !== proof.payloadBase64url)
    throw Error('Text does not match exact payload bytes');
  const clientBytes = decode(proof.clientDataJSON);
  const client = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(clientBytes),
  );
  if (
    client.type !== 'webauthn.get' ||
    client.origin !== record.origin ||
    client.crossOrigin === true ||
    client.topOrigin !== undefined
  )
    throw Error('Invalid WebAuthn client context');
  if (
    client.challenge !== encode(await challenge(payload, decode(proof.nonce)))
  )
    throw Error('Payload or nonce does not match signed challenge');
  const auth = decode(proof.authenticatorData);
  if (
    auth.length < 37 ||
    encode(auth.slice(0, 32)) !== encode(await hash(utf8(record.rpId)))
  )
    throw Error('Invalid relying-party hash');
  if ((auth[32] & 5) !== 5)
    throw Error('User presence and user verification are required');
  if (auth[32] & 16 && !(auth[32] & 8)) throw Error('Invalid backup flags');
  if (auth[32] & 64)
    throw Error('Unexpected attested credential data in assertion');
  if (!(auth[32] & 128) && auth.length !== 37)
    throw Error('Unexpected authenticator data');
  const key = await publicKey(record.publicKeySpki);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    derToRaw(decode(proof.signature)),
    concat(auth, await hash(clientBytes)),
  );
  if (!valid) throw Error('Signature is invalid');
  const signer = await fingerprint(record.publicKeySpki);
  return {
    signatureValid: true,
    fingerprint: signer,
    trust: expectedFingerprint.trim()
      ? expectedFingerprint.trim() === signer
        ? 'matches'
        : 'mismatch'
      : 'unestablished',
    payloadText: proof.payloadText,
    origin: record.origin,
    backupEligible: !!(auth[32] & 8),
    backedUp: !!(auth[32] & 16),
  };
}
