'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { executerSocial } = require('../handlers/communitySocial');

const membreRequis = (o, desc) => o.setName('membre').setDescription(desc).setRequired(true);

const data = new SlashCommandBuilder()
  .setName('social')
  .setDescription('💞 Mariage, amis et clans')
  .addSubcommand(sub => sub
    .setName('profil')
    .setDescription('👤 Voir un profil social (mariage, amis, clan, jeux)')
    .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)')))

  // ── 💍 Mariage ──
  .addSubcommandGroup(g => g
    .setName('mariage')
    .setDescription('💍 Mariage')
    .addSubcommand(sub => sub
      .setName('proposer')
      .setDescription('💍 Demander quelqu\'un en mariage')
      .addUserOption(o => membreRequis(o, 'La personne à demander en mariage')))
    .addSubcommand(sub => sub
      .setName('divorcer')
      .setDescription('💔 Divorcer de ton conjoint')))

  // ── 🤝 Amis ──
  .addSubcommandGroup(g => g
    .setName('ami')
    .setDescription('🤝 Liste d\'amis')
    .addSubcommand(sub => sub
      .setName('ajouter')
      .setDescription('🤝 Envoyer une demande d\'ami')
      .addUserOption(o => membreRequis(o, 'Le membre à ajouter')))
    .addSubcommand(sub => sub
      .setName('retirer')
      .setDescription('🚫 Retirer un ami')
      .addUserOption(o => membreRequis(o, 'L\'ami à retirer')))
    .addSubcommand(sub => sub
      .setName('liste')
      .setDescription('📋 Voir une liste d\'amis')
      .addUserOption(o => o.setName('membre').setDescription('Le membre (toi par défaut)'))))

  // ── 🛡️ Clans ──
  .addSubcommandGroup(g => g
    .setName('clan')
    .setDescription('🛡️ Clans')
    .addSubcommand(sub => sub
      .setName('creer')
      .setDescription('🛡️ Créer ton clan (coûte des 💠 si l\'économie est active)')
      .addStringOption(o => o.setName('nom').setDescription('Nom du clan (3 à 24 caractères)').setRequired(true).setMinLength(3).setMaxLength(24))
      .addStringOption(o => o.setName('tag').setDescription('Tag court, ex : SCR (2 à 5 lettres/chiffres)').setRequired(true).setMinLength(2).setMaxLength(5)))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('ℹ️ Voir un clan (le tien par défaut)')
      .addStringOption(o => o.setName('nom').setDescription('Nom ou tag du clan').setMaxLength(24)))
    .addSubcommand(sub => sub
      .setName('top')
      .setDescription('🏆 Classement des clans'))
    .addSubcommand(sub => sub
      .setName('inviter')
      .setDescription('📨 Inviter un membre dans ton clan')
      .addUserOption(o => membreRequis(o, 'Le membre à inviter')))
    .addSubcommand(sub => sub
      .setName('quitter')
      .setDescription('👋 Quitter ton clan'))
    .addSubcommand(sub => sub
      .setName('expulser')
      .setDescription('🚪 Expulser un membre du clan')
      .addUserOption(o => membreRequis(o, 'Le membre à expulser')))
    .addSubcommand(sub => sub
      .setName('promouvoir')
      .setDescription('🛡️ Nommer un membre officier (chef uniquement)')
      .addUserOption(o => membreRequis(o, 'Le membre à promouvoir')))
    .addSubcommand(sub => sub
      .setName('retrograder')
      .setDescription('⬇️ Retirer le grade d\'officier (chef uniquement)')
      .addUserOption(o => membreRequis(o, 'L\'officier à rétrograder')))
    .addSubcommand(sub => sub
      .setName('transferer')
      .setDescription('👑 Donner la direction du clan à un autre membre')
      .addUserOption(o => membreRequis(o, 'Le nouveau chef')))
    .addSubcommand(sub => sub
      .setName('dissoudre')
      .setDescription('💥 Dissoudre le clan (chef uniquement)'))
    .addSubcommand(sub => sub
      .setName('deposer')
      .setDescription('💰 Déposer des 💠 dans la banque du clan')
      .addIntegerOption(o => o.setName('montant').setDescription('Montant à déposer').setRequired(true).setMinValue(1).setMaxValue(10000000)))
    .addSubcommand(sub => sub
      .setName('retirer')
      .setDescription('💸 Retirer des 💠 de la banque (chef uniquement)')
      .addIntegerOption(o => o.setName('montant').setDescription('Montant à retirer').setRequired(true).setMinValue(1).setMaxValue(10000000)))
    .addSubcommand(sub => sub
      .setName('description')
      .setDescription('📝 Changer la description du clan')
      .addStringOption(o => o.setName('texte').setDescription('Description (150 caractères max)').setRequired(true).setMaxLength(150))));

async function execute(interaction) {
  return executerSocial(interaction);
}

module.exports = { data, execute };
