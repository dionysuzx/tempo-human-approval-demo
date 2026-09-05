import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const deliveries = sqliteTable('deliveries', {
  requestId: text('request_id').primaryKey(),
  proofHash: text('proof_hash').notNull(),
  url: text('url'),
});
