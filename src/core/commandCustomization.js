"use strict";

const { obtenirConfigGuilde, persister } = require("./config");
const { englishName } = require("./commandLocalizations");

function settingsOf(guildId) {
  const value = obtenirConfigGuilde(guildId).command_settings;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function commandPaths(commands, parents = [], result = []) {
  for (const command of commands) {
    const path = [...parents, command.name];
    result.push({
      path: path.join("/"),
      name: englishName(path),
      description: String(command.description || ""),
      type: command.type === 2 ? "group" : command.type === 1 ? "subcommand" : "command"
    });
    const children = (command.options || []).filter(option => option.type === 1 || option.type === 2);
    if (children.length) commandPaths(children, path, result);
  }
  return result;
}

function definitions(client) {
  return commandPaths([...client.commands.values()].map(command => command.data.toJSON()));
}

function listCommands(client, guildId) {
  const settings = settingsOf(guildId);
  const all = definitions(client);
  const slash = all.map(command => {
    const parts = command.path.split("/");
    const enabled = parts.every((_, index) => settings[parts.slice(0, index + 1).join("/")] !== false);
    const hasChildren = all.some(other => other.path.startsWith(`${command.path}/`));
    return { ...command, enabled, canToggle: !hasChildren };
  });
  const prefix = require("./guildPrefix").get(guildId);
  const textCommands = Object.keys(client.prefixCommands || {}).sort().map(name => ({
    path: `prefix:${name}`,
    name: `${prefix}${name}`,
    description: "Commande textuelle",
    type: "prefix",
    enabled: settings[`prefix:${name}`] !== false,
    canToggle: true
  }));
  return [...slash, ...textCommands];
}

function validateSettings(client, settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "Réglages de commandes invalides.";
  }
  const all = definitions(client);
  const validPaths = new Set(all.filter(command =>
    !all.some(other => other.path.startsWith(`${command.path}/`))
  ).map(command => command.path));
  for (const name of Object.keys(client.prefixCommands || {})) validPaths.add(`prefix:${name}`);
  for (const [path, enabled] of Object.entries(settings)) {
    if (!validPaths.has(path)) return `Commande inconnue : ${path}.`;
    if (typeof enabled !== "boolean") return `État invalide pour ${path}.`;
  }
  return null;
}

function saveSettings(guildId, settings) {
  const config = obtenirConfigGuilde(guildId);
  config.command_settings = {};
  for (const [path, enabled] of Object.entries(settings)) {
    if (enabled === false) config.command_settings[path] = false;
  }
  persister("configuration");
}

function isEnabled(interaction) {
  if (!interaction?.guildId) return true;
  const parts = [interaction.commandName];
  const options = interaction.options;
  if (options) {
    const group = options.getSubcommandGroup(false);
    if (group) parts.push(group);
    const subcommand = options.getSubcommand(false);
    if (subcommand) parts.push(subcommand);
  }
  const settings = settingsOf(interaction.guildId);
  return parts.every((_, index) => settings[parts.slice(0, index + 1).join("/")] !== false);
}

function isPrefixEnabled(guildId, name) {
  return settingsOf(guildId)[`prefix:${name}`] !== false;
}

module.exports = {
  listCommands,
  validateSettings,
  saveSettings,
  isEnabled,
  isPrefixEnabled
};
