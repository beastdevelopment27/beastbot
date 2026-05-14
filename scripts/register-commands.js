/**
 * Register slash commands without starting the bot.
 * Requires TOKEN in discord.env and applications.commands scope on the invite.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { REST, Routes } from "discord.js";
import { data as ticketData } from "../commands/ticketpanel.js";
import { data as updateData } from "../commands/update.js";

config({ path: resolve(process.cwd(), "discord.env") });

const token =
  process.env.TOKEN?.trim() || process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("Missing TOKEN in discord.env");
  process.exit(1);
}

const rest = new REST().setToken(token);

let applicationId =
  process.env.CLIENT_ID?.trim() ||
  process.env.DISCORD_CLIENT_ID?.trim();
if (!applicationId) {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  applicationId = app.id;
}

const guildId =
  process.env.GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim();
const body = [ticketData.toJSON(), updateData.toJSON()];

try {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body,
    });
    console.log(`Registered /ticket and /update for guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(applicationId), { body });
    console.log("Registered /ticket and /update globally.");
  }
} catch (e) {
  console.error("Failed:", e.message);
  process.exit(1);
}
