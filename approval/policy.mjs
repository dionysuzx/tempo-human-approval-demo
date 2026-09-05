import { randomUUID, createHash } from 'node:crypto';
import { verifyProof } from './webauthn.mjs';
export const CHECK = 'Human approval / signed proof';
export const APP_ID = 15368; // GitHub Actions on github.com; verify live when installing protection.
export const LIFETIME = 15 * 60 * 1000;
export function snapshot(repo, pr) {
  if (!Number.isSafeInteger(repo.id) || repo.id <= 0 || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name) ||
      !Number.isSafeInteger(pr.number) || pr.number <= 0 || pr.state !== 'open' ||
      pr.base.ref !== 'main' || pr.base.repo.id !== repo.id ||
      !/^[a-f0-9]{40}$/.test(pr.head.sha) || !/^[a-f0-9]{40}$/.test(pr.base.sha)) throw Error('Not an open PR to this repository main branch');
  return { repository: repo.full_name, repositoryId: repo.id, pr: pr.number, head: pr.head.sha, base: pr.base.sha };
}
export function message(request) {
  return `Approve this GitHub pull request\n\nRepository: ${request.repository}\nRepository ID: ${request.repositoryId}\nPull request: #${request.pr}\nAction: allow this change to merge into main\nHead commit: ${request.head}\nBase commit: ${request.base}\nRequest: ${request.id}\nExpires: ${new Date(request.expires).toISOString()}`;
}
export function requestFor(current, now = Date.now(), id = randomUUID()) {
  return { version: 1, ...current, id, issued: now, expires: now + LIFETIME, state: 'pending' };
}
export function sameAction(a, b) { return ['repository','repositoryId','pr','head','base'].every(key => a[key] === b[key]); }
export function signingLink(base, request) {
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw Error('Signer must use HTTPS or localhost');
  url.hash = new URLSearchParams({ message: message(request) }).toString();
  return url.href;
}
export function parseComment(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 48_000) throw Error('Proof comment is too large');
  let text = body.trim();
  if (text.startsWith('```json\n') && text.endsWith('\n```')) text = text.slice(8, -4);
  return JSON.parse(text);
}
export async function acceptProof(proof, request, current, config, now = Date.now()) {
  if (!config.signer?.fingerprint || !config.signer?.origin || !config.signer?.credentialId) throw Error('Signer enrollment is not configured by the repository owner');
  if (request.version !== 1 || request.state !== 'pending') throw Error('Request was already used or superseded');
  if (!Number.isSafeInteger(request.issued) || request.expires !== request.issued + LIFETIME || now < request.issued || now >= request.expires) throw Error('Request has expired; comment /request-approval for a fresh link');
  if (!sameAction(request, current)) throw Error('PR changed; use the link for its current commits');
  if (proof.payloadText !== message(request)) throw Error('Proof signs a different action or request');
  if (proof.origin !== config.signer.origin || proof.credentialId !== config.signer.credentialId) throw Error('Proof is from an unregistered credential or origin');
  const result = await verifyProof(proof, config.signer.fingerprint);
  if (result.trust !== 'matches') throw Error('Signer is not trusted');
  return { ...request, state: 'approved', acceptedAt: now,
    proofHash: createHash('sha256').update(JSON.stringify(proof)).digest('hex'), signer: result.fingerprint };
}
