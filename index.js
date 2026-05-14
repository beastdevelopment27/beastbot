import { config } from "dotenv";
import { resolve } from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { data as ticketCommandData } from "./commands/ticketpanel.js";
import { data as updateCommandData } from "./commands/update.js";
import { registerGuildMemberAdd } from "./events/guildMemberAdd.js";
import { handleInteraction } from "./events/interactionCreate.js";

config({ path: resolve(process.cwd(), "discord.env") });

const token =
  process.env.TOKEN?.trim() || process.env.DISCORD_TOKEN?.trim();
if (!token) {
  console.error("Missing TOKEN. Set it in discord.env (see discord.env.example).");
  process.exit(1);
}

async function registerSlashCommands() {
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
  const body = [ticketCommandData.toJSON(), updateCommandData.toJSON()];
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body,
    });
    console.log(`Registered /ticket and /update for guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(applicationId), { body });
    console.log("Registered /ticket and /update globally (may take up to ~1 hour).");
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Ready — logged in as ${c.user.tag} (${c.user.id})`);
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const { ensureTranscriptsTable } = await import(
        "./utils/postgresTranscripts.js"
      );
      await ensureTranscriptsTable();
      console.log("PostgreSQL transcripts table ready.");
    } catch (e) {
      console.warn("PostgreSQL transcript init:", e.message);
    }
  }
  try {
    await registerSlashCommands();
  } catch (e) {
    console.warn("Slash registration failed (bot still online):", e.message);
  }
});

client.on(Events.InteractionCreate, (i) => handleInteraction(client, i));

registerGuildMemberAdd(client);

client.login(token).catch((err) => {
  console.error("Login failed:", err.message);
  process.exit(1);
});
