import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto';

export const CHECK = 'Human approval / Touch ID';
export const WINDOW_MS = 120_000;
export function fingerprint(publicKey) {
  return createHash('sha256').update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })).digest('hex');
}
export function action(repo, pr) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
      !Number.isSafeInteger(pr.number) || pr.number < 1 || pr.state !== 'open' ||
      pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== repo ||
      !/^[a-f0-9]{40}$/.test(pr.head?.sha) || !/^[a-f0-9]{40}$/.test(pr.base?.sha)) {
    throw new Error('Expected an open pull request targeting this repository main branch');
  }
  return { repo, pr: pr.number, head: pr.head.sha, base: pr.base.sha };
}
export function challenge(current, publicKey, now, id = randomUUID()) {
  return { version: 1, id, decision: 'approved', ...current, key: fingerprint(publicKey), issued: now, expires: now + WINDOW_MS };
}
export function bytes(payload) { return Buffer.from(JSON.stringify(payload)); }
export function validateApproval(row, signature, publicKey, current, now) {
  if (!row || row.state !== 'pending') throw new Error('Approval is missing or already used');
  const payload = JSON.parse(row.payload);
  if (now < payload.issued || now >= payload.expires) throw new Error('Approval expired');
  if (payload.key !== fingerprint(publicKey)) throw new Error('Untrusted key');
  if (['repo', 'pr', 'head', 'base'].some(key => payload[key] !== current[key])) throw new Error('Pull request changed; approve its new version');
  if (typeof signature !== 'string' || signature.length > 128 ||
      Buffer.from(signature, 'base64').toString('base64') !== signature ||
      !verify('sha256', Buffer.from(row.payload), publicKey, Buffer.from(signature, 'base64'))) throw new Error('Invalid signature');
  return payload;
}
