const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    SectionBuilder,
    TextDisplayBuilder,
} = require('discord.js');

// ────────────────────────────────────────────────
// Boutons de liens personnalisables (bienvenue / au revoir)
// Format de saisie dans le modal, un champ par bouton : "Texte du bouton | https://lien"
// Jusqu'à 5 boutons (limite Discord : 5 composants par ligne).
// Utilisé par : commands/extended.js (modal de config),
// handlers/welcomeImage.js et handlers/goodbye.js (envoi du message).
// ────────────────────────────────────────────────
const MAX_LINK_BUTTONS = 5;

// Transforme une ligne saisie en { label, url, description? }.
// Formats acceptés :
//   "Texte du bouton | https://lien"
//   "Texte du bouton | https://lien | Description affichée à gauche du bouton"
// Retourne null si la ligne est vide, et undefined si le format/l'URL est invalide.
function parseLinkButtonField(raw) {
    if (!raw) return null;
    const texte = String(raw).trim();
    if (!texte) return null;

    const parts = texte.split('|');
    if (parts.length < 2) return undefined;

    const label = parts[0].trim();
    const url = parts[1].trim();
    const description = parts.slice(2).join('|').trim();
    if (!label || !url) return undefined;
    if (!/^https?:\/\//i.test(url)) return undefined;

    const out = { label: label.slice(0, 80), url };
    if (description) out.description = description.slice(0, 200);
    return out;
}

// Construit les LabelBuilder à ajouter à un modal (jusqu'à MAX_LINK_BUTTONS champs).
// boutonsActuels : tableau [{ label, url }, ...] déjà configuré, pour préremplir.
function buildLinkButtonsLabelComponents(boutonsActuels = []) {
    const labels = [];
    for (let i = 0; i < MAX_LINK_BUTTONS; i++) {
        const existant = boutonsActuels[i];
        const input = new TextInputBuilder()
            .setCustomId(`lien_${i}`)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(300)
            .setPlaceholder('Texte | https://lien | Description à gauche (optionnel)');
        if (existant) input.setValue(`${existant.label} | ${existant.url}${existant.description ? ` | ${existant.description}` : ''}`.slice(0, 300));

        labels.push(
            new LabelBuilder()
                .setLabel(`Bouton ${i + 1}`)
                .setDescription('Laisse vide pour ne pas afficher ce bouton')
                .setTextInputComponent(input)
        );
    }
    return labels;
}

// Lit les 5 champs soumis dans le modal et renvoie { buttons, erreurs }.
// buttons : tableau final (lignes vides ignorées) — à enregistrer tel quel.
// erreurs : tableau des numéros de bouton dont le format est invalide (à signaler, non bloquant).
function parseLinkButtonsFromModal(modalSubmit) {
    const buttons = [];
    const erreurs = [];
    for (let i = 0; i < MAX_LINK_BUTTONS; i++) {
        let raw = '';
        try { raw = modalSubmit.fields.getTextInputValue(`lien_${i}`); } catch (_) { /* champ absent */ }
        const parsed = parseLinkButtonField(raw);
        if (parsed === null) continue; // champ laissé vide
        if (parsed === undefined) { erreurs.push(i + 1); continue; } // format invalide
        buttons.push(parsed);
    }
    return { buttons, erreurs };
}

// Construit la (les) ligne(s) de boutons de lien à ajouter aux components du message.
// Renvoie un tableau de ActionRowBuilder (vide si aucun bouton configuré).
function buildLinkButtonsRows(boutons = []) {
    if (!Array.isArray(boutons) || boutons.length === 0) return [];
    const row = new ActionRowBuilder().addComponents(
        boutons.slice(0, MAX_LINK_BUTTONS).map(b =>
            new ButtonBuilder()
                .setLabel(String(b.label).slice(0, 80))
                .setStyle(ButtonStyle.Link)
                .setURL(b.url)
        )
    );
    return [row];
}

// Version "ligne par ligne" pour les conteneurs Components V2 :
// chaque bouton qui a une description devient une Section (texte à gauche + bouton à droite),
// les boutons sans description sont regroupés dans une rangée classique.
// Renvoie { sections: SectionBuilder[], rows: ActionRowBuilder[] }.
function buildLinkButtonsSections(boutons = []) {
    const liste = Array.isArray(boutons) ? boutons.slice(0, MAX_LINK_BUTTONS) : [];
    const avecDescription = liste.filter(b => b.description);
    const sansDescription = liste.filter(b => !b.description);

    const sections = avecDescription.map(b =>
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`• ${b.description}`))
            .setButtonAccessory(
                new ButtonBuilder()
                    .setLabel(String(b.label).slice(0, 80))
                    .setStyle(ButtonStyle.Link)
                    .setURL(b.url)
            )
    );
    return { sections, rows: buildLinkButtonsRows(sansDescription) };
}

module.exports = {
    MAX_LINK_BUTTONS,
    parseLinkButtonField,
    buildLinkButtonsLabelComponents,
    parseLinkButtonsFromModal,
    buildLinkButtonsRows,
    buildLinkButtonsSections,
};