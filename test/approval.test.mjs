import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { action, challenge, bytes, validateApproval } from '../src/approval.mjs';
import { Store } from '../src/store.mjs';
import { Gate } from '../src/gate.mjs';
import { server } from '../src/server.mjs';
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const current = { repo: 'owner/demo', pr: 1, head: 'a'.repeat(40), base: 'b'.repeat(40) };
const pr = () => ({ number: 1, state: 'open', head: { sha: current.head }, base: { sha: current.base, ref: 'main', repo: { full_name: current.repo } } });
const signature = p => sign('sha256', Buffer.from(p), pair.privateKey).toString('base64');
function fixture() {
  const payload = challenge(current, publicKey, 1000);
  return { payload: JSON.stringify(payload), state: 'pending' };
}
test('valid exact-action signature', () => {
  const row = fixture();
  assert.equal(validateApproval(row, signature(row.payload), publicKey, current, 2000).pr, 1);
});
for (const [name, change] of [
  ['expired', x => x.now = 121000], ['future', x => x.now = 999],
  ['replay', x => x.row.state = 'accepted'],
  ['different PR', x => x.current.pr = 2], ['different repository', x => x.current.repo = 'other/repo'],
  ['new head', x => x.current.head = 'c'.repeat(40)], ['new base', x => x.current.base = 'c'.repeat(40)],
  ['wrong key', x => x.publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'pem' })],
  ['modified signed data', x => x.row.payload = x.row.payload.replace('owner/demo', 'owner/evil')],
  ['invalid signature', x => x.sig = 'YWJj'], ['noncanonical base64', x => x.sig += '\n'],
]) test(`rejects ${name}`, () => {
  const row = fixture();
  const x = { row, current: { ...current }, now: 2000, publicKey, sig: signature(row.payload) };
  change(x);
  assert.throws(() => validateApproval(x.row, x.sig, x.publicKey, x.current, x.now));
});
test('closed PR, wrong target and malformed hashes rejected at boundary', () => {
  for (const change of [p => p.state = 'closed', p => p.base.ref = 'other', p => p.head.sha = 'oops', p => p.base.repo.full_name = 'other/demo']) {
    const p = pr(); change(p); assert.throws(() => action(current.repo, p));
  }
});
function system(path = ':memory:') {
  const store = new Store(path);
  const calls = [];
  let pull = pr();
  const github = { pr: async () => pull, pending: async () => ({ id: 42 }), finish: async (...args) => calls.push(args) };
  const gate = new Gate({ repo: current.repo, publicKey, store, github, clock: () => 2000 });
  return { store, github, gate, calls, setPR: p => pull = p };
}
test('request deduplication and concurrent replay produce exactly one success publication', async () => {
  const x = system();
  try {
    const a = await x.gate.request(1);
    const b = await x.gate.request(1);
    assert.equal(a.payload, b.payload);
    assert.deepEqual(x.calls, []);
    const id = JSON.parse(a.payload).id;
    const results = await Promise.allSettled([x.gate.approve(id, signature(a.payload)), x.gate.approve(id, signature(a.payload))]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.deepEqual(x.calls, [[42, 'success']]);
  } finally { x.store.close(); }
});
test('head change after prompt prevents publication', async () => {
  const x = system();
  try {
    const a = await x.gate.request(1);
    const changed = pr(); changed.head.sha = 'c'.repeat(40); x.setPR(changed);
    await assert.rejects(x.gate.approve(JSON.parse(a.payload).id, signature(a.payload)), /changed/);
    assert.deepEqual(x.calls, []);
  } finally { x.store.close(); }
});
test('failed GitHub publication never permits reuse', async () => {
  const x = system();
  try {
    const a = await x.gate.request(1); const id = JSON.parse(a.payload).id;
    x.github.finish = async () => { throw new Error('network'); };
    await assert.rejects(x.gate.approve(id, signature(a.payload)), /uncertain/);
    assert.equal(x.store.get(id).state, 'publication_failed');
    await assert.rejects(x.gate.approve(id, signature(a.payload)), /already used/);
  } finally { x.store.close(); }
});
test('receipt persists across restart, immutable signed action', () => {
  const folder = mkdtempSync(join(tmpdir(), 'approval-test-'));
  const path = join(folder, 'db');
  let store = new Store(path);
  try {
    const payload = challenge(current, publicKey, 1000);
    store.add(payload, 42); store.consume(payload.id, 'signature');
    assert.throws(() => store.db.prepare('UPDATE approvals SET payload=? WHERE id=?').run('{}', payload.id), /Immutable/);
    assert.throws(() => store.db.prepare('UPDATE approvals SET signature=? WHERE id=?').run('new', payload.id), /Immutable/);
    store.close(); store = new Store(path);
    assert.throws(() => store.consume(payload.id, 'signature'), /already used/);
  } finally { store.close(); rmSync(folder, { recursive: true }); }
});
test('HTTP boundary rejects unauthenticated/browser requests and completes real crypto roundtrip', async () => {
  const x = system(); const http = server(x.gate, 'test-secret');
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${http.address().port}`;
  const send = (path, body, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await send('/request', { pr: 1 })).status, 401);
    assert.equal((await send('/request', { pr: 1 }, { Authorization: 'Bearer test-secret', Origin: 'https://evil.test' })).status, 401);
    const headers = { Authorization: 'Bearer test-secret' };
    const pending = await (await send('/request', { pr: 1 }, headers)).json();
    const body = { id: JSON.parse(pending.payload).id, signature: signature(pending.payload) };
    assert.equal((await send('/approve', body, headers)).status, 200);
    assert.equal((await send('/approve', body, headers)).status, 409);
    assert.deepEqual(x.calls, [[42, 'success']]);
  } finally { await new Promise(resolve => http.close(resolve)); x.store.close(); }
});
