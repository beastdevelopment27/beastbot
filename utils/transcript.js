/**
 * Fetch every message in a channel (oldest → newest) and build an HTML transcript.
 */

/**
 * @param {import("discord.js").TextChannel} channel
 * @returns {Promise<import("discord.js").Message[]>}
 */
export async function fetchAllMessages(channel) {
  const collected = [];
  let before;

  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safe fragment for filenames (Discord channel names). */
function filenameSlug(name) {
  return String(name || "ticket")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "ticket";
}

/**
 * @param {import("discord.js").Message[]} messages
 * @param {{ channelName: string; channelId: string; guildName: string; closed?: boolean }} meta
 * @returns {string}
 */
export function buildTranscriptHtml(messages, meta) {
  const rows = messages
    .map((m) => {
      const when = m.createdAt.toISOString().replace("T", " ").slice(0, 19);
      const author = escapeHtml(m.author.tag);
      const content = escapeHtml(m.cleanContent || "");
      const attachments =
        m.attachments.size > 0
          ? `<div class="attachments">${[...m.attachments.values()]
              .map((a) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`)
              .join(" · ")}</div>`
          : "";
      const embedNote =
        m.embeds.length > 0
          ? `<div class="embed">[${m.embeds.length} embed(s)]</div>`
          : "";
      return `<div class="msg">
  <div class="meta"><span class="user">${author}</span> <span class="time">${when}</span></div>
  <div class="body">${content || "<em>(no text)</em>"}</div>
  ${attachments}
  ${embedNote}
</div>`;
    })
    .join("\n");

  const closed = Boolean(meta.closed);
  const titleLead = closed ? "Closed transcript" : "Transcript";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${titleLead} — ${escapeHtml(meta.channelName)}</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: "Segoe UI", system-ui, sans-serif; background: #313338; color: #dbdee1; margin: 0; padding: 24px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    .sub { color: #949ba4; font-size: 0.9rem; margin-bottom: 24px; }
    .msg { background: #2b2d31; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; border: 1px solid #1e1f22; }
    .meta { font-size: 0.8rem; margin-bottom: 6px; }
    .user { color: #5865f2; font-weight: 600; }
    .time { color: #949ba4; }
    .body { white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
    .attachments, .embed { margin-top: 8px; font-size: 0.85rem; color: #b5bac1; }
    a { color: #00a8fc; }
  </style>
</head>
<body>
  <h1>${titleLead} — ${escapeHtml(meta.guildName)} — #${escapeHtml(meta.channelName)}</h1>
  <div class="sub">${
    closed ? "<strong>Closed ticket.</strong> " : ""
  }Channel ID: ${escapeHtml(meta.channelId)} · ${messages.length} message(s)</div>
  ${rows || "<p><em>No messages.</em></p>"}
</body>
</html>`;
}

/**
 * @param {import("discord.js").TextChannel} channel
 * @param {{ closed?: boolean }} [options]
 * @returns {Promise<{ html: string; filename: string }>}
 */
export async function generateChannelTranscript(channel, options = {}) {
  const closed = Boolean(options.closed);
  const messages = await fetchAllMessages(channel);
  const html = buildTranscriptHtml(messages, {
    channelName: channel.name,
    channelId: channel.id,
    guildName: channel.guild.name,
    closed,
  });
  const slug = filenameSlug(channel.name);
  const filename = closed
    ? `closed-${slug}-${channel.id}-${Date.now()}.html`
    : `transcript-${channel.id}-${Date.now()}.html`;
  return { html, filename };
}
