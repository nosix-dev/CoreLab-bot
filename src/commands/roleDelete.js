// /role-delete — choisir les rôles à supprimer (menu paginé), puis confirmer.
// Réservé aux administrateurs. Ignore @everyone, les rôles gérés par une
// intégration/bot et les rôles au-dessus du bot (ou de l'utilisateur).
// Le menu liste tous les rôles supprimables (25 par page) : plus besoin de chercher.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const MAX_ROLES = 25;   // max de rôles sélectionnés au total
const PAGE_SIZE = 25;   // max d'options par menu (limite Discord)
const safeName = r => r.name.replace(/@/g, '@\u200b');

const roleDelete = {
  data: new SlashCommandBuilder()
    .setName('role-delete')
    .setDescription('Choisir les rôles à supprimer')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o
      .setName('raison')
      .setDescription('Raison de la suppression')
      .setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Cette commande est réservée aux administrateurs.', flags: MessageFlags.Ephemeral });
    }
    const guild = interaction.guild;
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Le bot n\'a pas la permission de gérer les rôles.', flags: MessageFlags.Ephemeral });
    }

    const reason = interaction.options.getString('raison') || `Suppression via /role-delete par ${interaction.user.tag}`;
    const isOwner = interaction.user.id === guild.ownerId;
    const myTop = interaction.member.roles.highest.position;

    let selection = [];   // ids des rôles choisis
    let confirming = false;
    let page = 0;

    // Vérifie qu'un rôle peut être supprimé ; renvoie un message d'erreur ou null.
    const check = role => {
      if (role.id === guild.id) return '❌ @everyone ne peut pas être supprimé.';
      if (role.managed) return '❌ Ce rôle est géré par un bot / une intégration.';
      if (!role.editable) return '❌ Ce rôle est au-dessus (ou égal) au rôle du bot.';
      if (!isOwner && role.position >= myTop) return '❌ Ce rôle est au-dessus (ou égal) à votre rôle le plus haut.';
      return null;
    };

    // Rôles supprimables, du plus haut au plus bas.
    const getDeletable = () => [...guild.roles.cache.values()]
      .filter(r => !check(r))
      .sort((a, b) => b.position - a.position);

    const totalPages = () => Math.max(1, Math.ceil(getDeletable().length / PAGE_SIZE));
    const getPageRoles = () => getDeletable().slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const roleList = () => selection
      .map((id, n) => {
        const r = guild.roles.cache.get(id);
        return `${n + 1}. ${r ? safeName(r) : `(rôle ${id})`}`;
      })
      .join('\n');

    const render = () => {
      if (confirming) {
        return {
          content: `🚨 Supprimer définitivement **${selection.length}** rôle(s) ? Action irréversible :\n${roleList()}\nRaison : ${reason}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('roledelete_confirm').setLabel('✅ Confirmer').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('roledelete_back').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
          )],
          allowedMentions: { parse: [] }
        };
      }

      const pages = totalPages();
      if (page >= pages) page = pages - 1;
      const pageRoles = getPageRoles();

      const header = selection.length
        ? `🗑️ **${selection.length}/${MAX_ROLES}** rôle(s) sélectionné(s) :\n${roleList()}\n\n*Cochez / décochez des rôles dans le menu. La sélection est conservée entre les pages.*`
        : '🗑️ Cochez les rôles à supprimer dans le menu ci-dessous (naviguez avec ◀ ▶).';

      const rows = [];

      if (pageRoles.length) {
        rows.push(new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('roledelete_select')
            .setPlaceholder(`Rôles — page ${page + 1}/${pages}`)
            .setMinValues(0)
            .setMaxValues(pageRoles.length)
            .addOptions(pageRoles.map(r => ({
              label: r.name.slice(0, 100) || '(sans nom)',
              description: `${r.members.size} membre(s)`,
              value: r.id,
              default: selection.includes(r.id)
            })))
        ));
      }

      if (pages > 1) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('roledelete_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('roledelete_page').setLabel(`${page + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('roledelete_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
        ));
      }

      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('roledelete_delete').setLabel(`🗑️ Supprimer (${selection.length})`).setStyle(ButtonStyle.Danger).setDisabled(!selection.length),
        new ButtonBuilder().setCustomId('roledelete_clear').setLabel('♻️ Vider').setStyle(ButtonStyle.Secondary).setDisabled(!selection.length),
        new ButtonBuilder().setCustomId('roledelete_cancel').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
      ));

      return {
        content: pageRoles.length ? header : '❌ Aucun rôle supprimable sur ce serveur.',
        components: rows,
        allowedMentions: { parse: [] }
      };
    };

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await guild.roles.fetch().catch(() => { });
    const message = await interaction.editReply(render());

    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === interaction.user.id,
      time: 300000
    });

    collector.on('collect', async i => {
      // Cases cochées sur la page courante
      if (i.customId === 'roledelete_select') {
        const pageIds = new Set(getPageRoles().map(r => r.id));
        const next = selection.filter(id => !pageIds.has(id) || i.values.includes(id));
        for (const v of i.values) {
          if (!next.includes(v) && pageIds.has(v)) next.push(v);
        }
        if (next.length > MAX_ROLES) {
          return i.reply({ content: `❌ Maximum ${MAX_ROLES} rôles à la fois.`, flags: MessageFlags.Ephemeral });
        }
        selection = next;
        return i.update(render());
      }

      if (i.customId === 'roledelete_prev') {
        page = Math.max(0, page - 1);
        return i.update(render());
      }

      if (i.customId === 'roledelete_next') {
        page = Math.min(totalPages() - 1, page + 1);
        return i.update(render());
      }

      if (i.customId === 'roledelete_clear') {
        selection = [];
        return i.update(render());
      }

      if (i.customId === 'roledelete_cancel') {
        collector.stop('cancel');
        return i.update({ content: '❌ Suppression annulée.', components: [] });
      }

      if (i.customId === 'roledelete_delete') {
        confirming = true;
        return i.update(render());
      }

      if (i.customId === 'roledelete_back') {
        confirming = false;
        return i.update(render());
      }

      if (i.customId === 'roledelete_confirm') {
        collector.stop('done');
        await i.update({ content: `⏳ Suppression de ${selection.length} rôle(s) en cours...`, components: [] });
        let supprimes = 0;
        let echecs = 0;
        for (const id of selection) {
          const role = guild.roles.cache.get(id);
          try {
            if (!role || check(role)) throw new Error('rôle introuvable ou non supprimable');
            await role.delete(reason);
            supprimes++;
          } catch (e) {
            echecs++;
            console.error(`[role-delete] Erreur suppression du rôle ${role?.name ?? id} :`, e.message);
          }
        }
        return interaction.editReply({
          content: `✅ **${supprimes}** rôle(s) supprimé(s)${echecs ? ` — ❌ ${echecs} échec(s)` : ''}.`,
          components: []
        }).catch(() => { });
      }
    });

    collector.on('end', (_, endReason) => {
      if (endReason === 'time') {
        interaction.editReply({ content: '⏱️ Temps écoulé, suppression annulée.', components: [] }).catch(() => { });
      }
    });
  }
};

module.exports = [roleDelete];