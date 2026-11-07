// ─────────────────────────────────────────────────────────────────────────
// premiumPanel.js — commande /premium (panneau Components V2, barre orange)
//
// Écran d'accueil : abonnements (3 SKU Discord), familles d'avantages (menu), essai gratuit,
// puis « Mes avantages », « Soutiens » (mur des soutiens), Actualiser, Fermer.
// Chargé après general.js / extended.js (ordre alphabétique) : cette version remplace l'ancien /premium.
//
// ⚠️ La description de la commande ne doit PAS contenir « Premium » avec un P majuscule :
// index.js bloque les commandes dont la description contient ce mot pour les non-abonnés.
// ─────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags
} = require('discord.js');
const { stockage, chargerDonnees, sauvegarderDonnees } = require('../core/data');
const premium = require('../core/premium');
const { MAX_SAUVEGARDES_PREMIUM } = require('../core/constants');

const COULEUR = 0xE8510D;
const ESSAI_JOURS = 7;                    // durée de l'essai gratuit (Premium)
const LIEN_BOUTIQUE = process.env.PREMIUM_SHOP_URL || process.env.SITE_URL || 'https://discord.gg/WecpyxrSBT';
const MUR_MAX = 25;

// ── Familles d'avantages (reprend la liste « Tout ce qui est Premium sur CoreLab » de /config) ──
// tier : 'custom' = abonnement Personnalisation (ou Total) · 'premium' = abonnement Premium (ou Total)
const FAMILLES = [
  {
    id: 'perso', emoji: '🎨', nom: 'Personnalisation', tier: 'custom',
    items: [
      '👋 Bienvenue / au revoir : message, image, boutons, carte → `/config`',
      '🖼️ Image de l\'annonce de niveau → `/config`',
      '🎫 Tickets : apparence, message d\'ouverture, image → `/settings ticket`',
      '📜 `/reglement` : titres, couleurs, images',
      '🗳️ `/vote` : titres, couleurs, images'
    ]
  },
  {
    id: 'backup', emoji: '💾', nom: 'Sauvegardes', tier: 'premium',
    items: [
      '`/backup create` : sauvegarder rôles, salons et permissions',
      `\`/backup load\` : appliquer une sauvegarde (jusqu'à ${MAX_SAUVEGARDES_PREMIUM} sauvegardes)`,
      '`/backup list` : voir tes sauvegardes',
      '`/backup delete` : supprimer une sauvegarde',
      '`/backup info` : détails d\'une sauvegarde'
    ]
  },
  {
    id: 'notifs', emoji: '🔔', nom: 'Notifications', tier: 'premium',
    items: ['`/notification` : suivre YouTube, Twitch, Blog et Medal']
  },
  {
    id: 'extras', emoji: '⭐', nom: 'Extras', tier: 'premium',
    items: [
      '🖐️ Bouton Claim des tickets → `/settings ticket`',
      '🏅 Badge Premium sur ta carte de niveau et ton profil économie'
    ]
  }
];
const TOTAL_AVANTAGES = FAMILLES.reduce((n, f) => n + f.items.length, 0);

// ── Données propres au panneau : essais gratuits utilisés + mur des soutiens ──
// premium_panel.json (racine) est couvert par la sauvegarde Discord automatique.
const FICHIER = 'premium_panel.json';
const donnees = chargerDonnees(FICHIER, { trials: {}, wall: {} });
if (!donnees.trials) donnees.trials = {};
if (!donnees.wall) donnees.wall = {};
const sauver = () => sauvegarderDonnees(FICHIER, donnees);

// ── Statut d'abonnement ──
function actif(entree) {
  if (!entree || !entree.active) return false;
  if (entree.expires_at) {
    const t = new Date(entree.expires_at).getTime();
    if (!Number.isNaN(t) && Date.now() >= t) return false;
  }
  return true;
}
const ts = ms => Math.floor(ms / 1000);
const entrees = id => ({
  total: stockage.premium.totalUsers?.[id],
  prem: stockage.premium.users?.[id],
  perso: stockage.premium.customUsers?.[id]
});
const acces = (id, tier) => (tier === 'custom' ? premium.estPremiumCustomisation(id) : premium.estPremium(id));
const aUnAcces = id => premium.estPremium(id) || premium.estPremiumCustomisation(id);

// Date de fin la plus proche parmi les abonnements actifs, ou null si l'un d'eux n'a pas de fin.
function finAbonnement(id) {
  const e = entrees(id);
  const fins = [];
  for (const x of [e.total, e.prem, e.perso]) {
    if (!actif(x)) continue;
    if (!x.expires_at) return null;
    fins.push(new Date(x.expires_at).getTime());
  }
  return fins.length ? Math.min(...fins) : null;
}

function texteStatut(id) {
  if (premium.estProprietaire(id)) return '👑 Tu fais partie de l\'équipe CoreLab : **tout est débloqué** sur ce compte.';
  const e = entrees(id);
  let l;
  if (actif(e.total)) l = '💎 **CoreLab Total** est activé sur ce compte.';
  else if (actif(e.prem) && actif(e.perso)) l = '⭐ **Premium** et 🎨 **Personnalisation** sont activés sur ce compte.';
  else if (actif(e.prem)) l = '⭐ **CoreLab Premium** est activé sur ce compte.';
  else if (actif(e.perso)) l = '🎨 **Personnalisation** est activée sur ce compte.';
  else {
    return '🔒 Pas encore d\'abonnement sur ce compte.\n' +
      '-# Chaque vote sur top.gg offre 12 h de Premium (`/top-gg`).' +
      (essaiDisponible(id) ? ` Tu peux aussi essayer ${ESSAI_JOURS} jours gratuitement.` : '');
  }
  const fin = finAbonnement(id);
  return fin ? `${l}\n-# Actif jusqu'au <t:${ts(fin)}:f> (<t:${ts(fin)}:R>).` : `${l}\n-# Géré par Discord : paiement, remboursements et renouvellements.`;
}

function essaiDisponible(id) {
  return !donnees.trials[id] && !premium.estPremium(id);
}

// ── Mur des soutiens ──
function soutiens() {
  const e = stockage.premium;
  const ids = new Set([...Object.keys(e.users || {}), ...Object.keys(e.customUsers || {}), ...Object.keys(e.totalUsers || {})]);
  return [...ids].filter(id => donnees.wall[id] && !premium.estProprietaire(id) &&
    (actif(e.users?.[id]) || actif(e.customUsers?.[id]) || actif(e.totalUsers?.[id])));
}

// ── Briques d'interface ──
const texte = c => new TextDisplayBuilder().setContent(c);
const sep = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const conteneur = () => new ContainerBuilder().setAccentColor(COULEUR);
const payload = c => ({ components: [c], flags: MessageFlags.IsComponentsV2 });

const btn = (id, label, emoji, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const boutonBoutique = () => new ButtonBuilder().setLabel('Page boutique').setStyle(ButtonStyle.Link).setURL(LIEN_BOUTIQUE);

function detailFamille(f, id) {
  const ok = acces(id, f.tier);
  return `**${f.emoji} ${f.nom}** — ${f.items.length} avantage(s)\n` + f.items.map(i => `${ok ? '✅' : '🔒'} ${i}`).join('\n');
}

// ── Écran d'accueil ──
function buildHome(client, userId, { famille = null, notice = null } = {}) {
  const nom = client.user.username;
  const c = conteneur();
  c.addTextDisplayComponents(texte(`## ${nom} Premium\nSoutiens le bot et débloque les suppléments. Le paiement, les remboursements et les renouvellements sont gérés par Discord.`));
  if (notice) c.addTextDisplayComponents(texte(String(notice).slice(0, 600)));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(texte(`**${nom} Premium**\n-# Te suit partout, sur tous les serveurs.`));
  c.addSeparatorComponents(sep());

  const choisie = FAMILLES.find(f => f.id === famille);
  let bloc = `**Ce que ça débloque**\n-# ${TOTAL_AVANTAGES} avantages, en ${FAMILLES.length} familles — choisis-en une ci-dessous\n` +
    FAMILLES.map(f => `${f.emoji} **${f.nom}** · ${f.items.length}`).join('\n');
  if (choisie) bloc += `\n\n${detailFamille(choisie, userId)}`;
  c.addTextDisplayComponents(texte(bloc));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(texte(texteStatut(userId)));

  // Abonnements (3 SKU Discord : Premium, Personnalisation, Total)
  c.addActionRowComponents(premium.construireLigneAbonnements());

  // Menu des familles
  const menu = new StringSelectMenuBuilder().setCustomId('prem_family').setPlaceholder('Choisis une famille d\'avantages')
    .addOptions(FAMILLES.map(f => new StringSelectMenuOptionBuilder()
      .setLabel(f.nom).setValue(f.id).setEmoji(f.emoji).setDescription(`${f.items.length} avantage(s)`).setDefault(f.id === famille)));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(menu));

  // Essai gratuit (masqué une fois utilisé, grisé tant qu'un abonnement est actif)
  if (!donnees.trials[userId]) {
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      btn('prem_trial', `Essayer ${ESSAI_JOURS} jours gratuits`, '🎁', ButtonStyle.Primary).setDisabled(!essaiDisponible(userId))
    ));
  }

  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    boutonBoutique(),
    btn('prem_mine', 'Mes avantages', '⚙️', ButtonStyle.Primary),
    btn('prem_wall', 'Soutiens', '🤍'),
    btn('prem_refresh:home', 'Actualiser', '🔄'),
    btn('prem_close', 'Fermer', '❌')
  ));
  c.addTextDisplayComponents(texte(`-# ${nom}`));
  return payload(c);
}

// ── Mes avantages ──
function ligneAbo(emoji, nom, entree, id) {
  if (premium.estProprietaire(id)) return `${emoji} **${nom}** : ✅ inclus (équipe CoreLab)`;
  if (!actif(entree)) return `${emoji} **${nom}** : ❌ inactif`;
  return entree.expires_at
    ? `${emoji} **${nom}** : ✅ actif jusqu'au <t:${ts(new Date(entree.expires_at).getTime())}:f>`
    : `${emoji} **${nom}** : ✅ actif`;
}

function buildMine(client, userId, notice = null) {
  const e = entrees(userId);
  const c = conteneur();
  c.addTextDisplayComponents(texte('## Mes avantages'));
  if (notice) c.addTextDisplayComponents(texte(String(notice).slice(0, 600)));
  c.addTextDisplayComponents(texte([
    ligneAbo('⭐', 'Premium', e.prem, userId),
    ligneAbo('🎨', 'Personnalisation', e.perso, userId),
    ligneAbo('💎', 'Total', e.total, userId)
  ].join('\n')));
  c.addSeparatorComponents(sep());

  const debloques = FAMILLES.reduce((n, f) => n + (acces(userId, f.tier) ? f.items.length : 0), 0);
  c.addTextDisplayComponents(texte(
    `**Ce que tu as débloqué** — ${debloques} sur ${TOTAL_AVANTAGES}\n` +
    FAMILLES.map(f => `${f.emoji} ${f.nom} ${acces(userId, f.tier) ? f.items.length : 0}/${f.items.length}`).join(' · ')
  ));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(texte('**Détail**\n' + FAMILLES.map(f => detailFamille(f, userId)).join('\n\n')));
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(texte(`**Visibilité**\nMur des soutiens : **${donnees.wall[userId] ? 'oui' : 'non'}**`));

  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    btn('prem_home', 'Accueil', '🏠', ButtonStyle.Primary),
    btn('prem_wallopt:mine', `Mur des soutiens : ${donnees.wall[userId] ? 'oui' : 'non'}`, '🤍').setDisabled(!aUnAcces(userId) || premium.estProprietaire(userId)),
    btn('prem_refresh:mine', 'Actualiser', '🔄'),
    btn('prem_close', 'Fermer', '❌')
  ));
  return payload(c);
}

// ── Mur des soutiens ──
function buildWall(client, userId, notice = null) {
  const nom = client.user.username;
  const liste = soutiens();
  const c = conteneur();
  c.addTextDisplayComponents(texte(`## 🤍 Mur des soutiens\nMerci à toutes les personnes qui soutiennent ${nom}.`));
  if (notice) c.addTextDisplayComponents(texte(String(notice).slice(0, 600)));
  c.addSeparatorComponents(sep());
  if (liste.length) {
    const visibles = liste.slice(0, MUR_MAX).map(id => `• <@${id}>`).join('\n');
    const reste = liste.length - MUR_MAX;
    c.addTextDisplayComponents(texte(`${visibles}${reste > 0 ? `\n-# … et ${reste} autre(s)` : ''}`));
  } else {
    c.addTextDisplayComponents(texte('Personne n\'apparaît sur le mur pour l\'instant.\n-# Abonne-toi, puis active l\'option ci-dessous pour y figurer.'));
  }
  c.addSeparatorComponents(sep());
  c.addTextDisplayComponents(texte(`**Ton affichage** : ${donnees.wall[userId] ? 'oui' : 'non'}\n-# Seules les personnes qui l'activent apparaissent ici.`));
  c.addActionRowComponents(new ActionRowBuilder().addComponents(
    btn('prem_home', 'Accueil', '🏠', ButtonStyle.Primary),
    btn('prem_wallopt:wall', `Apparaître sur le mur : ${donnees.wall[userId] ? 'oui' : 'non'}`, '🤍').setDisabled(!aUnAcces(userId) || premium.estProprietaire(userId)),
    btn('prem_refresh:wall', 'Actualiser', '🔄'),
    btn('prem_close', 'Fermer', '❌')
  ));
  return payload(c);
}

// ── Commande ──
const data = new SlashCommandBuilder()
  .setName('premium')
  .setDescription('💎 Avantages, abonnements et statut de ton compte');

async function execute(interaction) {
  await interaction.reply({ ...buildHome(interaction.client, interaction.user.id), flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
}

// ── Boutons et menu (customId « prem_* », routés depuis index.js) ──
async function routePremiumInteraction(interaction) {
  const id = interaction.customId;
  const client = interaction.client;
  const uid = interaction.user.id;

  if (id === 'prem_close') {
    await interaction.deferUpdate();
    const ok = await interaction.deleteReply().then(() => true).catch(() => false);
    if (!ok) await interaction.editReply(payload(conteneur().addTextDisplayComponents(texte('-# Panneau fermé.')))).catch(() => { });
    return;
  }

  if (id === 'prem_family') {
    return interaction.update(buildHome(client, uid, { famille: interaction.values?.[0] || null }));
  }
  if (id === 'prem_home' || id === 'prem_refresh:home') return interaction.update(buildHome(client, uid));
  if (id === 'prem_mine' || id === 'prem_refresh:mine') return interaction.update(buildMine(client, uid));
  if (id === 'prem_wall' || id === 'prem_refresh:wall') return interaction.update(buildWall(client, uid));

  if (id === 'prem_wallopt:mine' || id === 'prem_wallopt:wall') {
    const vue = id.endsWith(':wall') ? buildWall : buildMine;
    if (!aUnAcces(uid) || premium.estProprietaire(uid)) return interaction.update(vue(client, uid, '⚠️ Le mur est réservé aux abonné(e)s.'));
    if (donnees.wall[uid]) delete donnees.wall[uid]; else donnees.wall[uid] = true;
    sauver();
    return interaction.update(vue(client, uid, donnees.wall[uid] ? '🤍 Ton nom apparaît maintenant sur le mur des soutiens.' : 'Ton nom a été retiré du mur des soutiens.'));
  }

  if (id === 'prem_trial') {
    if (!essaiDisponible(uid)) {
      return interaction.update(buildHome(client, uid, {
        notice: donnees.trials[uid]
          ? '⚠️ Tu as déjà utilisé ton essai gratuit.'
          : '⚠️ Tu as déjà un abonnement actif : l\'essai n\'est pas nécessaire.'
      }));
    }
    const fin = Date.now() + ESSAI_JOURS * 24 * 3600 * 1000;
    donnees.trials[uid] = Date.now();
    sauver();
    premium.definirPremium(uid, true, new Date(fin).toISOString());
    return interaction.update(buildHome(client, uid, { notice: `🎁 Essai activé : **Premium** jusqu'au <t:${ts(fin)}:f> (<t:${ts(fin)}:R>). Profites-en !` }));
  }
}

module.exports = {
  data,
  execute,
  routePremiumInteraction,
  buildHome,
  buildMine,
  buildWall
};
