const {
  SlashCommandBuilder,
  MessageFlags
} = require('discord.js');
const {
  requireCustomization
} = require('../core/premium');
const {
  hexToInt,
  genererIdSondage,
  sauvegarderSondage,
  construireEmbedGlassSondage,
  construireLignesBoutons,
  MAX_OPTIONS,
  MAX_IMAGES
} = require('../core/vote');
const { glassPayload } = require('../core/glassEmbed');
const data = new SlashCommandBuilder().setName('vote').setDescription('Créer un sondage à choix multiples avec boutons').addStringOption(o => o.setName('question').setDescription('La question du sondage').setRequired(true).setMaxLength(200)).addStringOption(o => o.setName('choix1').setDescription('Option 1').setRequired(true).setMaxLength(80)).addStringOption(o => o.setName('choix2').setDescription('Option 2').setRequired(true).setMaxLength(80)).addStringOption(o => o.setName('choix3').setDescription('Option 3').setRequired(false).setMaxLength(80)).addStringOption(o => o.setName('choix4').setDescription('Option 4').setRequired(false).setMaxLength(80)).addStringOption(o => o.setName('choix5').setDescription('Option 5').setRequired(false).setMaxLength(80)).addStringOption(o => o.setName('choix6').setDescription('Option 6').setRequired(false).setMaxLength(80)).addStringOption(o => o.setName('choix7').setDescription('Option 7').setRequired(false).setMaxLength(80)).addStringOption(o => o.setName('choix8').setDescription('Option 8').setRequired(false).setMaxLength(80)).addIntegerOption(o => o.setName('duree').setDescription('Durée du sondage en minutes (optionnel)').setMinValue(1).setMaxValue(10080).setRequired(false)).addStringOption(o => o.setName('titre').setDescription('🎨 Personnalisation — Titre personnalisé de l\'embed').setRequired(false).setMaxLength(150)).addStringOption(o => o.setName('couleur').setDescription('🎨 Personnalisation — Couleur hex, ex : FC964B').setRequired(false).setMaxLength(7)).addAttachmentOption(o => o.setName('image1').setDescription('🎨 Personnalisation — Image 1 affichée dans le sondage').setRequired(false)).addAttachmentOption(o => o.setName('image2').setDescription('🎨 Personnalisation — Image 2 affichée dans le sondage').setRequired(false)).addAttachmentOption(o => o.setName('image3').setDescription('🎨 Personnalisation — Image 3 affichée dans le sondage').setRequired(false)).addAttachmentOption(o => o.setName('image4').setDescription('🎨 Personnalisation — Image 4 affichée dans le sondage').setRequired(false));
async function execute(interaction) {
  const question = interaction.options.getString('question');
  const duree = interaction.options.getInteger('duree');
  const titre = interaction.options.getString('titre');
  const couleurRaw = interaction.options.getString('couleur');
  const images = [];
  for (let i = 1; i <= MAX_IMAGES; i++) {
    const img = interaction.options.getAttachment(`image${i}`);
    if (img) images.push(img);
  }
  const options = [];
  for (let i = 1; i <= MAX_OPTIONS; i++) {
    const val = interaction.options.getString(`choix${i}`);
    if (val) options.push({
      label: val,
      voters: []
    });
  }
  if (options.length < 2) {
    return interaction.reply({
      content: '❌ Il faut au moins 2 choix.',
      flags: MessageFlags.Ephemeral
    });
  }
  const doublons = new Set(options.map(o => o.label.toLowerCase()));
  if (doublons.size !== options.length) {
    return interaction.reply({
      content: '❌ Les choix doivent être différents les uns des autres.',
      flags: MessageFlags.Ephemeral
    });
  }

  // Toute personnalisation (titre, couleur, image) est réservée à l'abonnement Personnalisation.
  const demandeCustom = !!(titre || couleurRaw || images.length);
  if (demandeCustom && !(await requireCustomization(interaction))) return;
  let couleur = null;
  if (couleurRaw) {
    couleur = hexToInt(couleurRaw);
    if (couleur === null) {
      return interaction.reply({
        content: '❌ Couleur invalide. Utilise un format hexadécimal, ex. : `FC964B`.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
  const imageUrls = [];
  for (const img of images) {
    if (!img.contentType?.startsWith('image/')) {
      return interaction.reply({
        content: `❌ Le fichier « ${img.name} » n'est pas une image valide.`,
        flags: MessageFlags.Ephemeral
      });
    }
    imageUrls.push(img.url);
  }
  const pollId = genererIdSondage();
  const sondage = {
    pollId,
    question,
    titre: titre || null,
    couleur,
    imageUrls,
    options,
    auteurId: interaction.user.id,
    ferme: false,
    finTimestamp: duree ? Date.now() + duree * 60000 : null
  };
  await interaction.reply(await glassPayload({
    embeds: [construireEmbedGlassSondage(sondage)],
    components: construireLignesBoutons(sondage, pollId)
  }, { guild: interaction.guild, client: interaction.client, badge: 'SONDAGE' }));
  const guildId = interaction.guild.id;
  sauvegarderSondage(guildId, pollId, sondage);
  if (sondage.finTimestamp) {
    const {
      fermerSondage
    } = require('../core/vote');
    setTimeout(async () => {
      try {
        const message = await interaction.fetchReply();
        await fermerSondage(guildId, pollId, message);
      } catch (erreur) {
        console.error('[Vote] Erreur clôture automatique :', erreur.message);
      }
    }, duree * 60000);
  }
}
module.exports = {
  data,
  execute
};