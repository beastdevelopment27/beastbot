/**
 * Serves ticket transcripts from PostgreSQL (same DB the bot writes on close). *
 * 1. Put `DATABASE_URL` in discord.env (Neon / Postgres URI, e.g. postgresql://...?sslmode=require).
 * 2. Optional: `POSTGRES_TRANSCRIPTS_TABLE=ticket_transcripts` (default table name)
 * 3. `npm run serve-transcripts`
 * 4. Open http://localhost:3847/<channelId>  (or legacy /t/<channelId>.html)
 *
 * Discord: `TRANSCRIPT_VIEW_URL=https://your-public-host` → button opens `https://host/<channelId>`
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { resolve } from "node:path";
import { config } from "dotenv";
import { getTranscriptHtmlByChannelId } from "../utils/postgresTranscripts.js";

config({ path: resolve(process.cwd(), "discord.env") });

const port = Number(process.env.TRANSCRIPT_HTTP_PORT?.trim() || 3847);
const dirRaw = process.env.TRANSCRIPT_PUBLIC_DIR?.trim();
const transcriptsDir = dirRaw
  ? path.isAbsolute(dirRaw)
    ? dirRaw
    : path.join(process.cwd(), dirRaw)
  : null;

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405).end();
    return;
  }

  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    res.writeHead(400).end();
    return;
  }

  /** @type {RegExpMatchArray | null} */
  let m = pathname.match(/^\/(\d{17,22})$/);
  if (!m) m = pathname.match(/^\/t\/(\d+)\.html$/);
  if (!m) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      [
        "Transcript server",
        "",
        "GET /<channelId>  (Discord snowflake, e.g. /1504525513660567562)",
        "GET /t/<channelId>.html  (legacy)",
        process.env.DATABASE_URL ? "Source: PostgreSQL" : "Source: (set DATABASE_URL)",
        transcriptsDir ? `Fallback files: ${transcriptsDir}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return;
  }

  const channelId = m[1];

  if (process.env.DATABASE_URL?.trim()) {
    const html = await getTranscriptHtmlByChannelId(channelId);
    if (html) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=60",
      });
      res.end(html);
      return;
    }
  }

  if (transcriptsDir) {
    try {
      const file = path.join(transcriptsDir, `${channelId}.html`);
      const data = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=120",
      });
      res.end(data);
      return;
    } catch {
      /* fall through */
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Transcript not found.");
});

server.listen(port, () => {
  console.log(
    `Transcript web: http://localhost:${port}/<channelId>  (legacy: /t/<channelId>.html)`
  );
});
