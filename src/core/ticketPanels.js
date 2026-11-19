"use strict";

const crypto = require("crypto");

function createPanelId() {
  return crypto.randomBytes(8).toString("hex");
}

function defaultPanel(id) {
  return {
    id,
    name: "Nouveau panneau",
    channelId: "",
    categoryId: "",
    layout: "button",
    title: "Support",
    description: "Clique sur le bouton ci-dessous pour ouvrir un ticket.",
    color: "#e8510d",
    footerText: "",
    statusLine: "",
    buttonLabel: "Ouvrir un ticket",
    buttonEmoji: "🎫",
    openRoleIds: [],
    questions: [],
    openTitle: "",
    openDescription: "",
    staffRoleIds: [],
    claimEnabled: false,
    logChannelId: "",
    transcriptsEnabled: true,
    reasons: [{ label: "Support", value: "support", description: "", emoji: "🎫", color: "blurple" }],
    publishedMessageId: null,
    createdAt: Date.now()
  };
}

function shortText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function slug(value, fallback) {
  const result = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return result || fallback;
}

function normalizePanel(input, existing, guild, requirePublish = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Réglages du panneau invalides." };
  }
  const base = existing || defaultPanel(input.id || createPanelId());
  const reasons = Array.isArray(input.reasons) ? input.reasons.slice(0, 25).map((reason, index) => {
    const label = shortText(reason && reason.label, 80);
    return {
      label,
      value: slug(reason && reason.value || label, `raison_${index + 1}`),
      description: shortText(reason && reason.description, 100),
      emoji: shortText(reason && reason.emoji, 50),
      color: shortText(reason && reason.color, 10) || "blurple",
      categoryId: String(reason && reason.categoryId || "").trim()
    };
  }) : [];
  const questions = Array.isArray(input.questions) ? input.questions.slice(0, 50).map(question => ({
    label: shortText(question && question.label, 45),
    placeholder: shortText(question && question.placeholder, 100),
    style: question && question.style === "paragraph" ? "paragraph" : "short",
    required: !question || question.required !== false
  })) : [];
  const panel = {
    ...base,
    name: shortText(input.name, 50) || "Panneau de tickets",
    channelId: String(input.channelId || "").trim(),
    categoryId: String(input.categoryId || "").trim(),
    layout: ["button", "buttons", "select"].includes(input.layout) ? input.layout : "button",
    title: shortText(input.title, 256),
    description: shortText(input.description, 3000),
    color: /^#[0-9a-f]{6}$/i.test(String(input.color || "")) ? String(input.color).toLowerCase() : "#e8510d",
    footerText: shortText(input.footerText, 2000),
    statusLine: shortText(input.statusLine, 200),
    buttonLabel: shortText(input.buttonLabel, 80) || "Ouvrir un ticket",
    buttonEmoji: shortText(input.buttonEmoji, 50),
    openRoleIds: Array.isArray(input.openRoleIds) ? [...new Set(input.openRoleIds.map(String))].slice(0, 20) : [],
    questions,
    openTitle: shortText(input.openTitle, 200),
    openDescription: shortText(input.openDescription, 1000),
    staffRoleIds: Array.isArray(input.staffRoleIds) ? [...new Set(input.staffRoleIds.map(String))].slice(0, 20) : [],
    claimEnabled: input.claimEnabled === true,
    logChannelId: String(input.logChannelId || "").trim(),
    transcriptsEnabled: input.transcriptsEnabled !== false,
    reasons,
    updatedAt: Date.now()
  };

  if (!panel.title) return { error: "Le titre du panneau est requis." };
  if (!reasons.length || reasons.some(reason => !reason.label)) return { error: "Ajoute au moins une raison de ticket avec un nom." };
  if (new Set(reasons.map(reason => reason.value)).size !== reasons.length) return { error: "Chaque raison doit avoir un identifiant unique." };
  if (panel.layout === "button" && reasons.length !== 1) return { error: "Le format « Bouton unique » demande exactement une raison." };
  if (questions.some(question => !question.label)) return { error: "Chaque question doit avoir un intitulé." };
  if (requirePublish && (!panel.channelId || (!panel.categoryId && reasons.some(reason => !reason.categoryId)))) {
    return { error: "Choisis le salon de publication et une catégorie pour chaque motif." };
  }

  if (guild) {
    const textIds = new Set(guild.channels.cache.filter(channel => channel.isTextBased() && [0, 5].includes(channel.type)).map(channel => channel.id));
    const categoryIds = new Set(guild.channels.cache.filter(channel => channel.type === 4).map(channel => channel.id));
    if (panel.channelId && !textIds.has(panel.channelId)) return { error: "Le salon de publication doit être un salon textuel de ce serveur." };
    if (panel.logChannelId && !textIds.has(panel.logChannelId)) return { error: "Le salon des logs doit être un salon textuel de ce serveur." };
    if (panel.categoryId && !categoryIds.has(panel.categoryId)) return { error: "La catégorie des tickets est introuvable sur ce serveur." };
    if (reasons.some(reason => reason.categoryId && !categoryIds.has(reason.categoryId))) return { error: "Une catégorie associée à un motif est introuvable sur ce serveur." };
    if (requirePublish && reasons.some(reason => !reason.categoryId && !panel.categoryId)) return { error: "Chaque motif doit utiliser une catégorie valide." };
    const roleIds = new Set(guild.roles.cache.filter(role => role.id !== guild.id).map(role => role.id));
    if (panel.openRoleIds.some(id => !roleIds.has(id)) || panel.staffRoleIds.some(id => !roleIds.has(id))) {
      return { error: "Un des rôles sélectionnés n’existe plus sur ce serveur." };
    }
  }
  return { panel };
}

function memberHasRole(member, roleIds) {
  const roles = member?.roles?.cache;
  return Array.isArray(roleIds) && roleIds.some(id => roles?.has(id));
}

function canOpenPanel(panel, member) {
  return !panel?.openRoleIds?.length || memberHasRole(member, panel.openRoleIds);
}

function canClaimPanel(member, panel) {
  return !!(member?.permissions?.has('ManageGuild')
    || member?.permissions?.has('ManageChannels')
    || memberHasRole(member, panel?.staffRoleIds));
}

module.exports = { createPanelId, defaultPanel, normalizePanel, canOpenPanel, canClaimPanel };
