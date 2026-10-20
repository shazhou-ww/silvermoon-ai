/**
 * Ordinary host fixture, not an objective-portfolio-supervisor integration.
 * The host owns both databases, credentials, scheduling, and process lifecycle.
 * This stores receipts only: it never executes/replays external side effects.
 */
export async function durablyReceive(connector, hostDb, waitMs = 0) {
  hostDb.exec(`CREATE TABLE IF NOT EXISTS host_receipts (
    account_id TEXT NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL,
    PRIMARY KEY(account_id,id)
  )`);
  const messages = await connector.receive(waitMs);
  for (const message of messages) {
    hostDb.exec("BEGIN IMMEDIATE");
    try {
      const text = JSON.stringify(message);
      const old = hostDb.prepare("SELECT message FROM host_receipts WHERE account_id=? AND id=?")
        .get(message.account_id, message.id);
      if (old && old.message !== text) throw new Error("host-receipt-conflict");
      hostDb.prepare("INSERT OR IGNORE INTO host_receipts VALUES (?,?,?)")
        .run(message.account_id, message.id, text);
      hostDb.exec("COMMIT");
    } catch (error) {
      hostDb.exec("ROLLBACK");
      throw error;
    }
    await connector.acknowledge(message.id);
  }
  return messages.length;
}
