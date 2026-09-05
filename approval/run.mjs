import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHECK, APP_ID, snapshot, requestFor, sameAction, signingLink, parseComment, acceptProof } from './policy.mjs';

export class API {
  constructor(repo, token) { this.repo = repo; this.token = token; }
  async call(path, method = 'GET', body) {
    const response = await fetch(`https://api.github.com/repos/${this.repo}${path}`, { method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!response.ok) { const detail = await response.json().catch(() => ({})); throw Error(`GitHub ${method} ${path}: ${response.status} ${detail.message ?? ''}`); }
    return response.status === 204 ? null : response.json();
  }
  async latest(head, pr) {
    let matches = [];
    for (let page = 1; page <= 20; page++) {
      const result = await this.call(`/commits/${head}/check-runs?check_name=${encodeURIComponent(CHECK)}&filter=all&per_page=100&page=${page}`);
      matches.push(...result.check_runs.filter(check => check.app.id === APP_ID && check.external_id?.startsWith(`signed-proof:${pr}:`)));
      if (result.check_runs.length < 100) return matches.sort((a, b) => b.id - a.id)[0];
    }
    throw Error('Too many check runs; refusing ambiguous approval history');
  }
}
function saved(check) {
  const value = JSON.parse(check.output.text);
  if (`signed-proof:${value.pr}:${value.id}` !== check.external_id || value.head !== check.head_sha) throw Error('Corrupt request record');
  return value;
}
export async function run(api, event, config, now = Date.now()) {
  const number = Number(event.pull_request?.number ?? event.issue?.number ?? event.inputs?.pr);
  if (!Number.isSafeInteger(number) || number < 1 || (event.issue && !event.issue.pull_request)) return;
  const repo = await api.call('');
  const pr = await api.call(`/pulls/${number}`);
  const base = await api.call('/git/ref/heads/main');
  const current = snapshot(repo, { ...pr, base: { ...pr.base, sha: base.object.sha } });
  const previous = await api.latest(current.head, number);
  if (event.comment) {
    const comment = await api.call(`/issues/comments/${event.comment.id}`);
    if (!comment.html_url.startsWith(`https://github.com/${repo.full_name}/pull/${number}#`)) throw Error('Comment is not on this PR');
    const body = comment.body.trim();
    if (body !== '/request-approval') {
      if (!body.startsWith('{') && !body.startsWith('```json\n')) return;
      if (!previous) throw Error('No live request; comment /request-approval first');
      const request = saved(previous);
      if (previous.status === 'completed') throw Error('Request already completed; replay rejected');
      const receipt = await acceptProof(parseComment(body), request, current, config, now);
      // Re-fetch just before publication. The check also belongs to the immutable head SHA.
      const freshPR = await api.call(`/pulls/${number}`);
      const freshBase = await api.call('/git/ref/heads/main');
      const fresh = snapshot(await api.call(''), { ...freshPR, base: { ...freshPR.base, sha: freshBase.object.sha } });
      if (!sameAction(current, fresh)) throw Error('PR changed during verification');
      receipt.commentId = comment.id;
      await api.call(`/check-runs/${previous.id}`, 'PATCH', { status: 'completed', conclusion: 'success',
        output: { title: 'Signed approval verified', summary: `Approved commit ${current.head}. Proof: ${comment.html_url}`,
          text: JSON.stringify(receipt) } });
      console.log('Signed proof accepted; approval check is green.');
      return;
    }
    // Only contributors can rotate challenges; arbitrary comments cannot revoke approval.
    if (!['OWNER','MEMBER','COLLABORATOR'].includes(comment.author_association)) throw Error('Only a repository contributor may request a fresh challenge');
  }
  let reusable;
  if (previous && !event.comment) {
    const old = saved(previous);
    if (sameAction(old, current) && old.state === 'approved') return;
    if (sameAction(old, current) && old.state === 'pending' && old.expires > now) {
      if (old.linkCommentId) return;
      reusable = old;
    }
  }
  if (previous && !reusable && previous.status !== 'completed') await api.call(`/check-runs/${previous.id}`, 'PATCH', {
    status: 'completed', conclusion: 'cancelled', output: { title: 'Superseded', summary: 'Use the latest signing link.', text: JSON.stringify({ ...saved(previous), state: 'superseded' }) } });
  const request = reusable ?? requestFor(current, now);
  const nativeRoute = number === config.nativePr;
  const enrolled = nativeRoute ? !!config.nativeSigner?.fingerprint : !!config.signer?.fingerprint;
  const site = new URL(config.signingSite);
  if (nativeRoute) site.pathname = '/native';
  const linkURL = new URL(signingLink(site.href, request));
  if (nativeRoute) { const fragment = new URLSearchParams(linkURL.hash.slice(1)); fragment.set('delivery', 'github-demo'); fragment.set('deliver', 'http://localhost:8792/deliver/2'); linkURL.hash = fragment.toString(); }
  if (!nativeRoute && config.signer?.fingerprint) { const fragment = new URLSearchParams(linkURL.hash.slice(1)); fragment.set('signer', config.signer.fingerprint); linkURL.hash = fragment.toString(); }
  const link = linkURL.href;
  const check = reusable ? previous : await api.call('/check-runs', 'POST', { name: CHECK, head_sha: current.head, external_id: `signed-proof:${number}:${request.id}`,
    status: 'in_progress', output: { title: 'Waiting for your signed proof', summary: `Open the signing link in the PR comment.`, text: JSON.stringify(request) } });
  const instructions = !enrolled
    ? `### Register your signing key first\n\nThis repository has not registered your ${nativeRoute ? 'native' : 'browser'} signing key yet. [Open the signing page](${site.href}) to set it up, then have the repository owner register the public record shown there. No approval can pass until registration is complete.\n\nAfter registration, comment \`/request-approval\` for a signing link.`
    : `### Approve this PR\n\n**⌘-click** [Open the signing page](${link}) in **Brave** to keep this PR open in its own tab. Review the message, then ${nativeRoute ? 'open the native app and approve with Touch ID. Your signed proof will be posted here automatically.' : 'click **Sign**. Confirm your passkey or Touch ID, copy the proof, then paste it as a new comment on this PR.'}\n\nCommit: \`${current.head}\` · Link expires ${new Date(request.expires).toISOString()}.\n\nKeep the local signer running. For a new link, comment \`/request-approval\`.`;
  const linkComment = await api.call(`/issues/${number}/comments`, 'POST', { body: instructions });
  await api.call(`/check-runs/${check.id}`, 'PATCH', { output: { title: 'Waiting for your signed proof', summary: 'Open the signing link in the PR comment.', text: JSON.stringify({ ...request, linkCommentId: linkComment.id }) } });
  console.log('Posted the signing link; approval remains blocked.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
  const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url)));
  if (process.env.BROWSER_SIGNER_REVOKED === 'true') config.signer = null;
  if (process.env.NATIVE_SIGNER_REVOKED === 'true') config.nativeSigner = null;
  try { await run(new API(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN), event, config); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
