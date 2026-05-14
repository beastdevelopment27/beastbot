import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const SUPPORT_COLOR = 0x5865f2;

/** Title on the first message inside a new ticket channel */
export const TICKET_CHANNEL_EMBED_TITLE = "Beast Development - Ticket System";
/** Orange accent for review embeds posted to the review channel */
export const REVIEW_EMBED_COLOR = 0xff6600;

/** Button on close-DM: `ticket_review_dm:<guildId>:<channelId>:<creatorId>` */
export const BUTTON_REVIEW_DM_PREFIX = "ticket_review_dm";

/** Modal submit id: `ticket_review_submit:<guildId>:<channelId>:<creatorId>` */
export const MODAL_REVIEW_SUBMIT_PREFIX = "ticket_review_submit";

export const INPUT_REVIEW_RATING = "review_rating";
export const INPUT_REVIEW_MESSAGE = "review_message";

/** Legacy single “Create Ticket” id (still opens a general ticket). */
export const BUTTON_CREATE = "ticket:create";
export const BUTTON_HELP = "ticket:help";

/** Category buttons: `ticket:create:<suffix>` — max 100 chars total. */
export const TICKET_CREATE_SUFFIX = {
  PRESALE: "presale",
  PRODUCT: "product",
  ROLES: "roles",
  GIVEAWAY: "giveaway",
  PARTNERSHIP: "partnership",
  GENERAL: "general",
};

/**
 * @typedef {{ channelPrefix: string; panelLabel: string }} TicketCategoryMeta
 * @type {Record<string, TicketCategoryMeta>}
 */
export const TICKET_CATEGORY_META = {
  [TICKET_CREATE_SUFFIX.PRESALE]: {
    channelPrefix: "presale",
    panelLabel: "Pre-Sale Questions",
  },
  [TICKET_CREATE_SUFFIX.PRODUCT]: {
    channelPrefix: "product",
    panelLabel: "Script / Map Support",
  },
  [TICKET_CREATE_SUFFIX.ROLES]: {
    channelPrefix: "roles",
    panelLabel: "Claim Customer Roles",
  },
  [TICKET_CREATE_SUFFIX.GIVEAWAY]: {
    channelPrefix: "giveaway",
    panelLabel: "Giveaway Winner",
  },
  [TICKET_CREATE_SUFFIX.PARTNERSHIP]: {
    channelPrefix: "partner",
    panelLabel: "Partnership Inquiry",
  },
  [TICKET_CREATE_SUFFIX.GENERAL]: {
    channelPrefix: "ticket",
    panelLabel: "Other / General Inquiry",
  },
};

/**
 * @param {string} customId
 * @returns {TicketCategoryMeta & { suffix: string }} | null
 */
export function parseTicketCreateCustomId(customId) {
  if (customId === BUTTON_CREATE) {
    return {
      suffix: TICKET_CREATE_SUFFIX.GENERAL,
      ...TICKET_CATEGORY_META[TICKET_CREATE_SUFFIX.GENERAL],
    };
  }
  const prefix = `${BUTTON_CREATE}:`;
  if (!customId.startsWith(prefix)) return null;
  const suffix = customId.slice(prefix.length);
  const meta = TICKET_CATEGORY_META[suffix];
  if (!meta) return null;
  return { suffix, ...meta };
}
export const BUTTON_CLOSE = "ticket:close";

export const data = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription(
    "Post the Beast Development support panel (embed + category buttons)."
  );

/** Panel shown by /ticket — Support Center embed + six category buttons. */
export function buildSupportPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(SUPPORT_COLOR)
    .setTitle("Beast Development - Support Center")
    .setDescription(
      [
        "Select the appropriate support category below to create a ticket.",
        "",
        "**Quick guidelines**",
        "• One open ticket per member — updates stay in your ticket channel.",
        "• Include script name, Tebex / purchase identifiers, and reproduction steps.",
        "• Attach screenshots or `.fxap` / logs when reporting bugs.",
        "",
        "*Premium FiveM · Scripts · Maps · Tebex · storefront routing*",
        "",
        "— Beast Development · Premium FiveM Scripts & Tebex Support · Beast Test",
        "",
        "🛒 **Pre-Sale Questions**",
        "If you have any purchase-related questions before buying, please contact us.",
        "",
        "📦 **Script / Map Support**",
        "If you are facing issues with any purchased script or map, open a support ticket here.",
        "",
        "✅ **Claim Customer Roles**",
        "Claim your customer roles after purchasing products from our Tebex store.",
        "",
        "🎉 **Giveaway Winner**",
        "I won a giveaway and would like to claim my reward.",
        "",
        "🤝 **Partnership Inquiry**",
        "Choose this option for partnerships, collaborations, or sponsorship inquiries.",
        "",
        "❓ **Other / General Inquiry**",
        "For anything not listed above, create a general support ticket.",
      ].join("\n")
    );

  const secondary = ButtonStyle.Secondary;

  const btn = (suffix, label, emoji) =>
    new ButtonBuilder()
      .setCustomId(`${BUTTON_CREATE}:${suffix}`)
      .setLabel(label)
      .setStyle(secondary)
      .setEmoji(emoji);

  const row1 = new ActionRowBuilder().addComponents(
    btn(TICKET_CREATE_SUFFIX.PRESALE, "Pre-Sale Ticket", "🛒"),
    btn(TICKET_CREATE_SUFFIX.PRODUCT, "Product Support", "📦"),
    btn(TICKET_CREATE_SUFFIX.ROLES, "Customer Roles", "✅")
  );

  const row2 = new ActionRowBuilder().addComponents(
    btn(TICKET_CREATE_SUFFIX.GIVEAWAY, "Giveaway Ticket", "🎉"),
    btn(TICKET_CREATE_SUFFIX.PARTNERSHIP, "Partnership Ticket", "🤝"),
    btn(TICKET_CREATE_SUFFIX.GENERAL, "General Ticket", "❓")
  );

  return {
    embeds: [embed],
    components: [row1, row2],
    allowedMentions: { parse: [] },
  };
}

/** Green accent for “ticket closed” panel (matches common ticket-bot style). */
export const TICKET_CLOSED_EMBED_COLOR = 0x57f287;

/**
 * Short numeric display for “Ticket ID” (derived from channel snowflake).
 * @param {string} channelId
 */
export function ticketClosedDisplayNumber(channelId) {
  return String(Number(BigInt(channelId) % 1000000n));
}

/**
 * Rich embed shown when a ticket is closed (log + in-channel before archive).
 * @param {object} p
 * @param {import("discord.js").Guild} p.guild
 * @param {{ id: string; createdTimestamp: number }} p.ticketChannel
 * @param {string | null} p.creatorId
 * @param {import("discord.js").User} p.closedByUser
 * @param {string} [p.closeReason]
 * @param {string} [p.claimedByText]
 */
export function buildTicketClosedEmbed(p) {
  const {
    guild,
    ticketChannel,
    creatorId,
    closedByUser,
    closeReason = "Resolved",
    claimedByText = "Not claimed",
  } = p;

  const displayId = ticketClosedDisplayNumber(ticketChannel.id);
  const openedVal = creatorId ? `<@${creatorId}>` : "Unknown";
  const openTs = Math.floor(ticketChannel.createdTimestamp / 1000);

  return new EmbedBuilder()
    .setColor(TICKET_CLOSED_EMBED_COLOR)
    .setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ size: 128 }) ?? undefined,
    })
    .setTitle("Ticket Closed")
    .addFields(
      { name: "#️⃣ Ticket ID", value: displayId, inline: true },
      { name: "✅ Opened By", value: openedVal, inline: true },
      { name: "🔒 Closed By", value: `<@${closedByUser.id}>`, inline: true },
      { name: "🕐 Open Time", value: `<t:${openTs}:F>`, inline: true },
      { name: "👤 Claimed By", value: claimedByText, inline: true },
      { name: "❓ Reason", value: closeReason, inline: false }
    )
    .setTimestamp(new Date());
}

/**
 * Link row: opens the transcript at `https://<host>/<channelId>` (Vercel-friendly).
 *
 * `TRANSCRIPT_VIEW_URL` may be either:
 * - Site base: `https://my-app.vercel.app` → `https://my-app.vercel.app/<channelId>`
 * - Full pattern: any URL containing `{channelId}` (replaced with the ticket channel id)
 *
 * @param {string} ticketChannelId
 * @param {string | undefined} viewUrlTemplate
 */
export function buildTicketClosedComponents(ticketChannelId, viewUrlTemplate) {
  if (!viewUrlTemplate) return [];
  const raw = viewUrlTemplate.trim();
  const url = raw.includes("{channelId}")
    ? raw.replaceAll("{channelId}", ticketChannelId).trim()
    : `${raw.replace(/\/+$/, "")}/${ticketChannelId}`;
  if (!/^https?:\/\//i.test(url)) return [];
  try {
    new URL(url);
  } catch {
    return [];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Open transcript in browser")
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setEmoji("🌐")
    ),
  ];
}

/**
 * @param {string} userId Ticket creator
 * @param {string | undefined} staffRoleId If set, `<@&role>` is included in `content`
 * @param {string | undefined} categoryLabel e.g. "Pre-Sale Questions" from the panel
 * @param {string} ticketChannelId New channel id (shown as Ticket ID in the embed footer)
 */
export function buildTicketChannelPayload(
  userId,
  staffRoleId,
  categoryLabel,
  ticketChannelId
) {
  const staffPart = staffRoleId ? `<@&${staffRoleId}> ` : "";
  const content = `${staffPart}<@${userId}>`.trim();

  const descriptionLines = [
    `Welcome <@${userId}>, please be patient. Our team will reach you as soon as possible.`,
  ];
  if (categoryLabel) {
    descriptionLines.push("", `**Category:** ${categoryLabel}`);
  }

  const embed = new EmbedBuilder()
    .setColor(SUPPORT_COLOR)
    .setTitle(TICKET_CHANNEL_EMBED_TITLE)
    .setDescription(descriptionLines.join("\n"))
    .setFooter({ text: `Ticket ID: ${ticketChannelId}` });

  const close = new ButtonBuilder()
    .setCustomId(BUTTON_CLOSE)
    .setLabel("Close Ticket")
    .setStyle(ButtonStyle.Danger)
    .setEmoji("🔒");

  const row = new ActionRowBuilder().addComponents(close);

  return {
    content,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      users: [userId],
      roles: staffRoleId ? [staffRoleId] : [],
    },
  };
}

/**
 * Row for the ticket-close DM (opens review modal; works in DMs).
 * @param {string} guildId
 * @param {string} ticketChannelId
 * @param {string} creatorUserId
 */
export function buildReviewDmButtonRow(guildId, ticketChannelId, creatorUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${BUTTON_REVIEW_DM_PREFIX}:${guildId}:${ticketChannelId}:${creatorUserId}`
      )
      .setLabel("Leave Review")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⭐")
  );
}

/**
 * Review modal — `customId` carries guild, channel, and opener (archived tickets deny View on opener).
 * @param {string} guildId
 * @param {string} ticketChannelId
 * @param {string} creatorUserId
 */
export function buildReviewModal(guildId, ticketChannelId, creatorUserId) {
  const rating = new TextInputBuilder()
    .setCustomId(INPUT_REVIEW_RATING)
    .setLabel("Rating (1-5 stars)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("1 to 5")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(1);

  const message = new TextInputBuilder()
    .setCustomId(INPUT_REVIEW_MESSAGE)
    .setLabel("Review message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Tell us how we did...")
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(1000);

  return new ModalBuilder()
    .setCustomId(
      `${MODAL_REVIEW_SUBMIT_PREFIX}:${guildId}:${ticketChannelId}:${creatorUserId}`
    )
    .setTitle("Submit Review")
    .addComponents(
      new ActionRowBuilder().addComponents(rating),
      new ActionRowBuilder().addComponents(message)
    );
}

