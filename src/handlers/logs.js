const {
    AuditLogEvent,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
    EmbedBuilder,
} = require('discord.js');
const { generateVoiceCardAsync } = require('./voiceCardImage');
const { generateLogCardAsync, formatAge } = require('./logCardImage');
const { getGuildConfig } = require('../core/config');
const { SALON_NOTIF_AJOUT_BOT } = require('../core/constants');
const { isMuted } = require('../core/silentMessages');

// ════════════════════════════════════════════════
// LOGS : cartes image par défaut, ou embeds si le bouton « Embed » est choisi (/settings → Logs)
// Si la génération de l'image échoue, un court message texte est envoyé à la place.
// ════════════════════════════════════════════════

// ────────────────────────────────────────────────
// UTILITAIRES
// ────────────────────────────────────────────────
function truncate(text, maxLength = 1000) {
    if (text == null) return '';
    text = String(text);
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function heureFR() {
    return new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

function dateFR(ts) {
    return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
}

const actorName = a => (a ? (a.displayName ?? a.username) : 'Inconnu');
const userName = u => (u ? (u.displayName ?? u.username ?? 'Inconnu') : 'Inconnu');

// Texte de secours (si l'image ne peut pas être générée)
function fallbackText(spec) {
    const lines = [`**${spec.title ?? 'Log'}**`];
    for (const b of spec.blocks ?? []) lines.push(`${b.label} : ${b.value}`);
    for (const q of spec.quotes ?? []) lines.push(`${q.label} : ${truncate(q.text, 300)}`);
    return truncate(lines.join('\n'), 1900);
}

function linkRow(url) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Voir le message').setStyle(ButtonStyle.Link).setURL(url),
    );
}

// ────────────────────────────────────────────────
// STYLE « EMBED » (boutons Image / Embed dans /settings → Logs)
// Convertit la même spec que les cartes image en embed classique.
// ────────────────────────────────────────────────
const THEME_COLORS = {
    green: 0x2ecc71, red: 0xff4d5e, orange: 0xffb020, amber: 0xff7a45,
    violet: 0xa78bfa, cyan: 0x22d3ee, danger: 0xff2e4d,
};
const VOICE_STYLE = {
    join: { color: 0x2ecc71, title: '🟢 Connecté en vocal' },
    leave: { color: 0xff4d5e, title: '🔴 Déconnecté du vocal' },
    move: { color: 0xffb020, title: '🔀 Changement de salon' },
};

function formatDuration(ms) {
    if (!ms || ms < 0) return '—';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
    if (m > 0) return `${m}min ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
}

function memberAvatar(guild, memberId) {
    try {
        const m = memberId ? guild.members.cache.get(String(memberId)) : null;
        return m ? m.displayAvatarURL({ size: 128 }) : null;
    } catch { return null; }
}

function buildEmbed(guild, spec, opts = {}) {
    const embed = new EmbedBuilder().setTimestamp();
    const fields = [];
    const add = (name, value, inline = true) => {
        if (value == null || String(value).trim() === '') return;
        fields.push({ name: truncate(name, 250), value: truncate(value, 1000), inline });
    };

    if (opts.voice && VOICE_STYLE[spec.type]) {
        const st = VOICE_STYLE[spec.type];
        // Le nom du membre dans le titre : visible aussi dans la notification Discord
        embed.setColor(st.color).setTitle(truncate(`${st.title} — ${spec.username ?? 'Inconnu'}`, 250));
        add('👤 Membre', `${spec.username ?? 'Inconnu'}${spec.tag ? `\n\`${spec.tag}\`` : ''}`);
        if (spec.type === 'move') {
            add('📤 Salon quitté', spec.fromChannel);
            add('📥 Salon rejoint', spec.toChannel);
        } else {
            add(spec.type === 'join' ? '🔊 Salon rejoint' : '🔈 Salon quitté', spec.channelName);
        }
        if (spec.members != null) add(spec.type === 'leave' ? '👥 Membres restants' : '👥 Membres présents', String(spec.members));
        if (spec.type === 'join') {
            add('🎙️ Micro', spec.micMuted ? '🔴 Coupé' : '🟢 Actif');
            add('🎧 Casque', spec.deafened ? '🔴 Coupé' : '🟢 Actif');
        }
        if (spec.type === 'leave' && spec.durationMs) add('⏱️ Durée', formatDuration(spec.durationMs));
        const avatar = memberAvatar(guild, spec.memberId);
        if (avatar) embed.setThumbnail(avatar);
        embed.setFooter({ text: `ID du membre : ${spec.memberId ?? '?'} • Serveur : ${guild.name}` });
    } else {
        embed.setColor(THEME_COLORS[spec.theme] ?? 0xffffff).setTitle(truncate(spec.title ?? 'Log', 250));
        if (spec.sub) embed.setDescription(truncate(spec.sub, 500));
        for (const b of spec.blocks ?? []) add(b.label, b.value);
        if (spec.bigLabel && spec.bigValue != null) add(spec.bigLabel, String(spec.bigValue));
        for (const q of spec.quotes ?? []) {
            const txt = String(q.text ?? '').replace(/```/g, "'''");
            add(q.label, `\`\`\`${truncate(txt, 900)}\`\`\``, false);
        }
        if (spec.pills?.length) add('ℹ️ Infos', spec.pills.map(p => p.text).join(' • '), false);
        const foot = [spec.footerLeft, spec.footerRight].filter(Boolean).join(' • ');
        if (foot) embed.setFooter({ text: truncate(foot, 2000) });
    }

    if (fields.length) embed.addFields(fields.slice(0, 25));
    return embed;
}

// Construit le message à envoyer : image seule (+ bouton éventuel), jamais d'embed
async function buildPayload(guild, spec, opts = {}) {
    const components = opts.components ?? (opts.link ? [linkRow(opts.link)] : []);

    // Style « embed » choisi avec les boutons Image / Embed de /settings → Logs
    if (getGuildConfig(guild.id)?.log_style === 'embed') {
        try {
            return {
                embeds: [buildEmbed(guild, spec, opts)],
                components,
                allowedMentions: { parse: [] },
            };
        } catch (err) {
            console.error('Erreur embed log :', err.message);
        }
    }

    try {
        const buf = opts.voice
            ? await generateVoiceCardAsync({ guildId: guild.id, guildName: guild.name, time: heureFR(), ...spec })
            : await generateLogCardAsync({ guildId: guild.id, time: heureFR(), ...spec });
        return {
            // Pour les logs vocaux, une ligne de texte avec le nom (visible dans la notification)
            ...(opts.voice && opts.fallback ? { content: truncate(opts.fallback, 1900) } : {}),
            files: [new AttachmentBuilder(buf, { name: opts.voice ? 'voice.png' : 'log.png' })],
            components,
            allowedMentions: { parse: [] },
        };
    } catch (err) {
        console.error('Erreur carte log :', err.message);
        return {
            content: truncate(opts.fallback ?? fallbackText(spec), 1900),
            components,
            allowedMentions: { parse: [] },
        };
    }
}

// Salon de logs configuré (null si désactivé / introuvable / pas de permission)
function getLogChannel(guild, categorie) {
    const cfg = getGuildConfig(guild.id);
    if (categorie && cfg?.[categorie] === false) return null; // type de log désactivé
    const logId = cfg?.log_channel_id;
    if (!logId) return null;
    const channel = guild.channels.cache.get(String(logId));
    if (!channel) return null;
    const me = guild.members.me;
    if (!me || !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return null;
    return channel;
}

// Envoie une carte image dans le salon de logs
async function sendCard(guild, categorie, spec, opts = {}) {
    if (!guild) return;
    try {
        const channel = getLogChannel(guild, categorie);
        if (!channel) return;
        const payload = await buildPayload(guild, spec, opts);
        await channel.send(payload);
    } catch (e) {
        console.error('Erreur de log :', e.message);
    }
}

// Ancien helper conservé pour compatibilité (envoie tel quel un embed déjà construit ailleurs)
async function sendLog(guild, embed, categorie = null, files = []) {
    if (!guild) return;
    try {
        const channel = getLogChannel(guild, categorie);
        if (!channel) return;
        await channel.send({ embeds: [embed], files });
    } catch (e) {
        console.error('Erreur de log :', e.message);
    }
}

// ────────────────────────────────────────────────
// AIDE : récupère l'auteur depuis le journal d'audit
// ────────────────────────────────────────────────
async function getAuditActor(guild, actionType, targetId = null, limit = 5) {
    try {
        const logs = await guild.fetchAuditLogs({ type: actionType, limit });
        for (const entry of logs.entries.values()) {
            if (targetId === null || String(entry.target?.id) === String(targetId)) {
                return entry.executor;
            }
        }
    } catch {
        // permissions manquantes ou autre — ignoré
    }
    return null;
}

// ════════════════════════════════════════════════
// ENREGISTREMENT DE TOUS LES HANDLERS DE LOGS
// ════════════════════════════════════════════════
function registerLogHandlers(client) {
    // ── 🗑️ Message supprimé ──────────────────────────────────────
    client.on('messageDelete', async message => {
        try {
            if (!message.guild || message.author?.bot) return;
            if (isMuted(message.id)) return;
            const actor = await getAuditActor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
            const authorInconnu = !message.author;
            const supprimePar = actor && actor.id !== message.author?.id ? actorName(actor) : null;

            const quotes = [{ label: 'Contenu', text: message.cleanContent || message.content || '(vide)', maxLines: 5 }];
            if (message.attachments?.size) {
                quotes.push({ label: 'Pièces jointes', text: message.attachments.map(a => a.name).join(', '), dim: true, maxLines: 2 });
            }
            const pills = [];
            if (message.attachments?.size) pills.push({ text: `${message.attachments.size} pièce(s) jointe(s)`, tone: 'accent' });
            if (message.mentions?.users?.size) pills.push({ text: `${message.mentions.users.size} mention(s)`, tone: 'accent' });

            await sendCard(message.guild, 'log_messages', {
                theme: 'red',
                title: '🗑️ Message supprimé',
                blocks: [
                    { label: 'Auteur', value: authorInconnu ? 'Inconnu' : userName(message.author) },
                    { label: 'Salon', value: `# ${message.channel.name}` },
                    ...(supprimePar ? [{ label: 'Supprimé par', value: supprimePar }] : []),
                    { label: 'Envoyé il y a', value: formatAge(Date.now() - message.createdTimestamp) },
                ],
                quotes,
                pills,
                footerLeft: authorInconnu ? `Message ${message.id}` : `Membre ${message.author.id}`,
                footerRight: message.guild.name,
            });
        } catch (e) {
            console.error('Erreur log messageDelete :', e);
        }
    });

    // ── 🗑️ Suppression en masse ──────────────────────────────────────
    client.on('messageDeleteBulk', async messages => {
        try {
            messages = messages.filter(m => !isMuted(m.id));
            const first = messages.first();
            if (!first?.guild) return;
            const guild = first.guild;
            const channel = first.channel;

            const authors = [...new Set(messages.filter(m => !m.author?.bot).map(m => m.author?.displayName ?? m.author?.username).filter(Boolean))];
            const preview = messages
                .filter(m => m.content)
                .first(5)
                .map(m => `${m.author?.displayName ?? '?'} : ${truncate(m.content, 80)}`)
                .join('  •  ');

            const quotes = [];
            if (authors.length) quotes.push({ label: 'Auteurs concernés', text: authors.slice(0, 10).join(', '), maxLines: 2 });
            if (preview) quotes.push({ label: 'Aperçu (5 premiers)', text: preview, dim: true, maxLines: 5 });

            await sendCard(guild, 'log_messages', {
                theme: 'red',
                title: '🗑️ Suppression en masse',
                blocks: [
                    { label: 'Nombre', value: `${messages.size} messages` },
                    { label: 'Salon', value: `# ${channel.name}` },
                ],
                quotes,
                footerLeft: `Salon ${channel.id}`,
                footerRight: guild.name,
            });
        } catch (e) {
            console.error('Erreur log messageDeleteBulk :', e);
        }
    });

    // ── ✏️ Message modifié ────────────────────────────────────────
    client.on('messageUpdate', async (before, after) => {
        try {
            if (!before.guild || before.author?.bot || after.author?.bot) return;
            if (isMuted(after.id)) return;
            // Message "avant" non mis en cache (partiel) : impossible de comparer
            // fiablement son contenu (content/author valent null). C'est ce qui
            // déclenche les faux "Vide -> texte" quand Discord ré-émet un
            // messageUpdate après coup (ex: hydratation d'un embed avec image),
            // notamment pour les messages postés par le bot lui-même (starboard).
            if (before.partial) return;
            if (before.content === after.content) return;

            const diff = (after.content?.length ?? 0) - (before.content?.length ?? 0);
            const diffStr = diff > 0 ? `+${diff}` : String(diff);

            await sendCard(before.guild, 'log_messages', {
                theme: 'orange',
                title: '✏️ Message modifié',
                blocks: [
                    { label: 'Auteur', value: userName(before.author) },
                    { label: 'Salon', value: `# ${before.channel.name}` },
                ],
                quotes: [
                    { label: 'Avant', text: before.cleanContent || before.content || 'Vide', dim: true, maxLines: 3 },
                    { label: 'Après', text: after.cleanContent || after.content || 'Vide', maxLines: 3 },
                ],
                pills: [{ text: `${diffStr} caractères`, tone: 'accent' }],
                footerLeft: `Membre ${before.author?.id ?? '?'}`,
                footerRight: before.guild.name,
            }, { link: after.url });
        } catch (e) {
            console.error('Erreur log messageUpdate :', e);
        }
    });

    // ── 📥 Nouveau membre ─────────────────────────────────────────
    client.on('guildMemberAdd', async member => {
        try {
            const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
            await sendCard(member.guild, 'log_members', {
                theme: 'green',
                title: '📥 Nouveau membre',
                sub: member.user.tag,
                blocks: [{ label: 'Compte créé', value: `il y a ${formatAge(Date.now() - member.user.createdTimestamp)}` }],
                bigLabel: 'Membre n°',
                bigValue: member.guild.memberCount.toLocaleString('fr-FR'),
                pills: accountAgeDays < 7 ? [{ text: '⚠️ Compte récent', tone: 'bad' }] : [],
                footerLeft: `ID ${member.id}`,
                footerRight: member.guild.name,
            });
        } catch (e) {
            console.error('Erreur log guildMemberAdd :', e);
        }
    });

    // ── 📤 Membre parti ───────────────────────────────────────────
    client.on('guildMemberRemove', async member => {
        try {
            if (member.id === member.client.user.id) return; // le bot lui-même
            if (member.user.bot) return;

            const joinedTs = member.joinedTimestamp;
            const roles = member.roles?.cache
                ? [...member.roles.cache.values()].filter(r => r.id !== member.guild.id)
                : [];
            const rolesTxt = roles.length ? roles.slice(0, 3).map(r => r.name).join(', ') + (roles.length > 3 ? ` +${roles.length - 3}` : '') : 'Aucun';

            await sendCard(member.guild, 'log_members', {
                theme: 'red',
                title: '📤 Membre parti',
                sub: member.user.tag,
                blocks: [
                    { label: 'Resté sur le serveur', value: joinedTs ? formatAge(Date.now() - joinedTs) : 'Inconnu' },
                    { label: 'Rôles', value: rolesTxt },
                ],
                bigLabel: 'Membres restants',
                bigValue: member.guild.memberCount.toLocaleString('fr-FR'),
                footerLeft: `ID ${member.id}`,
                footerRight: member.guild.name,
            });
        } catch (e) {
            console.error('Erreur log guildMemberRemove :', e);
        }
    });

    // ── 🎭 Rôles / ✏️ Pseudo / ⏳ Timeout modifiés ─────────────────
    client.on('guildMemberUpdate', async (before, after) => {
        try {
            const guild = before.guild;

            const added = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
            const removed = before.roles.cache.filter(r => !after.roles.cache.has(r.id));

            if (added.size || removed.size) {
                const actor = await getAuditActor(guild, AuditLogEvent.MemberRoleUpdate, after.id);
                const quotes = [];
                if (added.size) quotes.push({ label: `Rôles ajoutés (${added.size})`, text: added.map(r => r.name).join(', '), maxLines: 2 });
                if (removed.size) quotes.push({ label: `Rôles retirés (${removed.size})`, text: removed.map(r => r.name).join(', '), maxLines: 2 });
                const current = after.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).join(', ') || 'Aucune';
                quotes.push({ label: 'Rôles actuels', text: current, dim: true, maxLines: 2 });

                await sendCard(guild, 'log_members_update', {
                    theme: 'violet',
                    title: '🎭 Rôles modifiés',
                    sub: after.user.tag,
                    blocks: [
                        { label: 'Membre', value: after.displayName },
                        { label: 'Par', value: actor ? actorName(actor) : 'Inconnu' },
                    ],
                    quotes,
                    footerLeft: `ID ${after.id}`,
                    footerRight: guild.name,
                });
            } else if (before.nickname !== after.nickname) {
                const actor = await getAuditActor(guild, AuditLogEvent.MemberUpdate, after.id);
                await sendCard(guild, 'log_members_update', {
                    theme: 'orange',
                    title: '✏️ Pseudo modifié',
                    sub: after.user.tag,
                    blocks: [
                        { label: 'Membre', value: after.user.displayName ?? after.user.username },
                        { label: 'Par', value: actor ? actorName(actor) : 'Auto' },
                    ],
                    quotes: [
                        { label: 'Avant', text: before.nickname || 'Aucun pseudo', dim: true, maxLines: 2 },
                        { label: 'Après', text: after.nickname || 'Aucun pseudo', maxLines: 2 },
                    ],
                    footerLeft: `ID ${after.id}`,
                    footerRight: guild.name,
                });
            } else if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
                const actor = await getAuditActor(guild, AuditLogEvent.MemberUpdate, after.id);
                if (after.communicationDisabledUntilTimestamp) {
                    await sendCard(guild, 'log_members_update', {
                        theme: 'red',
                        title: '⏳ Timeout appliqué',
                        sub: after.user.tag,
                        blocks: [
                            { label: 'Membre', value: after.displayName },
                            { label: 'Par', value: actor ? actorName(actor) : 'Inconnu' },
                            { label: 'Expire le', value: dateFR(after.communicationDisabledUntilTimestamp) },
                            { label: 'Durée restante', value: formatAge(after.communicationDisabledUntilTimestamp - Date.now()) },
                        ],
                        footerLeft: `ID ${after.id}`,
                        footerRight: guild.name,
                    });
                } else {
                    await sendCard(guild, 'log_members_update', {
                        theme: 'green',
                        title: '✅ Timeout retiré',
                        sub: after.user.tag,
                        blocks: [
                            { label: 'Membre', value: after.displayName },
                            { label: 'Par', value: actor ? actorName(actor) : 'Inconnu' },
                        ],
                        footerLeft: `ID ${after.id}`,
                        footerRight: guild.name,
                    });
                }
            }
        } catch (e) {
            console.error('Erreur log guildMemberUpdate :', e);
        }
    });

    // ── ✨ Rôle créé ───────────────────────────────────────────
    client.on('roleCreate', async role => {
        try {
            const actor = await getAuditActor(role.guild, AuditLogEvent.RoleCreate, role.id);
            await sendCard(role.guild, 'log_roles', {
                theme: 'violet',
                title: '✨ Rôle créé',
                blocks: [
                    { label: 'Rôle', value: role.name, dot: role.hexColor },
                    { label: 'Par', value: actorName(actor) },
                    { label: 'Couleur', value: role.hexColor },
                    { label: 'Affiché séparément', value: role.hoist ? 'Oui' : 'Non' },
                ],
                footerLeft: `ID ${role.id}`,
                footerRight: role.guild.name,
            });
        } catch (e) {
            console.error('Erreur log roleCreate :', e);
        }
    });

    // ── 🗑️ Rôle supprimé ─────────────────────────────────────────
    client.on('roleDelete', async role => {
        try {
            const actor = await getAuditActor(role.guild, AuditLogEvent.RoleDelete);
            await sendCard(role.guild, 'log_roles', {
                theme: 'red',
                title: '🗑️ Rôle supprimé',
                blocks: [
                    { label: 'Rôle', value: role.name, dot: role.hexColor },
                    { label: 'Par', value: actorName(actor) },
                    { label: 'Couleur', value: role.hexColor },
                    { label: 'Membres qui l\'avaient', value: String(role.members.size) },
                ],
                footerLeft: `ID ${role.id}`,
                footerRight: role.guild.name,
            });
        } catch (e) {
            console.error('Erreur log roleDelete :', e);
        }
    });

    // ── 📁 Salon créé ─────────────────────────────────────────
    client.on('channelCreate', async channel => {
        try {
            if (!channel.guild) return;
            const actor = await getAuditActor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
            await sendCard(channel.guild, 'log_channels', {
                theme: 'cyan',
                title: '📁 Salon créé',
                blocks: [
                    { label: 'Salon', value: channel.name },
                    { label: 'Catégorie', value: channel.parent ? channel.parent.name : 'Aucune' },
                    { label: 'Type', value: ChannelType[channel.type] ?? String(channel.type) },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${channel.id}`,
                footerRight: channel.guild.name,
            });
        } catch (e) {
            console.error('Erreur log channelCreate :', e);
        }
    });

    // ── 🗑️ Salon supprimé ────────────────────────────────────────
    client.on('channelDelete', async channel => {
        try {
            if (!channel.guild) return;
            const actor = await getAuditActor(channel.guild, AuditLogEvent.ChannelDelete);
            await sendCard(channel.guild, 'log_channels', {
                theme: 'red',
                title: '🗑️ Salon supprimé',
                blocks: [
                    { label: 'Salon', value: channel.name },
                    { label: 'Catégorie', value: channel.parent ? channel.parent.name : 'Aucune' },
                    { label: 'Type', value: ChannelType[channel.type] ?? String(channel.type) },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${channel.id}`,
                footerRight: channel.guild.name,
            });
        } catch (e) {
            console.error('Erreur log channelDelete :', e);
        }
    });

    // ── 🌐 Serveur mis à jour ────────────────────────────────────
    client.on('guildUpdate', async (before, after) => {
        try {
            const changes = [];
            if (before.name !== after.name) changes.push(`Nom : ${before.name} → ${after.name}`);
            if (before.premiumTier !== after.premiumTier) changes.push(`Niveau de boost : ${before.premiumTier} → ${after.premiumTier}`);
            if (before.description !== after.description) changes.push('Description modifiée');
            if (before.icon !== after.icon) changes.push('Icône modifiée');
            if (before.banner !== after.banner) changes.push('Bannière modifiée');
            if (!changes.length) return;

            await sendCard(after, 'log_server', {
                theme: 'orange',
                title: '🌐 Serveur mis à jour',
                blocks: [
                    { label: 'Membres', value: String(after.memberCount) },
                    { label: 'Boosts', value: String(after.premiumSubscriptionCount ?? 0) },
                ],
                quotes: [{ label: 'Changements', text: changes.join('  •  '), maxLines: 4 }],
                footerLeft: `ID ${after.id}`,
                footerRight: after.name,
            });
        } catch (e) {
            console.error('Erreur log guildUpdate :', e);
        }
    });

    // ── 🔗 Invitation créée ──────────────────────────────────────
    client.on('inviteCreate', async invite => {
        try {
            if (!invite.guild) return;
            await sendCard(invite.guild, 'log_server', {
                theme: 'green',
                title: '🔗 Invitation créée',
                blocks: [
                    { label: 'Code', value: invite.code },
                    { label: 'Créée par', value: invite.inviter ? userName(invite.inviter) : 'Inconnu' },
                    { label: 'Salon', value: invite.channel ? `# ${invite.channel.name}` : 'Inconnu' },
                    { label: 'Expire', value: invite.expiresTimestamp ? `dans ${formatAge(invite.expiresTimestamp - Date.now())}` : 'Jamais' },
                    { label: 'Utilisations max', value: invite.maxUses ? String(invite.maxUses) : 'Illimité' },
                    { label: 'Durée max', value: invite.maxAge ? formatAge(invite.maxAge * 1000) : 'Permanente' },
                ],
                footerLeft: `discord.gg/${invite.code}`,
                footerRight: invite.guild.name,
            });
        } catch (e) {
            console.error('Erreur log inviteCreate :', e);
        }
    });

    // ── 🧵 Fil créé ───────────────────────────────────────────
    client.on('threadCreate', async thread => {
        try {
            let owner = null;
            try { owner = await thread.fetchOwner(); } catch { }
            await sendCard(thread.guild, 'log_channels', {
                theme: 'cyan',
                title: '🧵 Fil créé',
                blocks: [
                    { label: 'Fil', value: thread.name },
                    { label: 'Créé par', value: owner?.user ? userName(owner.user) : 'Inconnu' },
                    { label: 'Salon parent', value: thread.parent ? `# ${thread.parent.name}` : 'Inconnu' },
                    { label: 'Archivage auto', value: `${thread.autoArchiveDuration} min` },
                ],
                footerLeft: `ID ${thread.id}`,
                footerRight: thread.guild.name,
            });
        } catch (e) {
            console.error('Erreur log threadCreate :', e);
        }
    });

    // ── 🔊 Connexion / déconnexion vocale ────────────────────────
    // Heure de connexion par membre (pour afficher la durée à la déconnexion)
    const voiceJoinTimes = new Map();
    client.on('voiceStateUpdate', async (before, after) => {
        try {
            const member = after.member ?? before.member;
            if (!member) return;
            const guild = member.guild;
            const joinKey = `${guild.id}:${member.id}`;
            const who = { username: member.displayName, tag: member.user.tag, memberId: member.id };

            if (!before.channel && after.channel) {
                voiceJoinTimes.set(joinKey, Date.now());
                await sendCard(guild, 'log_voice', {
                    ...who, type: 'join', channelName: after.channel.name,
                    members: after.channel.members.size, micMuted: after.selfMute, deafened: after.selfDeaf,
                }, { voice: true, fallback: `🟢 **${member.displayName}** a rejoint le vocal **${after.channel.name}**` });
            } else if (before.channel && !after.channel) {
                const startedAt = voiceJoinTimes.get(joinKey);
                voiceJoinTimes.delete(joinKey);
                await sendCard(guild, 'log_voice', {
                    ...who, type: 'leave', channelName: before.channel.name,
                    members: before.channel.members.size, durationMs: startedAt ? Date.now() - startedAt : null,
                }, { voice: true, fallback: `🔴 **${member.displayName}** a quitté le vocal **${before.channel.name}**` });
            } else if (before.channel?.id !== after.channel?.id) {
                await sendCard(guild, 'log_voice', {
                    ...who, type: 'move', fromChannel: before.channel.name, toChannel: after.channel.name,
                    members: after.channel.members.size,
                }, { voice: true, fallback: `🔀 **${member.displayName}** : **${before.channel.name}** → **${after.channel.name}**` });
            } else if (before.serverMute !== after.serverMute) {
                const actor = await getAuditActor(guild, AuditLogEvent.MemberUpdate, member.id);
                await sendCard(guild, 'log_voice', {
                    theme: after.serverMute ? 'red' : 'green',
                    title: after.serverMute ? '🔇 Muté par le serveur' : '🔊 Démuté par le serveur',
                    sub: member.user.tag,
                    blocks: [
                        { label: 'Membre', value: member.displayName },
                        { label: 'Salon', value: before.channel ? before.channel.name : 'Inconnu' },
                        ...(actor ? [{ label: 'Par', value: actorName(actor) }] : []),
                    ],
                    footerLeft: `ID ${member.id}`,
                    footerRight: guild.name,
                });
            } else if (before.serverDeaf !== after.serverDeaf) {
                await sendCard(guild, 'log_voice', {
                    theme: after.serverDeaf ? 'red' : 'green',
                    title: after.serverDeaf ? '🚫 Sourdine serveur activée' : '✅ Sourdine serveur retirée',
                    sub: member.user.tag,
                    blocks: [
                        { label: 'Membre', value: member.displayName },
                        { label: 'Salon', value: before.channel ? before.channel.name : 'Inconnu' },
                    ],
                    footerLeft: `ID ${member.id}`,
                    footerRight: guild.name,
                });
            }
        } catch (e) {
            console.error('Erreur log voiceStateUpdate :', e);
        }
    });

    // ── 💬 Message envoyé (log de CHAQUE message) ──────────────────
    // ⚠️ Très verbeux : envoie un log pour CHAQUE message du serveur.
    client.on('messageCreate', async message => {
        try {
            if (!message.guild || message.author?.bot) return;
            if (isMuted(message.id)) return;
            const pills = [];
            if (message.attachments?.size) pills.push({ text: `${message.attachments.size} pièce(s) jointe(s)`, tone: 'accent' });
            if (message.stickers?.size) pills.push({ text: 'Sticker', tone: 'accent' });

            await sendCard(message.guild, 'log_messages_sent', {
                theme: 'cyan',
                title: '💬 Message envoyé',
                blocks: [
                    { label: 'Auteur', value: userName(message.author) },
                    { label: 'Salon', value: `# ${message.channel.name}` },
                ],
                quotes: [{ label: 'Contenu', text: message.cleanContent || message.content || '(sans texte)', maxLines: 5 }],
                pills,
                footerLeft: `Membre ${message.author.id}`,
                footerRight: message.guild.name,
            }, { link: message.url });
        } catch (e) {
            console.error('Erreur log messageCreate :', e);
        }
    });

    // ── 🔨 Membre banni ───────────────────────────────────────────
    client.on('guildBanAdd', async ban => {
        try {
            const actor = await getAuditActor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
            await sendCard(ban.guild, 'log_bans', {
                theme: 'red',
                title: '🔨 Membre banni',
                sub: ban.user.tag,
                blocks: [
                    { label: 'Membre', value: ban.user.username },
                    { label: 'Par', value: actorName(actor) },
                ],
                quotes: ban.reason ? [{ label: 'Raison', text: ban.reason, maxLines: 3 }] : [],
                footerLeft: `ID ${ban.user.id}`,
                footerRight: ban.guild.name,
            });
        } catch (e) {
            console.error('Erreur log guildBanAdd :', e);
        }
    });

    // ── ✅ Bannissement levé ────────────────────────────────────────────────
    client.on('guildBanRemove', async ban => {
        try {
            const actor = await getAuditActor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
            await sendCard(ban.guild, 'log_bans', {
                theme: 'green',
                title: '✅ Bannissement levé',
                sub: ban.user.tag,
                blocks: [
                    { label: 'Membre', value: ban.user.username },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${ban.user.id}`,
                footerRight: ban.guild.name,
            });
        } catch (e) {
            console.error('Erreur log guildBanRemove :', e);
        }
    });

    // ── 😀 Emoji ajouté / supprimé ──────────────────────────────────
    // L'emoji lui-même est dessiné dans l'image (<:nom:id>)
    const emojiTag = emoji => `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}> :${emoji.name}:`;

    client.on('emojiCreate', async emoji => {
        try {
            const actor = await getAuditActor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
            await sendCard(emoji.guild, 'log_emojis', {
                theme: 'green',
                title: '😀 Emoji ajouté',
                blocks: [
                    { label: 'Emoji', value: emojiTag(emoji) },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${emoji.id}`,
                footerRight: emoji.guild.name,
            });
        } catch (e) {
            console.error('Erreur log emojiCreate :', e);
        }
    });

    client.on('emojiDelete', async emoji => {
        try {
            const actor = await getAuditActor(emoji.guild, AuditLogEvent.EmojiDelete);
            await sendCard(emoji.guild, 'log_emojis', {
                theme: 'red',
                title: '🗑️ Emoji supprimé',
                blocks: [
                    { label: 'Emoji', value: emojiTag(emoji) },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${emoji.id}`,
                footerRight: emoji.guild.name,
            });
        } catch (e) {
            console.error('Erreur log emojiDelete :', e);
        }
    });

    // ── 🏷️ Sticker ajouté / supprimé ────────────────────────────────
    client.on('stickerCreate', async sticker => {
        try {
            if (!sticker.guild) return;
            const actor = await getAuditActor(sticker.guild, AuditLogEvent.StickerCreate, sticker.id);
            await sendCard(sticker.guild, 'log_emojis', {
                theme: 'green',
                title: '🏷️ Sticker ajouté',
                blocks: [
                    { label: 'Sticker', value: sticker.name },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${sticker.id}`,
                footerRight: sticker.guild.name,
            });
        } catch (e) {
            console.error('Erreur log stickerCreate :', e);
        }
    });

    client.on('stickerDelete', async sticker => {
        try {
            if (!sticker.guild) return;
            const actor = await getAuditActor(sticker.guild, AuditLogEvent.StickerDelete);
            await sendCard(sticker.guild, 'log_emojis', {
                theme: 'red',
                title: '🗑️ Sticker supprimé',
                blocks: [
                    { label: 'Sticker', value: sticker.name },
                    { label: 'Par', value: actorName(actor) },
                ],
                footerLeft: `ID ${sticker.id}`,
                footerRight: sticker.guild.name,
            });
        } catch (e) {
            console.error('Erreur log stickerDelete :', e);
        }
    });

    // ── ✏️ Salon modifié (nom, sujet, nsfw, slowmode) ──────────────────
    client.on('channelUpdate', async (before, after) => {
        try {
            if (!after.guild) return;

            // On ignore les salons de type "Server Stats" : leur renommage
            // automatique (toutes les 10 min) ne doit pas polluer les logs.
            try {
                const cfg = getGuildConfig(after.guild.id);
                const isStatsChannel = Array.isArray(cfg?.serverstats_counters)
                    && cfg.serverstats_counters.some(c => c.channelId === after.id);
                if (isStatsChannel) return;
            } catch (e) {
                // pas de config -> on continue le log normalement
            }

            const changes = [];
            if (before.name !== after.name) changes.push(`Nom : ${before.name} → ${after.name}`);
            if (before.topic !== after.topic) changes.push('Sujet modifié');
            if (before.nsfw !== after.nsfw) changes.push(`NSFW : ${before.nsfw} → ${after.nsfw}`);
            if (before.rateLimitPerUser !== after.rateLimitPerUser) changes.push(`Slowmode : ${before.rateLimitPerUser}s → ${after.rateLimitPerUser}s`);
            if (!changes.length) return;

            const actor = await getAuditActor(after.guild, AuditLogEvent.ChannelUpdate, after.id);
            await sendCard(after.guild, 'log_channels', {
                theme: 'orange',
                title: '✏️ Salon modifié',
                blocks: [
                    { label: 'Salon', value: `# ${after.name}` },
                    { label: 'Par', value: actorName(actor) },
                ],
                quotes: [{ label: 'Changements', text: changes.join('  •  '), maxLines: 4 }],
                footerLeft: `ID ${after.id}`,
                footerRight: after.guild.name,
            });
        } catch (e) {
            console.error('Erreur log channelUpdate :', e);
        }
    });

    // ── 🎭 Rôle modifié (nom, couleur, permissions) ───────────────
    client.on('roleUpdate', async (before, after) => {
        try {
            const changes = [];
            if (before.name !== after.name) changes.push(`Nom : ${before.name} → ${after.name}`);
            if (before.hexColor !== after.hexColor) changes.push(`Couleur : ${before.hexColor} → ${after.hexColor}`);
            if (before.hoist !== after.hoist) changes.push(`Affiché séparément : ${before.hoist} → ${after.hoist}`);
            if (before.mentionable !== after.mentionable) changes.push(`Mentionnable : ${before.mentionable} → ${after.mentionable}`);
            if (before.permissions.bitfield !== after.permissions.bitfield) changes.push('Permissions modifiées');
            if (!changes.length) return;

            const actor = await getAuditActor(after.guild, AuditLogEvent.RoleUpdate, after.id);
            await sendCard(after.guild, 'log_roles', {
                theme: 'orange',
                title: '🎭 Rôle modifié',
                blocks: [
                    { label: 'Rôle', value: after.name, dot: after.hexColor },
                    { label: 'Par', value: actorName(actor) },
                ],
                quotes: [{ label: 'Changements', text: changes.join('  •  '), maxLines: 4 }],
                footerLeft: `ID ${after.id}`,
                footerRight: after.guild.name,
            });
        } catch (e) {
            console.error('Erreur log roleUpdate :', e);
        }
    });

    // ── Boutons Blacklist / Whitelist / Statistique (ajout / retrait du bot) ──
    const botRow = guildId => new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`botadd_blacklist_${guildId}`).setLabel('Blacklist').setStyle(ButtonStyle.Danger).setEmoji('⛔'),
        new ButtonBuilder().setCustomId(`botadd_whitelist_${guildId}`).setLabel('Whitelist').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`botadd_stats_${guildId}`).setLabel('Statistique').setStyle(ButtonStyle.Secondary).setEmoji('📊'),
    );

    // ── ➕ Bot ajouté à un serveur ──────────────────────────────
    client.on('guildCreate', async guild => {
        try {
            let inviter = null;
            try {
                const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
                const entry = auditLogs.entries.find(e => e.target?.id === client.user.id);
                inviter = entry?.executor ?? null;
            } catch (e) {
                console.warn(`Impossible de lire le journal d'audit pour ${guild.name} (permissions manquantes) :`, e.message);
            }

            const owner = await guild.fetchOwner().catch(() => null);

            const salonNotif = await client.channels.fetch(SALON_NOTIF_AJOUT_BOT).catch(() => null);
            if (!salonNotif) {
                console.error(`Salon de notification d'ajout introuvable (${SALON_NOTIF_AJOUT_BOT}).`);
                return;
            }
            const payload = await buildPayload(guild, {
                theme: 'green',
                title: '➕ Bot ajouté à un serveur',
                sub: guild.name,
                blocks: [
                    { label: 'Membres', value: String(guild.memberCount) },
                    { label: 'Propriétaire', value: owner ? owner.user.tag : 'Inconnu' },
                    { label: 'Ajouté par', value: inviter ? inviter.tag : 'Inconnu' },
                    { label: 'Serveur créé il y a', value: formatAge(Date.now() - guild.createdTimestamp) },
                ],
                bigLabel: 'Serveurs du bot',
                bigValue: String(client.guilds.cache.size),
                footerLeft: `ID ${guild.id}`,
                footerRight: guild.name,
            }, { components: [botRow(guild.id)] });
            await salonNotif.send(payload).catch(e => {
                console.error("Impossible d'envoyer la notification guildCreate dans le salon dédié :", e.message);
            });
        } catch (e) {
            console.error('Erreur log guildCreate :', e);
        }
    });

    // ── ➖ Bot retiré d'un serveur ──────────────────────────────
    client.on('guildDelete', async guild => {
        try {
            const salonNotif = await client.channels.fetch(SALON_NOTIF_AJOUT_BOT).catch(() => null);
            if (!salonNotif) {
                console.error(`Salon de notification de retrait introuvable (${SALON_NOTIF_AJOUT_BOT}).`);
                return;
            }
            const payload = await buildPayload(guild, {
                theme: 'red',
                title: "➖ Bot retiré d'un serveur",
                sub: guild.name,
                blocks: [
                    { label: 'Membres (avant de partir)', value: String(guild.memberCount) },
                ],
                bigLabel: 'Serveurs du bot',
                bigValue: String(client.guilds.cache.size),
                footerLeft: `ID ${guild.id}`,
                footerRight: guild.name,
            }, { components: [botRow(guild.id)] });
            await salonNotif.send(payload).catch(e => {
                console.error("Impossible d'envoyer la notification guildDelete dans le salon dédié :", e.message);
            });
        } catch (e) {
            console.error('Erreur log guildDelete :', e);
        }
    });

    console.log('✅ Système de logs détaillé initialisé.');
}

module.exports = { registerLogHandlers, sendLog, getAuditActor, truncate };
