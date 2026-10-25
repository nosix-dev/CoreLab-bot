const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildRoleSelectRow, stockerImageReglement, stockerBoutonsReglement, MAX_BOUTONS_LIENS } = require('../core/reglement');
const { requireCustomization } = require('../core/premium');

const data = new SlashCommandBuilder()
    .setName('reglement')
    .setDescription('Configurer le règlement du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption(o => o.setName('image').setDescription('🎨 Personnalisation — Image à afficher en bas du règlement').setRequired(false));

for (let i = 1; i <= MAX_BOUTONS_LIENS; i++) {
    data.addStringOption(o => o
        .setName(`bouton${i}`)
        .setDescription(`🔗 Bouton de lien ${i} — format : Label | https://lien`)
        .setRequired(false)
        .setMaxLength(300)
    );
}

// N'est plus enregistrée en top-level : absorbée dans /settings rules (voir extended.js).
const reglementCmd = {
    data,
    async execute(interaction) {
        const image = interaction.options.getAttachment('image');
        if (image) {
            // L'image est une personnalisation visuelle : réservée à l'abonnement Personnalisation.
            if (!(await requireCustomization(interaction))) return;
            if (!image.contentType?.startsWith('image/')) {
                return interaction.reply({ content: '❌ Le fichier fourni n\'est pas une image valide.', flags: MessageFlags.Ephemeral });
            }
            stockerImageReglement(interaction.guild.id, interaction.user.id, image.url);
        }

        const lignesBoutons = [];
        for (let i = 1; i <= MAX_BOUTONS_LIENS; i++) {
            const valeur = interaction.options.getString(`bouton${i}`);
            if (valeur) lignesBoutons.push(valeur);
        }
        if (lignesBoutons.length) {
            stockerBoutonsReglement(interaction.guild.id, interaction.user.id, lignesBoutons);
        }

        const row = buildRoleSelectRow();
        await interaction.reply({
            content: 'Sélectionnez le(s) rôle(s) à attribuer après l\'acceptation du règlement :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};
module.exports = { reglementCmd };