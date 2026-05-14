import { Events, PermissionFlagsBits } from "discord.js";

/**
 * Assign JOIN_ROLE_ID to every member who joins the server.
 * Bot needs **Manage Roles** and its highest role must be above the target role.
 */
export function registerGuildMemberAdd(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    const roleId = process.env.JOIN_ROLE_ID?.trim();
    if (!roleId) return;

    try {
      const role = await member.guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        console.warn(
          `[join] JOIN_ROLE_ID not found in "${member.guild.name}" (${member.guild.id})`
        );
        return;
      }

      const me = member.guild.members.me;
      if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        console.warn(`[join] Missing Manage Roles in "${member.guild.name}"`);
        return;
      }

      if (role.managed) {
        console.warn(`[join] Role "${role.name}" is managed by an integration — skip`);
        return;
      }

      if (me.roles.highest.comparePositionTo(role) <= 0) {
        console.warn(
          `[join] Bot role must be **above** "${role.name}" in Server Settings → Roles`
        );
        return;
      }

      if (member.roles.cache.has(roleId)) return;

      await member.roles.add(role, "Auto-role on join");
    } catch (e) {
      console.error(`[join] ${member.user.tag}:`, e.message);
    }
  });
}
