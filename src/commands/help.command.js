const { sendHelpPanel } = require('../handlers/help');

const prefixCommands = {
  help: async (message, client) => sendHelpPanel(message, client),
  aide: async (message, client) => sendHelpPanel(message, client),
};

module.exports = { commands: [], prefixCommands };
