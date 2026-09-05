import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store } from './store.mjs';
import { GitHub } from './github.mjs';
import { Gate } from './gate.mjs';

export function server(gate, token) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Unauthorized' });
    try {
      if (req.method !== 'POST') return send(405, { error: 'Use POST' });
      let data = '';
      for await (const chunk of req) {
        data += chunk;
        if (Buffer.byteLength(data) > 4096) return send(413, { error: 'Request too large' });
      }
      const body = JSON.parse(data);
      if (req.url === '/request' && Number.isSafeInteger(body.pr) && body.pr > 0) return send(200, await gate.request(body.pr));
      if (req.url === '/approve' && typeof body.id === 'string' && typeof body.signature === 'string') return send(200, await gate.approve(body.id, body.signature));
      send(400, { error: 'Invalid request' });
    } catch (error) { send(409, { error: error.message }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const config = JSON.parse(readFileSync('.state/config.json'));
  if (!config.protected) throw new Error('Run npm run protect first to bind the required check to the GitHub App');
  const publicKey = readFileSync('.state/trusted-public.pem', 'utf8');
  const github = new GitHub({ ...config, privateKey: readFileSync('.state/github-app.pem', 'utf8') });
  const gate = new Gate({ repo: config.repo, publicKey, github, store: new Store('.state/approvals.sqlite') });
  server(gate, config.token).listen(8789, '127.0.0.1', () => console.log('Approval verifier ready on 127.0.0.1:8789. In another terminal run: ./approve.command'));
}
