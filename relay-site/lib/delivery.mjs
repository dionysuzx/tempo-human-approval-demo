import { createHash } from 'node:crypto';
import { acceptProof, snapshot } from '../../approval/policy.mjs';
import { API } from '../../approval/run.mjs';

export const REPOSITORY = 'dionysuzx/tempo-human-approval-demo';
export function confirmedDestination(number, url) {
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof url !== 'string' ||
    !new RegExp(
      `^https://github\\.com/${REPOSITORY}/pull/${number}#issuecomment-[1-9][0-9]*$`,
    ).test(url)
  )
    throw Error('Invalid GitHub delivery receipt');
  return { posted: true, url, returnURL: url };
}

export class Ledger {
  constructor(db) {
    this.db = db;
  }
  async find(id) {
    return this.db
      .prepare('SELECT * FROM deliveries WHERE request_id = ?')
      .bind(id)
      .first();
  }
  async reserve(id, hash) {
    const result = await this.db
      .prepare(
        'INSERT OR IGNORE INTO deliveries (request_id, proof_hash) VALUES (?, ?)',
      )
      .bind(id, hash)
      .run();
    return result.meta.changes === 1;
  }
  async complete(id, url) {
    await this.db
      .prepare('UPDATE deliveries SET url = ? WHERE request_id = ?')
      .bind(url, id)
      .run();
  }
}

// All network and durable storage live at the edges. The trusted workflow remains
// the final authority: a delivery receipt is not an approval receipt.
export async function deliver(proof, api, ledger, config, now = Date.now()) {
  if (proof?.version !== 'plain-text-native/v1')
    throw Error('Native proof required');
  const number = Number(
    proof.message?.match(/^Pull request: #([1-9][0-9]*)$/m)?.[1],
  );
  if (!Number.isSafeInteger(number) || number < 1)
    throw Error('Invalid pull request');
  const pr = await api.call(`/pulls/${number}`);
  const repo = await api.call('');
  if (repo.full_name !== REPOSITORY) throw Error('Wrong repository');
  const base = await api.call('/git/ref/heads/main');
  const current = snapshot(repo, {
    ...pr,
    base: { ...pr.base, sha: base.object.sha },
  });
  const check = await api.latest(current.head, number);
  if (!check) throw Error('No approval request');
  const request = JSON.parse(check.output.text);
  if (
    check.external_id !== `signed-proof:${number}:${request.id}` ||
    check.head_sha !== request.head
  )
    throw Error('Invalid request record');
  const hash = createHash('sha256').update(JSON.stringify(proof)).digest('hex');
  const saved = await ledger.find(request.id);
  if (saved?.proof_hash === hash && saved.url)
    return confirmedDestination(number, saved.url);
  if (check.status === 'completed')
    throw Error('Approval request already completed');
  await acceptProof(proof, request, current, config, now);
  if (saved || !(await ledger.reserve(request.id, hash)))
    throw Error(
      'Delivery is pending or uncertain. Check the PR before retrying; no duplicate was posted.',
    );
  const comment = await api.call(`/issues/${number}/comments`, 'POST', {
    body: JSON.stringify(proof, null, 2),
  });
  const receipt = confirmedDestination(number, comment.html_url);
  await ledger.complete(request.id, receipt.url);
  return receipt;
}

export async function trustedConfiguration(api) {
  // Always read owner-controlled main, never a caller-supplied ref or key.
  const file = await api.call('/contents/approval/config.json?ref=main');
  if (file.encoding !== 'base64')
    throw Error('Unsupported trusted configuration');
  const config = JSON.parse(
    Buffer.from(file.content, 'base64').toString('utf8'),
  );
  const revoked = new Set();
  for (let page = 1; page <= 20; page++) {
    const result = await api.call(
      `/actions/variables?per_page=100&page=${page}`,
    );
    if (!Array.isArray(result.variables))
      throw Error('Cannot read revocation state');
    for (const variable of result.variables)
      if (variable.value === 'true') revoked.add(variable.name);
    if (result.variables.length < 100) break;
    if (page === 20) throw Error('Ambiguous revocation state');
  }
  if (revoked.has('NATIVE_SIGNER_REVOKED')) {
    config.nativeSigner = null;
    config.iphoneSigner = null;
  }
  return config;
}

export async function handleDelivery(request, env) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const respond = (code, value) =>
    new Response(JSON.stringify(value), { status: code, headers });
  if (
    !env.APPROVAL_ORIGIN ||
    new URL(request.url).origin !== env.APPROVAL_ORIGIN
  )
    return respond(503, { error: 'Approval origin is not configured' });
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== env.APPROVAL_ORIGIN
  )
    return respond(403, { error: 'Untrusted origin' });
  if (!env.GITHUB_RELAY_TOKEN || !env.DB)
    return respond(503, {
      error: 'Delivery is not configured. No proof was posted.',
    });
  if (request.headers.get('content-type') !== 'application/json')
    return respond(415, { error: 'Use JSON' });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error('Missing proof');
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 48000) {
        await reader.cancel();
        return respond(413, { error: 'Proof too large' });
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const api = new API(REPOSITORY, env.GITHUB_RELAY_TOKEN);
    return respond(
      200,
      await deliver(
        JSON.parse(body).proof,
        api,
        new Ledger(env.DB),
        await trustedConfiguration(api),
      ),
    );
  } catch {
    return respond(409, {
      error:
        'Proof could not be delivered. Check the PR; request a fresh link if needed. Approval has not been confirmed.',
    });
  }
}
