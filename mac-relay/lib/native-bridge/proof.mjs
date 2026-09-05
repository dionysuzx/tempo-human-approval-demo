import {
  utf8,
  concat,
  decode,
  encode,
  publicKey,
  fingerprint,
  derToRaw,
} from '../signing/proof.mjs';
export const ORIGIN = 'http://localhost:8787';
export const VERSION = 'plain-text-native/v1';
export const CALLBACK = ORIGIN + '/native/complete';
export function validToken(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    decode(value).length === 32
  );
}
export function parseRequest(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    raw.origin !== ORIGIN ||
    raw.callback !== CALLBACK ||
    !validToken(raw.requestID) ||
    !validToken(raw.nonce) ||
    typeof raw.message !== 'string'
  )
    throw Error('Invalid native request');
  if (
    typeof raw.expiresAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.expiresAt)
  )
    throw Error('Invalid request expiry');
  const expires = Date.parse(raw.expiresAt);
  if (
    !Number.isFinite(expires) ||
    new Date(expires).toISOString() !== raw.expiresAt
  )
    throw Error('Invalid request expiry');
  const bytes = utf8(raw.message);
  if (
    bytes.length > 65536 ||
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !==
      raw.message
  )
    throw Error('Message must be valid UTF-8 and at most 65536 bytes');
  return {
    version: 1,
    origin: ORIGIN,
    requestID: raw.requestID,
    nonce: raw.nonce,
    expiresAt: raw.expiresAt,
    message: raw.message,
    callback: CALLBACK,
  };
}
export function signingBytes(request) {
  const fields = [
    request.origin,
    request.requestID,
    request.nonce,
    request.expiresAt,
    request.message,
  ];
  return concat(
    utf8(VERSION + '\0'),
    ...fields.map((value) => {
      const bytes = utf8(value);
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, bytes.length, false);
      return concat(length, bytes);
    }),
  );
}
export async function verifyNativeProof(raw, expectedFingerprint = '') {
  if (
    raw?.version !== VERSION ||
    typeof raw.publicKeySpki !== 'string' ||
    typeof raw.signature !== 'string'
  )
    throw Error('Invalid native proof');
  const request = parseRequest({ ...raw, version: 1, callback: CALLBACK });
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await publicKey(raw.publicKeySpki),
    derToRaw(decode(raw.signature)),
    signingBytes(request),
  );
  if (!valid) throw Error('Invalid native signature');
  const signer = await fingerprint(raw.publicKeySpki);
  return {
    signatureValid: true,
    fingerprint: signer,
    trust: expectedFingerprint
      ? signer === expectedFingerprint
        ? 'matches'
        : 'mismatch'
      : 'unestablished',
    message: request.message,
  };
}
export function createRequest(message, now, token, nonce) {
  return parseRequest({
    version: 1,
    origin: ORIGIN,
    requestID: token,
    nonce,
    expiresAt: new Date(now + 300000).toISOString(),
    message,
    callback: CALLBACK,
  });
}
export const randomToken = () =>
  encode(crypto.getRandomValues(new Uint8Array(32)));
