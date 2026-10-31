// Notes privées des modérateurs sur un membre.
//   /note ajouter membre:@X texte:...   → ajoute une note
//   /note liste membre:@X               → affiche les notes (visibles uniquement par toi)
//   /note supprimer membre:@X numero:N  → supprime la note n°N
// Les réponses sont toujours éphémères et la commande est réservée aux modérateurs.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const { chargerDonnees, sauvegarderDonnees } = require('../core/data');

const FICHIER = 'mod_notes.json';
const MAX_TEXTE = 1000;
const MAX_NOTES_PAR_MEMBRE = 50;
const COULEUR = 0x5865F2;

// Structure : { [guildId]: { [userId]: [{ id, text, moderator, date }] } }
const donnees = chargerDonnees(FICHIER, {});
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

function notesDe(guildId, userId, creer = false) {
  const g = String(guildId), u = String(userId);
  if (!donnees[g]) { if (!creer) return []; donnees[g] = {}; }
  if (!donnees[g][u]) { if (!creer) return []; donnees[g][u] = []; }
  return donnees[g][u];
}

function estModerateur(interaction) {
  const p = interaction.memberPermissions;
  return !!p && (p.has(PermissionFlagsBits.ModerateMembers) || p.has(PermissionFlagsBits.Administrator));
}

const ts = d => Math.floor(new Date(d).getTime() / 1000);

const note = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Notes privées des modérateurs sur un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName('ajouter').setDescription('Ajouter une note privée sur un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption(o => o.setName('texte').setDescription('Contenu de la note').setRequired(true).setMaxLength(MAX_TEXTE)))
    .addSubcommand(s => s.setName('liste').setDescription('Voir les notes privées d\'un membre')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true)))
    .addSubcommand(s => s.setName('supprimer').setDescription('Supprimer une note privée')
      .addUserOption(o => o.setName('membre').setDescription('Membre').setRequired(true))
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro de la note (voir /note liste)').setRequired(true).setMinValue(1))),

  async execute(interaction) {
    const reponse = contenu => interaction.reply({ content: contenu, flags: MessageFlags.Ephemeral });
    if (!interaction.guild) return reponse('❌ Cette commande fonctionne uniquement dans un serveur.');
    if (!estModerateur(interaction)) return reponse('❌ Réservé aux modérateurs.');

    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('membre');

    if (sub === 'ajouter') {
      const texte = interaction.options.getString('texte').trim().slice(0, MAX_TEXTE);
      if (!texte) return reponse('❌ La note est vide.');
      const liste = notesDe(interaction.guild.id, user.id, true);
      if (liste.length >= MAX_NOTES_PAR_MEMBRE) {
        return reponse(`❌ Limite de ${MAX_NOTES_PAR_MEMBRE} notes atteinte pour ce membre. Supprime-en avec \`/note supprimer\`.`);
      }
      const id = liste.reduce((max, n) => Math.max(max, n.id), 0) + 1;
      liste.push({ id, text: texte, moderator: interaction.user.id, date: new Date().toISOString() });
      sauver();
      return reponse(`✅ Note **#${id}** ajoutée sur **${user.username}** (${liste.length} au total). Seuls les modérateurs peuvent la voir.`);
    }

    if (sub === 'liste') {
      const liste = notesDe(interaction.guild.id, user.id);
      if (!liste.length) return reponse(`ℹ️ Aucune note sur **${user.username}**.`);
      const lignes = [];
      let taille = 0;
      for (const n of liste) {
        const ligne = `**#${n.id}** — ${n.text}\n-# par <@${n.moderator}> • <t:${ts(n.date)}:R>`;
        if (taille + ligne.length > 3800) { lignes.push(`*… ${liste.length - lignes.length} note(s) non affichée(s)*`); break; }
        lignes.push(ligne);
        taille += ligne.length + 2;
      }
      const embed = new EmbedBuilder()
        .setColor(COULEUR)
        .setTitle(`📝 Notes sur ${user.username}`)
        .setDescription(lignes.join('\n\n'))
        .setThumbnail(user.displayAvatarURL({ size: 128 }))
        .setFooter({ text: `${liste.length} note(s) • ID ${user.id}` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    if (sub === 'supprimer') {
      const numero = interaction.options.getInteger('numero');
      const liste = notesDe(interaction.guild.id, user.id);
      const index = liste.findIndex(n => n.id === numero);
      if (index === -1) return reponse(`❌ Aucune note **#${numero}** sur **${user.username}**.`);
      liste.splice(index, 1);
      if (!liste.length) delete donnees[String(interaction.guild.id)][String(user.id)];
      sauver();
      return reponse(`🗑️ Note **#${numero}** supprimée.`);
    }
  }
};

module.exports = [note];
