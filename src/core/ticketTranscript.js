'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Transcription HTML des tickets.
//  • generateTranscriptHtml(channel)  → { html, count, users }
//  • sendTicketClosedLog({ channel, closer, cfg })
//      envoie en MP à la personne qui a ouvert le ticket : récap + fichier transcript-N.html
// ─────────────────────────────────────────────────────────────────────────

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');

const MAX_MESSAGES = 5000;
const TZ = 'Europe/Paris';

// ── Utilitaires ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDateHeure(d) {
  const date = new Date(d);
  const p = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function fmtArchive(d) {
  const date = new Date(d);
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  const heure = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(':', ':');
  return `${jour} à ${heure}`;
}

function hexColor(n) {
  if (n === undefined || n === null) return null;
  return '#' + Number(n).toString(16).padStart(6, '0');
}

// ── Markdown Discord (version allégée) ─────────────────────────────────────
function renderMarkdown(raw, ctx) {
  let text = String(raw ?? '');
  const blocks = [];
  const keep = (html) => { blocks.push(html); return `\u0000${blocks.length - 1}\u0000`; };

  // Blocs de code
  text = text.replace(/```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g, (_, c) => keep(`<pre class="codeblock">${esc(c.replace(/\n$/, ''))}</pre>`));
  // Code inline
  text = text.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code class="inline">${esc(c)}</code>`));
  // Mentions / emojis / timestamps (avant l'échappement : les chevrons sont de la syntaxe Discord)
  text = text.replace(/<@!?(\d+)>/g, (_, id) => keep(`<span class="mention">@${esc(ctx.userName(id))}</span>`));
  text = text.replace(/<@&(\d+)>/g, (_, id) => keep(`<span class="mention">@${esc(ctx.roleName(id))}</span>`));
  text = text.replace(/<#(\d+)>/g, (_, id) => keep(`<span class="mention">#${esc(ctx.channelName(id))}</span>`));
  text = text.replace(/<(a?):([\w]+):(\d+)>/g, (_, a, name, id) => keep(`<img class="emoji" alt=":${esc(name)}:" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'png'}?size=48">`));
  text = text.replace(/<t:(\d+)(?::([a-zA-Z]))?>/g, (_, ts) => keep(`<span class="mention">${esc(fmtDateHeure(Number(ts) * 1000))}</span>`));

  text = esc(text);

  // Titres, sous-texte, citations (ligne par ligne)
  text = text.split('\n').map((line) => {
    let m;
    if ((m = line.match(/^(#{1,3}) (.+)$/))) return `<div class="h h${m[1].length}">${m[2]}</div>`;
    if ((m = line.match(/^-# (.+)$/))) return `<div class="subtext">${m[1]}</div>`;
    if ((m = line.match(/^&gt; (.*)$/))) return `<div class="quote">${m[1]}</div>`;
    if ((m = line.match(/^[-*] (.+)$/))) return `<div class="li">• ${m[1]}</div>`;
    return line;
  }).join('\n');

  // Liens
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  text = text.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  // Styles
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<u>$1</u>');
  text = text.replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>');
  text = text.replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>');
  text = text.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');

  text = text.replace(/\n/g, '<br>');
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  return text;
}

// ── Composants (Components V2 + boutons classiques) ────────────────────────
const BTN_CLASS = { 1: 'b-primary', 2: 'b-secondary', 3: 'b-success', 4: 'b-danger', 5: 'b-link' };

function renderEmoji(e) {
  if (!e) return '';
  if (e.id) return `<img class="emoji" alt="" src="https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}?size=32">`;
  return esc(e.name || '');
}

function renderComponent(c, ctx) {
  if (!c) return '';
  switch (c.type) {
    case 1: // ActionRow
      return `<div class="row">${(c.components || []).map(x => renderComponent(x, ctx)).join('')}</div>`;
    case 2: { // Button
      const cls = BTN_CLASS[c.style] || 'b-secondary';
      const label = `${renderEmoji(c.emoji)}${c.emoji && c.label ? ' ' : ''}${esc(c.label || '')}`;
      return `<span class="btn ${cls}${c.disabled ? ' disabled' : ''}">${label}</span>`;
    }
    case 3: case 5: case 6: case 7: case 8: // Menus déroulants
      return `<span class="btn b-select">${esc(c.placeholder || 'Menu')} ▾</span>`;
    case 9: { // Section
      const textes = (c.components || []).map(x => renderComponent(x, ctx)).join('');
      const acc = c.accessory ? renderComponent(c.accessory, ctx) : '';
      return `<div class="section"><div class="section-text">${textes}</div>${acc ? `<div class="section-acc">${acc}</div>` : ''}</div>`;
    }
    case 10: // TextDisplay
      return `<div class="md">${renderMarkdown(c.content, ctx)}</div>`;
    case 11: // Thumbnail
      return c.media?.url ? `<img class="thumb" src="${esc(c.media.url)}" alt="">` : '';
    case 12: // MediaGallery
      return `<div class="gallery">${(c.items || []).map(i => i.media?.url ? `<img class="media" src="${esc(i.media.url)}" alt="">` : '').join('')}</div>`;
    case 13: // File
      return c.file?.url ? `<div class="file">📎 <a href="${esc(c.file.url)}" target="_blank" rel="noopener">${esc(c.file.url.split('/').pop().split('?')[0])}</a></div>` : '';
    case 14: // Separator
      return c.divider === false ? '<div class="sep-space"></div>' : '<hr class="sep">';
    case 17: { // Container
      const color = hexColor(c.accent_color) || '#4e5058';
      return `<div class="container" style="border-left-color:${color}">${(c.components || []).map(x => renderComponent(x, ctx)).join('')}</div>`;
    }
    default:
      return '';
  }
}

// ── Embeds classiques ──────────────────────────────────────────────────────
function renderEmbed(e, ctx) {
  const color = hexColor(e.color) || '#4e5058';
  const parts = [];
  if (e.author?.name) parts.push(`<div class="e-author">${e.author.icon_url ? `<img src="${esc(e.author.icon_url)}" alt="">` : ''}${esc(e.author.name)}</div>`);
  if (e.title) parts.push(`<div class="e-title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>`);
  if (e.description) parts.push(`<div class="md">${renderMarkdown(e.description, ctx)}</div>`);
  if (e.fields?.length) {
    parts.push(`<div class="e-fields">${e.fields.map(f => `<div class="e-field${f.inline ? ' inline' : ''}"><div class="e-fname">${renderMarkdown(f.name, ctx)}</div><div class="md">${renderMarkdown(f.value, ctx)}</div></div>`).join('')}</div>`);
  }
  if (e.image?.url) parts.push(`<img class="media" src="${esc(e.image.url)}" alt="">`);
  if (e.footer?.text) parts.push(`<div class="e-footer">${esc(e.footer.text)}</div>`);
  const thumb = e.thumbnail?.url ? `<img class="thumb" src="${esc(e.thumbnail.url)}" alt="">` : '';
  return `<div class="embed" style="border-left-color:${color}"><div class="embed-body">${parts.join('')}</div>${thumb}</div>`;
}

// ── Récupération de tous les messages du salon ─────────────────────────────
async function fetchAllMessages(channel) {
  const all = [];
  let before;
  while (all.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// ── Génération de la page ──────────────────────────────────────────────────
const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#1e1f22;color:#dbdee1;font-family:"gg sans","Noto Sans","Segoe UI",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.375}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
.panel{background:#313338;border-radius:8px;overflow:hidden;border:1px solid #26272b}
.head{padding:14px 20px;border-bottom:1px solid #26272b;font-weight:600;color:#f2f3f5;font-size:16px}
.head span{color:#80848e;margin-right:8px}
.msgs{padding:10px 0}
.msg{display:flex;gap:16px;padding:2px 20px 2px 20px}
.msg.first{margin-top:16px;padding-top:2px}
.msg:hover{background:#2e3035}
.av{width:40px;flex:none}
.av img{width:40px;height:40px;border-radius:50%;display:block;margin-top:2px}
.gutter{width:40px;flex:none}
.body{min-width:0;flex:1}
.meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.name{font-weight:500;color:#f2f3f5}
.tag{background:#5865f2;color:#fff;font-size:10px;font-weight:600;border-radius:4px;padding:1px 5px;line-height:15px;text-transform:uppercase}
.time{color:#949ba4;font-size:12px}
.edited{color:#949ba4;font-size:10px}
.reply{display:flex;align-items:center;gap:6px;color:#b5bac1;font-size:13px;margin:0 0 2px 0;position:relative}
.reply .rn{font-weight:500;color:#dbdee1}
.reply .rt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px}
.md{word-wrap:break-word;overflow-wrap:anywhere}
.h{font-weight:700;margin:6px 0 2px}.h1{font-size:1.5em}.h2{font-size:1.25em}.h3{font-size:1.1em}
.subtext{font-size:12px;color:#949ba4}
.quote{border-left:4px solid #4e5058;padding-left:10px;margin:2px 0}
.mention{background:rgba(88,101,242,.3);color:#c9cdfb;border-radius:3px;padding:0 2px;font-weight:500}
.codeblock{background:#2b2d31;border:1px solid #1e1f22;border-radius:4px;padding:8px;margin:4px 0;font-family:Consolas,"Courier New",monospace;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
code.inline{background:#2b2d31;border-radius:3px;padding:1px 4px;font-family:Consolas,"Courier New",monospace;font-size:14px}
.spoiler{background:#1e1f22;color:#1e1f22;border-radius:3px;padding:0 2px}.spoiler:hover{color:#dbdee1}
a{color:#00a8fc;text-decoration:none}a:hover{text-decoration:underline}
.emoji{height:1.375em;width:1.375em;vertical-align:bottom;object-fit:contain}
.embed{display:flex;gap:16px;background:#2b2d31;border-left:4px solid #4e5058;border-radius:4px;padding:8px 16px 16px 12px;margin-top:6px;max-width:520px;width:fit-content;min-width:200px}
.embed-body{min-width:0;flex:1}
.e-author{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-top:8px}.e-author img{width:24px;height:24px;border-radius:50%}
.e-title{font-weight:600;color:#f2f3f5;margin-top:8px}
.embed .md{font-size:14px;margin-top:8px}
.e-fields{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.e-field{grid-column:1/-1;min-width:0}.e-field.inline{grid-column:auto}
.e-fname{font-weight:600;font-size:14px;color:#f2f3f5}.e-field .md{margin-top:2px}
.e-footer{font-size:12px;color:#b5bac1;margin-top:8px}
.container{background:#2b2d31;border-left:4px solid #4e5058;border-radius:8px;padding:12px 16px;margin-top:6px;max-width:520px;width:fit-content;min-width:240px}
.container .md{font-size:14px}
.container .md+.md{margin-top:4px}
.section{display:flex;gap:12px;justify-content:space-between;align-items:flex-start}.section-text{min-width:0;flex:1}
.thumb{width:80px;height:80px;border-radius:6px;object-fit:cover}
.gallery{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.media{max-width:100%;max-height:350px;border-radius:6px;display:block;margin-top:6px}
.sep{border:0;border-top:1px solid #3f4147;margin:8px 0}.sep-space{height:8px}
.row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:6px;border-radius:4px;padding:2px 14px;min-height:32px;font-size:14px;font-weight:500;color:#fff}
.b-primary{background:#5865f2}.b-secondary,.b-select{background:#4e5058}.b-success{background:#248046}.b-danger{background:#da373c}.b-link{background:#4e5058}
.btn.disabled{opacity:.5}
.att{margin-top:4px}
.att .file{display:inline-flex;gap:8px;align-items:center;background:#2b2d31;border:1px solid #1e1f22;border-radius:6px;padding:8px 12px;font-size:14px}
.foot{margin:16px 0 0;background:#313338;border:1px solid #26272b;border-radius:8px;padding:18px 20px;font-weight:600;color:#f2f3f5}
@media(max-width:600px){.msg{gap:10px;padding:2px 10px}.wrap{padding:8px}}
`;

async function generateTranscriptHtml(channel) {
  const guild = channel.guild;
  const messages = await fetchAllMessages(channel);

  const byId = new Map(messages.map(m => [m.id, m]));
  const usersSeen = new Map();
  for (const m of messages) {
    usersSeen.set(m.author.id, m.author);
    for (const u of m.mentions?.users?.values?.() ?? []) usersSeen.set(u.id, u);
  }

  const ctx = {
    userName: (id) => {
      const mem = guild?.members?.cache?.get(id);
      return mem?.displayName || usersSeen.get(id)?.globalName || usersSeen.get(id)?.username || id;
    },
    roleName: (id) => guild?.roles?.cache?.get(id)?.name || 'rôle',
    channelName: (id) => guild?.channels?.cache?.get(id)?.name || 'salon',
  };

  const rows = [];
  let prev = null;
  for (const m of messages) {
    const mem = m.member || guild?.members?.cache?.get(m.author.id);
    const nom = mem?.displayName || m.author.globalName || m.author.username;
    const couleur = mem?.displayHexColor && mem.displayHexColor !== '#000000' ? mem.displayHexColor : null;
    const groupe = prev
      && prev.author.id === m.author.id
      && !m.reference
      && (m.createdTimestamp - prev.createdTimestamp) < 7 * 60 * 1000;

    // Réponse
    let reply = '';
    if (m.reference?.messageId) {
      const ref = byId.get(m.reference.messageId);
      if (ref) {
        const rmem = ref.member || guild?.members?.cache?.get(ref.author.id);
        const rnom = rmem?.displayName || ref.author.globalName || ref.author.username;
        const rtxt = (ref.content || (ref.embeds?.length || ref.components?.length ? 'Cliquez pour voir la pièce jointe' : '')).replace(/\s+/g, ' ').slice(0, 120);
        reply = `<div class="reply">↪ <span class="rn">${esc(rnom)}</span> <span class="rt">${renderMarkdown(rtxt, ctx)}</span></div>`;
      } else {
        reply = '<div class="reply">↪ <span class="rt">Message d\'origine introuvable</span></div>';
      }
    }

    // Contenu
    const contenu = [];
    if (m.content) contenu.push(`<div class="md">${renderMarkdown(m.content, ctx)}</div>`);
    for (const e of m.embeds || []) contenu.push(renderEmbed(typeof e.toJSON === 'function' ? e.toJSON() : e, ctx));
    for (const c of m.components || []) contenu.push(renderComponent(typeof c.toJSON === 'function' ? c.toJSON() : c, ctx));
    const atts = [...(m.attachments?.values?.() ?? [])];
    if (atts.length) {
      contenu.push('<div class="att">' + atts.map(a => (a.contentType || '').startsWith('image/')
        ? `<img class="media" src="${esc(a.url)}" alt="${esc(a.name)}">`
        : `<div class="file">📎 <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a></div>`).join('') + '</div>');
    }
    if (m.stickers?.size) contenu.push(`<div class="md">${[...m.stickers.values()].map(s => `[Sticker : ${esc(s.name)}]`).join(' ')}</div>`);
    if (!contenu.length) contenu.push('<div class="md" style="color:#949ba4">[Message sans contenu affichable]</div>');

    const avatar = m.author.displayAvatarURL({ extension: 'png', size: 64 });
    const edite = m.editedTimestamp ? '<span class="edited">(modifié)</span>' : '';

    if (groupe) {
      rows.push(`<div class="msg"><div class="gutter"></div><div class="body">${contenu.join('')}</div></div>`);
    } else {
      rows.push(`<div class="msg first"><div class="av"><img src="${esc(avatar)}" alt=""></div><div class="body">${reply}<div class="meta"><span class="name"${couleur ? ` style="color:${couleur}"` : ''}>${esc(nom)}</span>${m.author.bot ? '<span class="tag">✓ APP</span>' : ''}<span class="time">${fmtDateHeure(m.createdTimestamp)}</span>${edite}</div>${contenu.join('')}</div></div>`);
    }
    prev = m;
  }

  const titre = `#${channel.name}`;
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcription — ${esc(channel.name)}</title><style>${CSS}</style></head>
<body><div class="wrap">
<div class="panel"><div class="head"><span>#</span>${esc(channel.name)}</div><div class="msgs">${rows.join('\n') || '<div class="msg"><div class="body"><div class="md" style="color:#949ba4">Aucun message.</div></div></div>'}</div></div>
<div class="foot">Cette archive a été générée le ${esc(fmtArchive(Date.now()))}</div>
</div></body></html>`;

  return { html, count: messages.length, users: [...usersSeen.values()].filter(u => !u.bot), titre, messages };
}

// ── Log « Ticket Fermé » ───────────────────────────────────────────────────
function guessOpenerId(channel, messages) {
  // Repli pour les tickets créés avant l'ajout des métadonnées : 1re mention du 1er message.
  const first = messages?.[0];
  const m = first?.content?.match(/<@!?(\d+)>/);
  return m ? m[1] : null;
}

async function sendTicketClosedLog({ channel, closer, cfg }) {
  const guild = channel.guild;
  const { html, messages } = await generateTranscriptHtml(channel);
  const meta = cfg?.ticket_meta?.[channel.id] || {};
  const openerId = meta.openerId || guessOpenerId(channel, messages);
  const identifiant = meta.n ?? '—';
  const nomFichier = `transcript-${meta.n ?? channel.name}.html`.replace(/[^\w.\-]/g, '_');
  const raison = meta.reason || channel.topic?.split('|')[1]?.trim() || '—';
  const ouvertLe = Math.floor((meta.openedAt || channel.createdTimestamp) / 1000);

  const embed = new EmbedBuilder()
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTitle('🔒 Ticket Fermé')
    .setColor(0x2ECC71)
    .addFields(
      { name: '🆔 Identifiant', value: String(identifiant), inline: true },
      { name: '✅ Ouvert par', value: openerId ? `<@${openerId}>` : (meta.openerTag || '—'), inline: true },
      { name: '❌ Fermé par', value: `<@${closer.id}>`, inline: true },
      { name: '🕐 Date d\'ouverture', value: `<t:${ouvertLe}:f>`, inline: true },
      { name: '🎫 Panneau', value: String(raison).slice(0, 1024), inline: true },
      { name: '#️⃣ Nom du ticket', value: channel.name, inline: true },
    )
    .setTimestamp();

  const fichier = () => new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: nomFichier });
  let envoye = false;

  // MP à la personne qui a ouvert le ticket
  if (openerId) {
    try {
      const opener = await channel.client.users.fetch(openerId);
      // 1) résumé du ticket en carte « verre fumé » ; 2) fichier de transcription (HTML) juste après
      await opener.send(await require('./glassEmbed').glassPayload({ embeds: [embed], allowedMentions: { parse: [] } },
        { guild, client: channel.client, badge: 'TICKET', avatar: guild.iconURL({ extension: 'png', size: 256 }) || undefined }));
      await opener.send({
        content: `📄 Voici la transcription de ton ticket **${channel.name}** sur **${guild.name}**.\nTélécharge le fichier puis ouvre-le dans ton navigateur.`,
        files: [fichier()],
        allowedMentions: { parse: [] },
      });
      envoye = true;
    } catch (e) {
      // MP fermés ou bot bloqué : on ignore
      console.warn(`[Ticket] MP de transcription impossible pour ${openerId} :`, e.message);
    }
  }
  return envoye;
}

module.exports = { generateTranscriptHtml, sendTicketClosedLog, renderMarkdown };