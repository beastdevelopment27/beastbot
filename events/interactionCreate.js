import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import {
  buildReviewDmButtonRow,
  buildReviewModal,
  buildSupportPanelPayload,
  buildTicketChannelPayload,
  buildTicketClosedComponents,
  buildTicketClosedEmbed,
  BUTTON_CLOSE,
  BUTTON_HELP,
  BUTTON_REVIEW_DM_PREFIX,
  INPUT_REVIEW_MESSAGE,
  INPUT_REVIEW_RATING,
  MODAL_REVIEW_SUBMIT_PREFIX,
  parseTicketCreateCustomId,
  REVIEW_EMBED_COLOR,
  SUPPORT_COLOR,
} from "../commands/ticketpanel.js";
import {
  buildUpdateEmbed,
  buildUpdateModal,
  formatUpdateNotes,
  INPUT_UPDATE_CHANGED_FILES,
  INPUT_UPDATE_FIXES,
  INPUT_UPDATE_INTEGRATIONS,
  INPUT_UPDATE_VERSION,
  MODAL_UPDATE_SUBMIT,
} from "../commands/update.js";
import { generateChannelTranscript } from "../utils/transcript.js";
import { saveTranscriptToPostgres } from "../utils/postgresTranscripts.js";

function requireIds() {
  const categoryId =
    process.env.CATEGORY_ID?.trim() ||
    process.env.DISCORD_TICKET_CATEGORY_ID?.trim();
  const closedCategoryId = process.env.CLOSED_CATEGORY_ID?.trim();
  const staffRoleId =
    process.env.STAFF_ROLE_ID?.trim() ||
    process.env.DISCORD_STAFF_ROLE_ID?.trim();
  const logChannelId = process.env.LOG_CHANNEL_ID?.trim();
  const reviewChannelId = process.env.REVIEW_CHANNEL_ID?.trim();
  return {
    categoryId,
    closedCategoryId,
    staffRoleId,
    logChannelId,
    reviewChannelId,
  };
}

/** Cooldown after a successful review post (per user, all guilds). */
const REVIEW_COOLDOWN_MS = 60_000;
const reviewSubmitCooldown = new Map();

/**
 * @param {import("discord.js").GuildBasedChannel | null} channel
 * @param {string | undefined} categoryId
 * @param {string | undefined} closedCategoryId
 */
function isTicketChannel(channel, categoryId, closedCategoryId) {
  if (!channel?.isTextBased()) return false;
  if (!categoryId) return false;
  const open = channel.parentId === categoryId;
  const archived =
    Boolean(closedCategoryId) && channel.parentId === closedCategoryId;
  return open || archived;
}

function starsFromRating(n) {
  const r = Math.min(5, Math.max(1, Math.round(Number(n))));
  return "⭐".repeat(r);
}

/**
 * @param {string} prefixFirstSegment e.g. `ticket_review_dm`
 * @param {string} customId `prefix:guildId:channelId:creatorId`
 * @returns {{ guildId: string; channelId: string; creatorId: string } | null}
 */
function parseFourPartReviewCustomId(prefixFirstSegment, customId) {
  const parts = customId.split(":");
  if (parts.length !== 4 || parts[0] !== prefixFirstSegment) return null;
  const guildId = parts[1];
  const channelId = parts[2];
  const creatorId = parts[3];
  if (!/^\d+$/.test(guildId) || !/^\d+$/.test(channelId) || !/^\d+$/.test(creatorId))
    return null;
  return { guildId, channelId, creatorId };
}

function getUpdateRoleId() {
  return process.env.UPDATE_ROLE_ID?.trim();
}

/**
 * @param {import("discord.js").GuildMember | null} member
 * @param {string | undefined} updateRoleId
 */
function canPostUpdate(member, updateRoleId) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (updateRoleId && member.roles.cache.has(updateRoleId)) return true;
  return false;
}

/**
 * Post a public message in the channel without Discord's "X used /command" reply header.
 * @param {import("discord.js").ChatInputCommandInteraction | import("discord.js").ModalSubmitInteraction} interaction
 * @param {import("discord.js").BaseMessageOptions} options
 */
async function postVisibleWithoutInteractionRef(interaction, options) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.channel.send(options);
  } catch (e) {
    await interaction.editReply({
      content: `Could not send: ${e.message}`,
    });
    throw e;
  }
  await interaction.deleteReply().catch(() => {});
}

/**
 * @param {import("discord.js").GuildChannel} channel
 */
function getTicketCreatorMemberId(channel) {
  const botId = channel.client.user.id;
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (ow.type !== OverwriteType.Member) continue;
    if (ow.id === botId) continue;
    if (ow.allow.has(PermissionFlagsBits.ViewChannel)) return ow.id;
  }
  return null;
}

/**
 * @param {import("discord.js").Guild} guild
 * @param {string} categoryId
 * @param {string} userId
 */
function findUserOpenTicket(guild, categoryId, userId) {
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    if (ch.parentId !== categoryId) continue;
    const ow = ch.permissionOverwrites.cache.get(userId);
    if (
      ow?.type === OverwriteType.Member &&
      ow.allow.has(PermissionFlagsBits.ViewChannel)
    ) {
      return ch;
    }
  }
  return null;
}

/**
 * Lowercase slug for Discord channel segment (a-z, 0-9, hyphen).
 * @param {string} input
 */
function sanitizeForDiscordChannelSegment(input) {
  const slug = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "user").slice(0, 32);
}

/**
 * `prefix-username` under the open ticket category; disambiguates if the name is taken.
 * @param {import("discord.js").Guild} guild
 * @param {string} openCategoryId
 * @param {string} prefix e.g. presale, giveaway
 * @param {string} username Discord login (no @)
 * @param {string} userId
 */
function allocateCategoryUserChannelName(
  guild,
  openCategoryId,
  prefix,
  username,
  userId
) {
  const slug = sanitizeForDiscordChannelSegment(username);
  const taken = new Set(
    [...guild.channels.cache.values()]
      .filter((c) => c.parentId === openCategoryId)
      .map((c) => c.name)
  );
  const candidates = [
    `${prefix}-${slug}`,
    `${prefix}-${slug}-${userId.slice(-6)}`,
  ];
  for (const raw of candidates) {
    const name = raw.slice(0, 100).toLowerCase();
    if (!taken.has(name)) return name;
  }
  let i = 2;
  for (;;) {
    const name = `${prefix}-${slug}-${i}`.slice(0, 100).toLowerCase();
    if (!taken.has(name)) return name;
    i += 1;
    if (i > 9999) return `${prefix}-${userId}`.slice(0, 100).toLowerCase();
  }
}

/**
 * Archive name: `closed-{previousOpenName}` (e.g. `closed-giveaway-beast`).
 * If taken, appends `-2`, `-3`, … under the closed category.
 * @param {import("discord.js").Guild} guild
 * @param {string} closedCategoryId
 * @param {string} previousTicketChannelName channel name before close/move
 */
function allocateClosedChannelName(
  guild,
  closedCategoryId,
  previousTicketChannelName
) {
  const slug = previousTicketChannelName.toLowerCase();
  const taken = new Set(
    [...guild.channels.cache.values()]
      .filter((c) => c.parentId === closedCategoryId)
      .map((c) => c.name)
  );

  const prefix = "closed-";
  const build = (extraSuffix) => {
    const extra = extraSuffix ?? "";
    const room = 100 - prefix.length - extra.length;
    const body = slug.slice(0, Math.max(1, room));
    return `${prefix}${body}${extra}`.slice(0, 100).toLowerCase();
  };

  let name = build("");
  if (!taken.has(name)) return name;
  for (let i = 2; i < 10_000; i += 1) {
    name = build(`-${i}`);
    if (!taken.has(name)) return name;
  }
  return `${prefix}${slug.slice(0, 60)}-${Date.now().toString(36)}`
    .slice(0, 100)
    .toLowerCase();
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").BaseInteraction} interaction
 */
export async function handleInteraction(client, interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: "Use this command inside a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!interaction.channel?.isTextBased()) {
        await interaction.reply({
          content: "Use this command in a text channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      try {
        await postVisibleWithoutInteractionRef(
          interaction,
          buildSupportPanelPayload()
        );
      } catch {
        /* error already surfaced via editReply in helper */
      }
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "update") {
      if (!interaction.inGuild()) {
        await interaction.reply({
          content: "Use this command inside a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await handleUpdateCommand(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === MODAL_UPDATE_SUBMIT) {
      await handleUpdateModalSubmit(interaction);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith(`${MODAL_REVIEW_SUBMIT_PREFIX}:`)
    ) {
      await handleReviewModalSubmit(client, interaction);
      return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith(`${BUTTON_REVIEW_DM_PREFIX}:`)) {
      await handleReviewDmButton(client, interaction);
      return;
    }

    if (interaction.customId === BUTTON_HELP) {
      await interaction.reply({
        content:
          "Choose a **category button** on the support panel to open a ticket. Our team will assist you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticketMeta = parseTicketCreateCustomId(interaction.customId);
    if (ticketMeta) {
      await handleCreateTicket(client, interaction, ticketMeta);
      return;
    }

    if (interaction.customId === BUTTON_CLOSE) {
      await handleCloseTicket(client, interaction);
      return;
    }
  } catch (err) {
    console.error("[interactionCreate]", err);
    try {
      if (!interaction.isRepliable()) return;
      const msg = "Something went wrong. Please try again later.";
      if (interaction.deferred) {
        await interaction.editReply({ content: msg });
      } else if (!interaction.replied) {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 */
async function handleUpdateCommand(interaction) {
  if (!interaction.channel?.isTextBased()) {
    await interaction.reply({
      content: "Use this command in a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const updateRoleId = getUpdateRoleId();

  if (!canPostUpdate(member, updateRoleId)) {
    await interaction.reply({
      content:
        "You need **Administrator** or the **update role** (UPDATE_ROLE_ID) to use `/update`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.showModal(buildUpdateModal());
  } catch (e) {
    console.error("update showModal:", e);
    await interaction.reply({
      content: "Could not open the update form. Try again.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
async function handleUpdateModalSubmit(interaction) {
  if (!interaction.inGuild() || !interaction.channel?.isTextBased()) {
    await interaction.reply({
      content: "This can only be used in a server text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);
  const updateRoleId = getUpdateRoleId();

  if (!canPostUpdate(member, updateRoleId)) {
    await interaction.reply({
      content: "You no longer have permission to post updates.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const version = interaction.fields
    .getTextInputValue(INPUT_UPDATE_VERSION)
    .trim();
  const rawFixes = interaction.fields.getTextInputValue(INPUT_UPDATE_FIXES) ?? "";
  const rawIntegrations =
    interaction.fields.getTextInputValue(INPUT_UPDATE_INTEGRATIONS) ?? "";
  const rawChanged =
    interaction.fields.getTextInputValue(INPUT_UPDATE_CHANGED_FILES) ?? "";

  if (!version) {
    await interaction.reply({
      content: "Version cannot be empty.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fixes = rawFixes.trim() ? formatUpdateNotes(rawFixes.trim()) : "";
  const integrations = rawIntegrations.trim()
    ? formatUpdateNotes(rawIntegrations.trim())
    : "";
  const changedFiles = rawChanged.trim()
    ? formatUpdateNotes(rawChanged.trim())
    : "";

  const embed = buildUpdateEmbed(version, {
    fixes,
    integrations,
    changedFiles,
  });

  try {
    await postVisibleWithoutInteractionRef(interaction, { embeds: [embed] });
  } catch (e) {
    console.error("update post:", e);
  }
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").ButtonInteraction} interaction
 * @param {{ channelPrefix: string; panelLabel: string; suffix: string }} ticketMeta
 */
async function handleCreateTicket(client, interaction, ticketMeta) {
  const { categoryId, staffRoleId, logChannelId } = requireIds();

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "Tickets can only be created in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!categoryId) {
    await interaction.reply({
      content: "Ticket system is not configured (missing CATEGORY_ID).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  const me = guild.members.me;
  if (
    !me?.permissions.has(PermissionFlagsBits.Administrator) &&
    !me?.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    await interaction.reply({
      content:
        "I need **Manage Channels** (or **Administrator**) to create tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.reply({
      content: "Invalid ticket category. Check CATEGORY_ID in your environment.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await guild.channels.fetch().catch(() => null);

  const existing = findUserOpenTicket(guild, categoryId, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `You already have an open ticket: #${existing.name}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = allocateCategoryUserChannelName(
    guild,
    categoryId,
    ticketMeta.channelPrefix,
    interaction.user.username,
    interaction.user.id
  );

  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: overwrites,
    });
  } catch (e) {
    console.error(e);
    await interaction.editReply({
      content: `Could not create the ticket channel: ${e.message}`,
    });
    return;
  }

  await channel.send(
    buildTicketChannelPayload(
      interaction.user.id,
      staffRoleId,
      ticketMeta.panelLabel,
      channel.id
    )
  );

  if (logChannelId) {
    const logCh = await guild.channels.fetch(logChannelId).catch(() => null);
    if (logCh?.isTextBased()) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🎫 Ticket Opened")
        .addFields(
          {
            name: "User",
            value: `${interaction.user.tag} (\`${interaction.user.id}\`)`,
            inline: true,
          },
          {
            name: "Channel",
            value: `#${channel.name}`,
            inline: true,
          },
          {
            name: "Category",
            value: ticketMeta.panelLabel,
            inline: true,
          }
        )
        .setTimestamp(new Date());
      await logCh.send({ embeds: [logEmbed] }).catch((e) => console.error("Log send:", e));
    }
  }

  await interaction.editReply({
    content: `Your ticket is ready: #${channel.name}`,
  });
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").ButtonInteraction} interaction
 */
async function handleReviewDmButton(client, interaction) {
  const parsed = parseFourPartReviewCustomId(
    BUTTON_REVIEW_DM_PREFIX,
    interaction.customId
  );
  if (!parsed) return;

  if (interaction.user.id !== parsed.creatorId) {
    await interaction.reply({
      content: "Only the person who opened this ticket can use this review button.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = await client.guilds.fetch(parsed.guildId).catch(() => null);
  if (!guild) {
    await interaction.reply({
      content:
        "Could not load that server. The review link may be invalid or the bot was removed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ch = await guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!ch?.isTextBased()) {
    await interaction.reply({
      content: "That ticket channel could not be found. It may have been deleted.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.showModal(
      buildReviewModal(parsed.guildId, parsed.channelId, parsed.creatorId)
    );
  } catch (e) {
    console.error("showModal review (DM):", e);
    await interaction.reply({
      content: "Could not open the review form. Try again.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").ModalSubmitInteraction} interaction
 */
async function handleReviewModalSubmit(client, interaction) {
  const { categoryId, closedCategoryId, reviewChannelId } = requireIds();

  const parsed = parseFourPartReviewCustomId(
    MODAL_REVIEW_SUBMIT_PREFIX,
    interaction.customId
  );
  if (!parsed) {
    await interaction.reply({
      content: "Invalid review form.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== parsed.creatorId) {
    await interaction.reply({
      content: "Only the ticket owner can submit this review.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = await client.guilds.fetch(parsed.guildId).catch(() => null);
  if (!guild) {
    await interaction.reply({
      content: "Could not load that server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ticketChannel = await guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!ticketChannel?.isTextBased()) {
    await interaction.reply({
      content: "That ticket channel could not be found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isTicketChannel(ticketChannel, categoryId, closedCategoryId)) {
    await interaction.reply({
      content: "This review link is no longer valid for that channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!reviewChannelId) {
    await interaction.reply({
      content:
        "Reviews are not configured on this bot (missing REVIEW_CHANNEL_ID).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ratingRaw = interaction.fields.getTextInputValue(INPUT_REVIEW_RATING).trim();
  const reviewText = interaction.fields
    .getTextInputValue(INPUT_REVIEW_MESSAGE)
    .trim();

  const rating = parseInt(ratingRaw, 10);
  if (
    Number.isNaN(rating) ||
    rating < 1 ||
    rating > 5 ||
    ratingRaw.length !== 1
  ) {
    await interaction.reply({
      content: "Please enter a valid rating: a single digit from **1** to **5**.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (reviewText.length < 3) {
    await interaction.reply({
      content: "Your review message is too short.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = Date.now();
  const last = reviewSubmitCooldown.get(interaction.user.id) ?? 0;
  if (now - last < REVIEW_COOLDOWN_MS) {
    const waitSec = Math.ceil((REVIEW_COOLDOWN_MS - (now - last)) / 1000);
    await interaction.reply({
      content: `Please wait **${waitSec}s** before submitting another review.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const reviewCh = await guild.channels.fetch(reviewChannelId).catch(() => null);
  if (!reviewCh?.isTextBased()) {
    await interaction.reply({
      content: "Review channel is missing or not a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const stars = starsFromRating(rating);
  const embed = new EmbedBuilder()
    .setColor(REVIEW_EMBED_COLOR)
    .setAuthor({
      name: `Review from ${interaction.user.username}`,
      iconURL: interaction.user.displayAvatarURL({ extension: "png", size: 128 }),
    })
    .setDescription([stars, "", reviewText].join("\n"))
    .addFields({
      name: "Ticket",
      value: `#${ticketChannel.name}`,
      inline: false,
    })
    .setTimestamp(new Date());

  try {
    await reviewCh.send({
      embeds: [embed],
      allowedMentions: { users: [interaction.user.id] },
    });
    reviewSubmitCooldown.set(interaction.user.id, Date.now());
    await interaction.reply({
      content: "Thanks! Your review has been submitted.",
      flags: MessageFlags.Ephemeral,
    });
  } catch (e) {
    console.error("Review post failed:", e);
    await interaction.reply({
      content: `Could not post your review: ${e.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").ButtonInteraction} interaction
 */
async function handleCloseTicket(client, interaction) {
  if (!interaction.inGuild() || !interaction.channel?.isTextBased()) {
    await interaction.reply({
      content: "This can only be used inside a ticket channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  const { categoryId, closedCategoryId, staffRoleId, logChannelId, reviewChannelId } =
    requireIds();

  if (!staffRoleId) {
    await interaction.reply({
      content: "Ticket closing is not configured (missing STAFF_ROLE_ID).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!closedCategoryId) {
    await interaction.reply({
      content: "Ticket archive is not configured (missing CLOSED_CATEGORY_ID).",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (channel.parentId === closedCategoryId) {
    await interaction.reply({
      content: "This ticket is already closed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!categoryId || channel.parentId !== categoryId) {
    await interaction.reply({
      content:
        "This channel is not an open ticket under the configured category.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = await interaction.guild.members
    .fetch(interaction.user.id)
    .catch(() => null);

  if (!member || !member.roles.cache.has(staffRoleId)) {
    await interaction.reply({
      content: "Only staff can close tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  /** Refresh channel (overwrites live on the fetched guild channel). */
  let ticketChannel = channel;
  const fetched = await interaction.guild.channels
    .fetch(channel.id)
    .catch(() => null);
  if (fetched?.isTextBased()) ticketChannel = fetched;

  const guild = interaction.guild;
  const creatorId = getTicketCreatorMemberId(ticketChannel);
  const channelNameBefore = ticketChannel.name;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply({ content: "Closing ticket..." });

  try {
    const { html } = await generateChannelTranscript(ticketChannel, {
      closed: true,
    });
    await saveTranscriptToPostgres({
      channelId: ticketChannel.id,
      ticketId: ticketChannel.id,
      guildId: guild.id,
      channelName: channelNameBefore,
      html,
    });
  } catch (e) {
    console.error("Transcript failed:", e);
  }

  /** Whether the ticket owner received the close notification in DMs. */
  let closeDmOk = false;

  const closeReason = process.env.TICKET_CLOSE_REASON?.trim() || "Resolved";
  const claimedByText =
    process.env.TICKET_CLAIMED_BY_DISPLAY?.trim() || "Not claimed";
  const transcriptViewUrl = process.env.TRANSCRIPT_VIEW_URL?.trim();

  const closedPanelEmbed = buildTicketClosedEmbed({
    guild,
    ticketChannel,
    creatorId,
    closedByUser: interaction.user,
    closeReason,
    claimedByText,
  });
  const closedComponents = buildTicketClosedComponents(
    ticketChannel.id,
    transcriptViewUrl
  );

  const closePanelMentions = {
    users: [
      ...new Set(
        [interaction.user.id, ...(creatorId ? [creatorId] : [])].filter(Boolean)
      ),
    ],
  };

  /** @type {import("discord.js").BaseMessageOptions} */
  const closePanelPayload = {
    embeds: [closedPanelEmbed],
    allowedMentions: closePanelMentions,
  };
  if (closedComponents.length > 0) {
    closePanelPayload.components = closedComponents;
  }

  try {
    await ticketChannel.send(closePanelPayload);
  } catch (e) {
    console.error("Ticket close panel (in-channel) failed:", e);
  }

  if (logChannelId) {
    const logCh = await guild.channels.fetch(logChannelId).catch(() => null);
    if (logCh?.isTextBased()) {
      try {
        await logCh.send({
          embeds: [
            buildTicketClosedEmbed({
              guild,
              ticketChannel,
              creatorId,
              closedByUser: interaction.user,
              closeReason,
              claimedByText,
            }),
          ],
          ...(closedComponents.length > 0 ? { components: closedComponents } : {}),
          allowedMentions: closePanelMentions,
        });
      } catch (e) {
        console.error("Close log send failed:", e);
      }
    }
  }

  if (creatorId) {
    try {
      const creator = await client.users.fetch(creatorId);
      const dmClosedEmbed = buildTicketClosedEmbed({
        guild,
        ticketChannel,
        creatorId,
        closedByUser: interaction.user,
        closeReason,
        claimedByText,
      });
      dmClosedEmbed.setFooter({
        text: transcriptViewUrl
          ? "Use the button below to open your transcript in your browser."
          : "Web transcript button is unavailable — ask staff, or set TRANSCRIPT_VIEW_URL on the bot.",
      });

      const dmMentionUsers = [
        ...new Set(
          [interaction.user.id, ...(creatorId ? [creatorId] : [])].filter(Boolean)
        ),
      ];

      /** @type {import("discord.js").BaseMessageOptions} */
      const dmPayload = {
        embeds: [dmClosedEmbed],
        allowedMentions: { users: dmMentionUsers },
      };

      const dmRows = [];
      if (closedComponents.length > 0) {
        dmRows.push(...closedComponents);
      }
      if (reviewChannelId) {
        dmRows.push(
          buildReviewDmButtonRow(guild.id, ticketChannel.id, creatorId)
        );
      }
      if (dmRows.length > 0) {
        dmPayload.components = dmRows;
      }

      await creator.send(dmPayload);
      closeDmOk = true;
    } catch (e) {
      console.error("Close DM to ticket owner failed:", e.message);
    }
  }

  try {
    const closedCategory = await guild.channels
      .fetch(closedCategoryId)
      .catch(() => null);
    if (!closedCategory || closedCategory.type !== ChannelType.GuildCategory) {
      await interaction.editReply({
        content:
          "Could not move ticket: invalid CLOSED_CATEGORY_ID. Check your environment.",
      });
      return;
    }

    await guild.channels.fetch().catch(() => null);
    const closedName = allocateClosedChannelName(
      guild,
      closedCategoryId,
      ticketChannel.name
      );

    ticketChannel = await ticketChannel.setParent(closedCategoryId, {
      lockPermissions: false,
    });

    await ticketChannel.setName(closedName, "Ticket closed — archive");

    const archiveOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ];

    if (creatorId) {
      archiveOverwrites.push({
        id: creatorId,
        deny: [PermissionFlagsBits.ViewChannel],
      });
    }

    await ticketChannel.permissionOverwrites.set(
      archiveOverwrites,
      "Ticket closed — remove owner access"
    );

    let summary = `Ticket closed, archived as #${ticketChannel.name}, and logged.`;
    if (creatorId) {
      if (closeDmOk) {
        summary += transcriptViewUrl
          ? " The ticket owner was notified in DMs with a browser transcript link."
          : " The ticket owner was notified in DMs. Set TRANSCRIPT_VIEW_URL for a transcript link button.";
      } else {
        summary +=
          " Could not DM the ticket owner (DMs closed or blocked).";
      }
    }

    await interaction.editReply({
      content: summary,
    });
  } catch (e) {
    console.error("Archive ticket failed:", e);
    await interaction.editReply({
      content: `Could not finish closing the ticket: ${e.message}`,
    });
  }
}
