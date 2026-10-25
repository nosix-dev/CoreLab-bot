const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const {
  stockage,
  persister
} = require('./data');
const {
  IDS_PROPRIETAIRES,
  ID_PROPRIETAIRE_BOT,
  ID_SKU_CUSTOMISATION,
  ID_SKU_TOTAL
} = require('./constants');
const {
  toCV2Payload
} = require("./componentsV2");
const SKU_PREMIUM = '1516591204836311103';
const SKU_CUSTOMISATION = ID_SKU_CUSTOMISATION;
const SKU_TOTAL = ID_SKU_TOTAL;
if (!stockage.premium.customUsers) stockage.premium.customUsers = {};
if (!stockage.premium.totalUsers) stockage.premium.totalUsers = {};
function estActif(entree) {
  if (!entree) return false;
  if (entree.expires_at) {
    try {
      if (new Date() >= new Date(entree.expires_at)) return false;
    } catch (_) {}
  }
  return !!entree.active;
}
function estProprietaire(idUtilisateur) {
  const id = String(idUtilisateur);
  const listeProprietaires = Array.isArray(IDS_PROPRIETAIRES) ? IDS_PROPRIETAIRES : [...IDS_PROPRIETAIRES];
  return id === String(ID_PROPRIETAIRE_BOT) || listeProprietaires.map(String).includes(id);
}

// ────────────────────────────────────────────────
// Abonnement "Total" (3e SKU) : combine Premium (commandes)
// + Personnalisation en un seul abonnement.
// ────────────────────────────────────────────────
function estPremiumTotal(idUtilisateur) {
  const id = String(idUtilisateur);
  if (estProprietaire(id)) return true;
  return estActif(stockage.premium.totalUsers[id]);
}
function definirPremiumTotal(idUtilisateur, actif, dateExpiration = null) {
  stockage.premium.totalUsers[String(idUtilisateur)] = {
    active: actif,
    expires_at: dateExpiration,
    updated_at: new Date().toISOString()
  };
  persister('premium');
}

// ────────────────────────────────────────────────
// Abonnement Premium classique (1er SKU) : commandes.
// Un utilisateur "Total" a automatiquement accès aux commandes Premium.
// ────────────────────────────────────────────────
function estPremium(idUtilisateur) {
  const id = String(idUtilisateur);
  if (estProprietaire(id)) return true;
  if (estPremiumTotal(id)) return true;
  return estActif(stockage.premium.users[id]);
}
function definirPremium(idUtilisateur, actif, dateExpiration = null) {
  stockage.premium.users[String(idUtilisateur)] = {
    active: actif,
    expires_at: dateExpiration,
    updated_at: new Date().toISOString()
  };
  persister('premium');
}

// ────────────────────────────────────────────────
// Abonnement "Personnalisation" (2e SKU) : couvre TOUTE
// personnalisation visuelle du bot (titres, couleurs, images —
// tickets, règlement, sondages, bienvenue/au revoir, etc.)
// Un utilisateur "Total" a automatiquement accès à la Personnalisation.
// ────────────────────────────────────────────────
function estPremiumCustomisation(idUtilisateur) {
  const id = String(idUtilisateur);
  if (estProprietaire(id)) return true;
  if (estPremiumTotal(id)) return true;
  return estActif(stockage.premium.customUsers[id]);
}
function definirPremiumCustomisation(idUtilisateur, actif, dateExpiration = null) {
  stockage.premium.customUsers[String(idUtilisateur)] = {
    active: actif,
    expires_at: dateExpiration,
    updated_at: new Date().toISOString()
  };
  persister('premium');
}

// ────────────────────────────────────────────────
// Ligne de boutons d'achat (jusqu'à 3 SKU) — réutilisée partout
// ────────────────────────────────────────────────
function construireLigneAbonnements() {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setSKUId(SKU_PREMIUM).setStyle(ButtonStyle.Premium), new ButtonBuilder().setSKUId(SKU_CUSTOMISATION).setStyle(ButtonStyle.Premium), new ButtonBuilder().setSKUId(SKU_TOTAL).setStyle(ButtonStyle.Premium));
}

// ────────────────────────────────────────────────
// Message + bouton d'achat Premium (classique)
// Affiche aussi la Personnalisation et le Total pour laisser le choix.
// ────────────────────────────────────────────────
function construireMessagePremium() {
  const embed = new EmbedBuilder().setTitle('✨ Fonctionnalité Premium').setDescription('Cette commande est réservée aux membres **Premium**.\n' + 'Choisis l\'abonnement qui te convient ci-dessous :\n\n' + '⭐ **Premium** — débloque les commandes\n' + '🎨 **Personnalisation** — débloque la personnalisation visuelle\n' + '💎 **Total** — débloque les deux en un seul abonnement').setColor(0xFFFFFF);
  return toCV2Payload({
    embeds: [embed],
    components: [construireLigneAbonnements()],
    flags: 64
  }); // 64 = ephemeral
}

// ────────────────────────────────────────────────
// Message + bouton d'achat Personnalisation (2e SKU)
// Affiche aussi Premium et Total pour laisser le choix.
// ────────────────────────────────────────────────
function construireMessageCustomisation() {
  const embed = new EmbedBuilder().setTitle('🎨 Fonctionnalité de Personnalisation').setDescription('Toute personnalisation (titres, couleurs, images...) fait partie de l\'abonnement **Personnalisation**.\n' + 'Choisis l\'abonnement qui te convient ci-dessous :\n\n' + '⭐ **Premium** — débloque les commandes\n' + '🎨 **Personnalisation** — débloque la personnalisation visuelle\n' + '💎 **Total** — débloque les deux en un seul abonnement').setColor(0xFFFFFF);
  return toCV2Payload({
    embeds: [embed],
    components: [construireLigneAbonnements()],
    flags: 64
  }); // 64 = ephemeral
}

// ────────────────────────────────────────────────
// Message + bouton d'achat Total (3e SKU, commandes + personnalisation)
// ────────────────────────────────────────────────
function construireMessageTotal() {
  const embed = new EmbedBuilder().setTitle('💎 Abonnement Total').setDescription('L\'abonnement **Total** débloque en un seul achat :\n' + '• Toutes les commandes **Premium**\n' + '• Toute la **Personnalisation** visuelle\n\n' + 'Choisis l\'abonnement qui te convient ci-dessous :').setColor(0xFFFFFF);
  return toCV2Payload({
    embeds: [embed],
    components: [construireLigneAbonnements()],
    flags: 64
  }); // 64 = ephemeral
}

// À appeler en tout début de commande premium : si false, l'interaction a déjà
// été répondue (message + bouton) et il faut `return` immédiatement après.
async function requierePremium(interaction) {
  const idUtilisateur = interaction.user?.id ?? interaction.member?.id;
  if (estPremium(idUtilisateur)) return true;
  try {
    await interaction.reply(construireMessagePremium());
  } catch (e) {
    console.error('[Premium] Erreur envoi message premium:', e.message);
  }
  return false;
}

// À appeler en tout début de toute action de personnalisation (titre/couleur/image) :
// si false, l'interaction a déjà été répondue et il faut `return` immédiatement après.
async function requierePremiumCustomisation(interaction) {
  const idUtilisateur = interaction.user?.id ?? interaction.member?.id;
  if (estPremiumCustomisation(idUtilisateur)) return true;
  try {
    await interaction.reply(construireMessageCustomisation());
  } catch (e) {
    console.error('[Premium] Erreur envoi message personnalisation:', e.message);
  }
  return false;
}
module.exports = {
  // exports français d'origine
  estPremium,
  definirPremium,
  construireMessagePremium,
  requierePremium,
  estPremiumCustomisation,
  definirPremiumCustomisation,
  construireMessageCustomisation,
  requierePremiumCustomisation,
  estPremiumTotal,
  definirPremiumTotal,
  construireMessageTotal,
  construireLigneAbonnements,
  estProprietaire,
  // alias anglais — pour compatibilité avec index.js et extended.js
  isPremium: estPremium,
  setPremium: definirPremium,
  buildPremiumMessage: construireMessagePremium,
  requirePremium: requierePremium,
  isCustomization: estPremiumCustomisation,
  setCustomization: definirPremiumCustomisation,
  buildCustomizationMessage: construireMessageCustomisation,
  isFounder: estProprietaire,
  requireCustomization: requierePremiumCustomisation,
  isTotal: estPremiumTotal,
  setTotal: definirPremiumTotal,
  buildTotalMessage: construireMessageTotal,
  buildSubscriptionRow: construireLigneAbonnements
};