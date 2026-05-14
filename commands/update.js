import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("update")
  .setDescription("Send update/patch notes");

export const MODAL_UPDATE_SUBMIT = "update_submit";
export const INPUT_UPDATE_VERSION = "update_version";
export const INPUT_UPDATE_FIXES = "update_fixes";
export const INPUT_UPDATE_INTEGRATIONS = "update_integrations";
export const INPUT_UPDATE_CHANGED_FILES = "update_changed_files";

/** Green accent per spec */
export const UPDATE_EMBED_COLOR = 0x00ff88;

/** Last block in every update embed — Cfx.re Portal link */
export const CFX_PORTAL_EMBED_VALUE =
  "Update available in https://portal.cfx.re/assets/granted-assets";

const FIELD_VALUE_MAX = 1024;

/**
 * Light touch: ensure `-word` becomes `- word` for bullets; preserve blank lines.
 * @param {string} text
 */
export function formatUpdateNotes(text) {
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*-\S/.test(line) && !/^\s*-\s/.test(line)) {
        return line.replace(/^(\s*)-(\S)/, "$1- $2");
      }
      return line;
    })
    .join("\n")
    .trim();
}

function clampEmbedFieldValue(text) {
  if (text.length <= FIELD_VALUE_MAX) return text;
  return `${text.slice(0, FIELD_VALUE_MAX - 1)}…`;
}

export function buildUpdateModal() {
  const version = new TextInputBuilder()
    .setCustomId(INPUT_UPDATE_VERSION)
    .setLabel("Version")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 2.4.0")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(80);

  const fixes = new TextInputBuilder()
    .setCustomId(INPUT_UPDATE_FIXES)
    .setLabel("Fixes")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("One per line, e.g.\n- Fix camera bug")
    .setRequired(false)
    .setMaxLength(900);

  const integrations = new TextInputBuilder()
    .setCustomId(INPUT_UPDATE_INTEGRATIONS)
    .setLabel("Integrations")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("e.g.\n- Added banking support")
    .setRequired(false)
    .setMaxLength(900);

  const changedFiles = new TextInputBuilder()
    .setCustomId(INPUT_UPDATE_CHANGED_FILES)
    .setLabel("Changed files")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("e.g.\n- client/cl-file.lua")
    .setRequired(false)
    .setMaxLength(900);

  return new ModalBuilder()
    .setCustomId(MODAL_UPDATE_SUBMIT)
    .setTitle("Send Update")
    .addComponents(
      new ActionRowBuilder().addComponents(version),
      new ActionRowBuilder().addComponents(fixes),
      new ActionRowBuilder().addComponents(integrations),
      new ActionRowBuilder().addComponents(changedFiles)
    );
}

/**
 * Single embed: only includes embed fields for sections that have text.
 * @param {string} version
 * @param {{ fixes: string; integrations: string; changedFiles: string }} sections trimmed formatted strings (may be empty)
 */
export function buildUpdateEmbed(version, sections) {
  const title = `Update: ${version.trim().slice(0, 240)}`;

  const embed = new EmbedBuilder()
    .setColor(UPDATE_EMBED_COLOR)
    .setTitle(title)
    .setFooter({ text: "Update System" })
    .setTimestamp(new Date());

  if (sections.fixes.length > 0) {
    embed.addFields({
      name: "Fixes",
      value: clampEmbedFieldValue(sections.fixes),
      inline: false,
    });
  }
  if (sections.integrations.length > 0) {
    embed.addFields({
      name: "Integrations",
      value: clampEmbedFieldValue(sections.integrations),
      inline: false,
    });
  }
  if (sections.changedFiles.length > 0) {
    embed.addFields({
      name: "Changed Files",
      value: clampEmbedFieldValue(sections.changedFiles),
      inline: false,
    });
  }

  embed.addFields({
    name: "\u200b",
    value: CFX_PORTAL_EMBED_VALUE,
    inline: false,
  });

  return embed;
}
