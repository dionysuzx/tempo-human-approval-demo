import { DatabaseSync } from 'node:sqlite';
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','accepted','published','publication_failed','superseded')),
        check_id INTEGER NOT NULL, signature TEXT);
      CREATE TRIGGER IF NOT EXISTS immutable_payload BEFORE UPDATE OF payload,check_id,id ON approvals
        BEGIN SELECT RAISE(ABORT,'Immutable approval'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_receipt BEFORE UPDATE OF signature ON approvals
        WHEN OLD.signature IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable receipt'); END;`);
  }
  get(id) { return this.db.prepare('SELECT * FROM approvals WHERE id=?').get(id); }
  pending() { return this.db.prepare("SELECT * FROM approvals WHERE state='pending'").all(); }
  add(payload, checkId) {
    this.db.prepare('INSERT INTO approvals VALUES (?,?,?, ?,NULL)').run(payload.id, JSON.stringify(payload), 'pending', checkId);
    return this.get(payload.id);
  }
  supersede(id) { this.db.prepare("UPDATE approvals SET state='superseded' WHERE id=? AND state='pending'").run(id); }
  consume(id, signature) {
    const result = this.db.prepare("UPDATE approvals SET state='accepted',signature=? WHERE id=? AND state='pending'").run(signature, id);
    if (result.changes !== 1) throw new Error('Approval already used');
  }
  published(id, ok) { this.db.prepare("UPDATE approvals SET state=? WHERE id=? AND state='accepted'").run(ok ? 'published' : 'publication_failed', id); }
  close() { this.db.close(); }
}
