import { sign } from 'node:crypto';
import { CHECK } from './approval.mjs';
export class GitHub {
  constructor({ appId, privateKey, installationId, repo }, fetcher = fetch) {
    Object.assign(this, { appId, privateKey, installationId, repo, fetcher });
  }
  async request(path, method = 'GET', body, token) {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token ?? await this.token()}`,
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'tempo-human-approval-demo' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  }
  async token() {
    if (this.cached && Date.now() < this.cached.until) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const data = [ { alg: 'RS256', typ: 'JWT' }, { iat: now - 60, exp: now + 540, iss: String(this.appId) } ]
      .map(x => Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
    const jwt = `${data}.${sign('RSA-SHA256', Buffer.from(data), this.privateKey).toString('base64url')}`;
    const installation = await this.request(`/app/installations/${this.installationId}/access_tokens`, 'POST',
      { repositories: [this.repo.split('/')[1]], permissions: { checks: 'write', pull_requests: 'read', metadata: 'read' } }, jwt);
    this.cached = { token: installation.token, until: Date.parse(installation.expires_at) - 60_000 };
    return installation.token;
  }
  pr(number) { return this.request(`/repos/${this.repo}/pulls/${number}`); }
  pending(head) {
    return this.request(`/repos/${this.repo}/check-runs`, 'POST', { name: CHECK, head_sha: head, status: 'in_progress',
      output: { title: 'Waiting for Touch ID', summary: 'A registered person must approve this exact pull request commit.' } });
  }
  finish(id, conclusion) {
    return this.request(`/repos/${this.repo}/check-runs/${id}`, 'PATCH', { status: 'completed', conclusion,
      output: { title: conclusion === 'success' ? 'Approved with Touch ID' : 'Approval expired or changed',
        summary: conclusion === 'success' ? 'Signature verified against the enrolled key for this exact change.' : 'Request a fresh approval.' } });
  }
}
