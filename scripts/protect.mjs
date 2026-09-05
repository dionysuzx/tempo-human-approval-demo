import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CHECK } from '../src/approval.mjs';
import { GitHub } from '../src/github.mjs';
const config = JSON.parse(readFileSync('.state/config.json'));
const gh = new GitHub({ ...config, privateKey: readFileSync('.state/github-app.pem', 'utf8') });
// Verify the installation token can read this exact repository before changing protection.
await gh.pr(1);
const body = { required_status_checks: { strict: true, checks: [{ context: CHECK, app_id: config.appId }] },
  enforce_admins: true, required_pull_request_reviews: null, restrictions: null,
  allow_force_pushes: false, allow_deletions: false, required_conversation_resolution: true };
const result = JSON.parse(execFileSync('gh', ['api', '--method', 'PUT', `repos/${config.repo}/branches/main/protection`, '--input', '-'],
  { input: JSON.stringify(body), encoding: 'utf8' }));
if (!result.enforce_admins?.enabled || !result.required_status_checks?.checks?.some(x => x.context === CHECK && x.app_id === config.appId)) {
  throw new Error('GitHub did not confirm the pinned check; verifier remains disabled');
}
writeFileSync('.state/config.json', JSON.stringify({ ...config, protected: true }, null, 2), { mode: 0o600 });
console.log('main requires your dedicated GitHub App check, including for administrators.');
