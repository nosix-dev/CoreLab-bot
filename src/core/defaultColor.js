// ────────────────────────────────────────────────
// Couleur par défaut de CoreLab : orange #E8510D
// Appliquée automatiquement à tout embed et à tout Container (Components V2)
// envoyé sans couleur explicite. Les couleurs déjà définies ne changent pas.
// ────────────────────────────────────────────────
const { EmbedBuilder, ContainerBuilder } = require('discord.js');

const DEFAULT_COLOR = 0xE8510D;

function patch(Builder, key) {
    if (!Builder || Builder.prototype.__corelabDefaultColor) return;
    const original = Builder.prototype.toJSON;
    Builder.prototype.toJSON = function (...args) {
        const json = original.apply(this, args);
        if (json && (json[key] === undefined || json[key] === null)) json[key] = DEFAULT_COLOR;
        return json;
    };
    Builder.prototype.__corelabDefaultColor = true;
}

patch(EmbedBuilder, 'color');
patch(ContainerBuilder, 'accent_color');

module.exports = { DEFAULT_COLOR };
