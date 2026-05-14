import pg from "pg";

const { Pool } = pg;

/** @type {import("pg").Pool | null} */
let pool = null;
let ensuredTable = false;

function databaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

function tableName() {
  const t = process.env.POSTGRES_TRANSCRIPTS_TABLE?.trim();
  if (t && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t)) return t;
  return "ticket_transcripts";
}

/**
 * @returns {import("pg").Pool | null}
 */
export function getTranscriptPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url });
    pool.on("error", (err) => {
      console.error("[postgresTranscripts] pool error:", err.message);
    });
  }
  return pool;
}

export async function ensureTranscriptsTable() {
  if (ensuredTable) return;
  const p = getTranscriptPool();
  if (!p) return;
  const client = await p.connect();
  try {
    const tbl = tableName();
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${tbl} (
        channel_id VARCHAR(32) PRIMARY KEY,
        ticket_id VARCHAR(32),
        guild_id VARCHAR(32),
        channel_name TEXT,
        html TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(
      `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ticket_id VARCHAR(32);`
    );
    await client.query(
      `UPDATE ${tbl} SET ticket_id = channel_id WHERE ticket_id IS NULL;`
    );
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${tbl}_ticket_id_uidx ON ${tbl} (ticket_id);
    `);
    await client.query(
      `ALTER TABLE ${tbl} ALTER COLUMN ticket_id SET NOT NULL;`
    );

    ensuredTable = true;
  } finally {
    client.release();
  }
}

/**
 * Upsert transcript HTML for a ticket channel (one row per channel id).
 * `ticketId` must be unique across all rows (defaults to `channelId` — Discord ticket channel snowflake).
 * @param {{ channelId: string; ticketId?: string; guildId: string; channelName: string; html: string }} doc
 * @returns {Promise<boolean>} true if written
 */
export async function saveTranscriptToPostgres(doc) {
  const { channelId, guildId, channelName, html } = doc;
  const ticketId = (doc.ticketId ?? channelId)?.trim();
  if (!channelId || !ticketId || !html) return false;
  try {
    await ensureTranscriptsTable();
    const p = getTranscriptPool();
    if (!p) return false;
    const tbl = tableName();
    await p.query(
      `INSERT INTO ${tbl} (channel_id, ticket_id, guild_id, channel_name, html, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (channel_id) DO UPDATE SET
         ticket_id = EXCLUDED.ticket_id,
         guild_id = EXCLUDED.guild_id,
         channel_name = EXCLUDED.channel_name,
         html = EXCLUDED.html,
         updated_at = NOW()`,
      [channelId, ticketId, guildId ?? null, channelName ?? null, html]
    );
    return true;
  } catch (e) {
    console.error("[postgresTranscripts] save failed:", e.message);
    return false;
  }
}

/**
 * @param {string} channelIdOrTicketId Discord channel id or stored ticket_id (same for default tickets)
 * @returns {Promise<string | null>} HTML or null
 */
export async function getTranscriptHtmlByChannelId(channelIdOrTicketId) {
  if (!channelIdOrTicketId) return null;
  try {
    await ensureTranscriptsTable();
    const p = getTranscriptPool();
    if (!p) return null;
    const tbl = tableName();
    const r = await p.query(
      `SELECT html FROM ${tbl} WHERE channel_id = $1 OR ticket_id = $1`,
      [channelIdOrTicketId]
    );
    return r.rows[0]?.html ?? null;
  } catch (e) {
    console.error("[postgresTranscripts] read failed:", e.message);
    return null;
  }
}
