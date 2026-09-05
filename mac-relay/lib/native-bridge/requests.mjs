import {
  createRequest,
  randomToken,
  parseRequest,
  verifyNativeProof,
  validToken,
} from './proof.mjs';
// Local demo state only. Restarting the server expires outstanding requests.
export class NativeRequests {
  constructor(now = () => Date.now(), random = randomToken) {
    this.now = now;
    this.random = random;
    this.pending = new Map();
  }
  prune() {
    for (const [id, entry] of this.pending)
      if (Date.parse(entry.request.expiresAt) <= this.now())
        this.pending.delete(id);
  }
  get(id) {
    this.prune();
    if (!validToken(id) || !this.pending.has(id))
      throw Error('Request expired or unavailable');
    return this.pending.get(id);
  }
  create(message) {
    this.prune();
    if (this.pending.size >= 32) throw Error('Too many pending requests');
    const request = createRequest(
      message,
      this.now(),
      this.random(),
      this.random(),
    );
    const resultToken = this.random();
    this.pending.set(request.requestID, {
      request,
      resultToken,
      claimed: false,
      proof: null,
    });
    return {
      requestID: request.requestID,
      resultToken,
      expiresAt: request.expiresAt,
      launchURL: 'hardwaresigningbridge://approve?request=' + request.requestID,
    };
  }
  claim(id) {
    const entry = this.get(id);
    if (entry.claimed)
      throw Error('Request already opened; start a new request');
    entry.claimed = true;
    return entry.request;
  }
  async complete(proof) {
    const entry = this.get(proof?.requestID);
    if (!entry.claimed || entry.proof)
      throw Error('Request is not awaiting completion');
    const returned = parseRequest({
      ...proof,
      version: 1,
      callback: entry.request.callback,
    });
    if (JSON.stringify(returned) !== JSON.stringify(entry.request))
      throw Error('Proof does not match pending request');
    await verifyNativeProof(proof);
    if (this.get(proof.requestID) !== entry || entry.proof)
      throw Error('Request already completed');
    entry.proof = proof;
    return { completed: true };
  }
  result(id, resultToken) {
    const entry = this.get(id);
    if (!validToken(resultToken) || resultToken !== entry.resultToken)
      throw Error('Wrong browser session');
    return entry.proof
      ? { status: 'completed', proof: entry.proof }
      : { status: 'pending' };
  }
}
export const nativeRequests = new NativeRequests();
