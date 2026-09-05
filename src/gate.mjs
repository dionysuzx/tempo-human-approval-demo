import { action, challenge, validateApproval } from './approval.mjs';

// One serialized imperative boundary: validation/consumption cannot interleave with another request.
export class Gate {
  constructor({ repo, publicKey, github, store, clock = Date.now }) {
    Object.assign(this, { repo, publicKey, github, store, clock });
    this.queue = Promise.resolve();
  }
  exclusive(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  request(number) { return this.exclusive(async () => {
    const current = action(this.repo, await this.github.pr(number));
    for (const row of this.store.pending()) {
      const old = JSON.parse(row.payload);
      if (old.expires > this.clock() && ['repo','pr','head','base'].every(k => old[k] === current[k])) {
        return { payload: row.payload, title: `Approve ${this.repo} #${number}` };
      }
      if (old.expires > this.clock() && old.pr !== number) throw new Error('Another approval is pending; finish it or wait two minutes');
      this.store.supersede(row.id);
      await this.github.finish(row.check_id, 'cancelled');
    }
    const check = await this.github.pending(current.head);
    const payload = challenge(current, this.publicKey, this.clock());
    const row = this.store.add(payload, check.id);
    return { payload: row.payload, title: `Approve ${this.repo} #${number}` };
  }); }
  approve(id, signature) { return this.exclusive(async () => {
    const row = this.store.get(id);
    if (!row || row.state !== 'pending') throw new Error('Approval is missing or already used');
    const payload = JSON.parse(row.payload);
    const current = action(this.repo, await this.github.pr(payload.pr));
    validateApproval(row, signature, this.publicKey, current, this.clock());
    this.store.consume(id, signature); // durable single-use receipt BEFORE the external write
    try {
      await this.github.finish(row.check_id, 'success');
      this.store.published(id, true);
    } catch (error) {
      this.store.published(id, false);
      throw new Error('Signature accepted; GitHub result uncertain. Check the PR before requesting another approval.', { cause: error });
    }
    return { approved: true, url: `https://github.com/${this.repo}/pull/${payload.pr}` };
  }); }
}
