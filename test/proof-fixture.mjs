import {VERSION,utf8,encode,hash,concat,challenge} from '../approval/webauthn.mjs';
function toDer(raw) {
  const integer = (b) => {
    let i = 0;
    while (i < 31 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 128) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([2, v.length]), v);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([48, body.length]), body);
}
export async function fixture(text = 'Hello 🌍\n  exact\ttext\n', overrides = {}) {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const client = {
    type: 'webauthn.get',
    origin: 'https://example.com',
    challenge: encode(await challenge(utf8(text), nonce)),
    crossOrigin: false,
    ...overrides.client,
  };
  const clientBytes = utf8(JSON.stringify(client));
  const auth = concat(
    await hash(utf8('example.com')),
    new Uint8Array([overrides.flags ?? 5, 0, 0, 0, 0]),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      concat(auth, await hash(clientBytes)),
    ),
  );
  const spki = encode(await crypto.subtle.exportKey('spki', keys.publicKey));
  return {
    version: VERSION,
    algorithm: 'ES256',
    payloadText: text,
    payloadBase64url: encode(utf8(text)),
    nonce: encode(nonce),
    credentialId: encode(utf8('credential')),
    publicKeySpki: spki,
    origin: 'https://example.com',
    rpId: 'example.com',
    clientDataJSON: encode(clientBytes),
    authenticatorData: encode(auth),
    signature: encode(toDer(signature)),
  };
}
