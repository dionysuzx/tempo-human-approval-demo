import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createPrivateKey } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fingerprint } from '../src/approval.mjs';
process.umask(0o077);
mkdirSync('.state', { recursive: true, mode: 0o700 });
if (existsSync('.state/config.json')) throw new Error('Already configured; existing trusted settings were preserved');
if (!existsSync('.state/native-public.pem')) throw new Error('Run ./setup.command first to enroll Touch ID');
const io = createInterface({ input: stdin, output: stdout });
try {
  console.log('Create a GitHub App using the prefilled link in README.md, then install it on tempo-human-approval-demo only.');
  const appId = Number(await io.question('GitHub App ID: '));
  const installationId = Number(await io.question('Installation ID (number at end of installation URL): '));
  const path = (await io.question('Path to the downloaded GitHub App private key (.pem): ')).trim();
  if (![appId, installationId].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error('IDs must be positive integers');
  const privateKey = readFileSync(path, 'utf8');
  if (createPrivateKey(privateKey).asymmetricKeyType !== 'rsa') throw new Error('Expected GitHub RSA private key');
  const publicKey = readFileSync('.state/native-public.pem', 'utf8');
  console.log(`Trusting this Mac: ${fingerprint(publicKey)}`);
  writeFileSync('.state/github-app.pem', privateKey, { mode: 0o600, flag: 'wx' });
  writeFileSync('.state/trusted-public.pem', publicKey, { mode: 0o600, flag: 'wx' });
  writeFileSync('.state/config.json', JSON.stringify({ repo: 'dionysuzx/tempo-human-approval-demo', appId, installationId,
    token: randomBytes(32).toString('hex'), protected: false }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log('Saved. Next: npm run protect, then npm start.');
} finally { io.close(); }
