const NAME_LOCALIZATIONS = {
  backup: ['backup', 'backup'],
  'config-ia': ['config-ia', 'ai-setup'],
  eco: ['eco', 'economy'],
  embed: ['embed', 'embed'],
  'pseudo-definir': ['pseudo-definir', 'set-nickname'],
  'pseudo-reinitialiser': ['pseudo-reinitialiser', 'reset-nickname'],
  annonce: ['annonce', 'announcement'],
  config: ['config', 'settings'],
  'config-panel': ['config-panel', 'settings-panel'],
  'bannissement-temporaire': ['bannissement-temporaire', 'temporary-ban'],
  'muet-temporaire': ['muet-temporaire', 'temporary-mute'],
  'muet-retirer': ['muet-retirer', 'unmute'],
  timeout: ['timeout', 'timeout'],
  untimeout: ['untimeout', 'untimeout'],
  'role-ajouter': ['role-ajouter', 'add-role'],
  'role-retirer': ['role-retirer', 'remove-role'],
  'avertissement-reinitialiser': ['avertissement-reinitialiser', 'clear-warnings'],
  anniversaire: ['anniversaire', 'birthday'],
  infractions: ['infractions', 'infractions'],
  'infraction-ajouter': ['infraction-ajouter', 'add-infraction'],
  'infractions-reinitialiser': ['infractions-reinitialiser', 'clear-infractions'],
  message: ['message', 'message'],
  premium: ['premium', 'premium'],
  invite: ['invite', 'invite'],
  'bot-infos': ['bot-infos', 'bot-info'],
  formulaire: ['formulaire', 'form'],
  'formulaire-modifier': ['formulaire-modifier', 'edit-form'],
  niveau: ['niveau', 'level'],
  classement: ['classement', 'leaderboard'],
  rappel: ['rappel', 'reminder'],
  rappels: ['rappels', 'reminders'],
  'rappel-retirer': ['rappel-retirer', 'remove-reminder'],
  'evenement-creer': ['evenement-creer', 'create-event'],
  evenements: ['evenements', 'events'],
  'evenement-retirer': ['evenement-retirer', 'remove-event'],
  planifier: ['planifier', 'schedule'],
  'planification-liste': ['planification-liste', 'scheduled-messages'],
  'planification-retirer': ['planification-retirer', 'remove-scheduled-message'],
  'purge-temp': ['purge-temp', 'temporary-purge'],
  'purge-temp-liste': ['purge-temp-liste', 'temporary-purge-list'],
  'purge-temp-retirer': ['purge-temp-retirer', 'remove-temporary-purge'],
  'roles-reaction': ['roles-reaction', 'reaction-roles'],
  sondage: ['sondage', 'poll'],
  'sondage-fermer': ['sondage-fermer', 'close-poll'],
  'sondage-liste': ['sondage-liste', 'poll-list'],
  concours: ['concours', 'giveaway'],
  'concours-liste': ['concours-liste', 'giveaway-list'],
  'concours-retirage': ['concours-retirage', 'giveaway-reroll'],
  'serveur-statistiques': ['serveur-statistiques', 'server-stats'],
  'membre-statistiques': ['membre-statistiques', 'member-stats'],
  verrouiller: ['verrouiller', 'lock'],
  deverrouiller: ['deverrouiller', 'unlock'],
  'verrouillage-total': ['verrouillage-total', 'lockdown'],
  'deverrouillage-total': ['deverrouillage-total', 'unlock-all'],
  'role-temporaire': ['role-temporaire', 'temporary-role'],
  'role-temporaire-liste': ['role-temporaire-liste', 'temporary-roles'],
  'role-temporaire-retirer': ['role-temporaire-retirer', 'remove-temporary-role'],
  suggestion: ['suggestion', 'suggestion'],
  'texte-vocal': ['texte-vocal', 'text-to-speech'],
  jeu: ['jeu', 'game'],
  avatar: ['avatar', 'avatar'],
  banniere: ['banniere', 'banner'],
  reputation: ['reputation', 'reputation'],
  lfg: ['lfg', 'lfg'],
  kick: ['kick', 'kick'],
  ban: ['ban', 'ban'],
  warn: ['warn', 'warn'],
  warninfos: ['warninfos', 'warning-info'],
  purge: ['purge', 'purge'],
  purgeuser: ['purgeuser', 'purge-user'],
  mute: ['mute', 'mute'],
  deletechannels: ['deletechannels', 'delete-channels'],
  'protect-settings': ['protect-settings', 'protect-settings'],
  report: ['report', 'report'],
  rp: ['rp', 'rp'],
  'serverstats-setup': ['serverstats-setup', 'serverstats-setup'],
  social: ['social', 'social'],
  'top-gg': ['top-gg', 'top-gg'],
  vote: ['vote', 'vote'],
  create: ['créer', 'create'],
  load: ['charger', 'load'],
  list: ['liste', 'list'],
  liste: ['liste', 'list'],
  delete: ['supprimer', 'delete'],
  info: ['info', 'info'],
  'porte-monnaie': ['porte-monnaie', 'wallet'],
  daily: ['daily', 'daily'],
  travailler: ['travailler', 'work'],
  pecher: ['pêcher', 'fish'],
  'pile-ou-face': ['pile-ou-face', 'coin-flip'],
  'machine-a-sous': ['machine-a-sous', 'slots'],
  blackjack: ['blackjack', 'blackjack'],
  donner: ['donner', 'pay'],
  deposer: ['déposer', 'deposit'],
  retirer: ['retirer', 'withdraw'],
  'ajouter-argent': ['ajouter-argent', 'add-money'],
  roue: ['roue', 'wheel'],
  collection: ['collection', 'collection'],
  vendre: ['vendre', 'sell'],
  echanger: ['échanger', 'trade'],
  modifier: ['modifier', 'edit'],
  creer: ['créer', 'create'],
  'créer': ['créer', 'create'],
  supprimer: ['supprimer', 'delete'],
  langue: ['langue', 'language'],
  ticket: ['ticket', 'ticket'],
  reglement: ['règlement', 'rules'],
  'reglement-edit': ['reglement-edit', 'rules-edit'],
  starboard: ['starboard', 'starboard'],
  'vocal-temp': ['vocal-temp', 'temporary-voice'],
  comptage: ['comptage', 'counting'],
  'comptage-stop': ['comptage-stop', 'stop-counting'],
  'comptage-stats': ['comptage-stats', 'counting-stats'],
  'comptage-reset': ['comptage-reset', 'reset-counting'],
  notifications: ['notifications', 'notifications'],
  ajouter: ['ajouter', 'add'],
  partenariat: ['partenariat', 'partnership'],
  'partenariat-liste': ['partenariat-liste', 'partnership-list'],
  'partenariat-statistiques': ['partenariat-statistiques', 'partnership-stats'],
  'partenariat-retirer': ['partenariat-retirer', 'remove-partner'],
  'partenariat-reinitialiser': ['partenariat-reinitialiser', 'reset-partnership'],
  'partenariat-auto': ['partenariat-auto', 'auto-partnership'],
  repondre: ['répondre', 'answer'],
  quiz: ['quiz', 'quiz'],
  pendu: ['pendu', 'hangman'],
  devine: ['devine', 'guess'],
  '8balls': ['8balls', '8balls'],
  stop: ['stop', 'stop'],
  'mots-salon': ['mots-salon', 'word-chain-channel'],
  'mots-stop': ['mots-stop', 'stop-word-chain'],
  'mots-reset': ['mots-reset', 'reset-word-chain'],
  annuler: ['annuler', 'cancel'],
  profil: ['profil', 'profile'],
  mariage: ['mariage', 'marriage'],
  proposer: ['proposer', 'propose'],
  divorcer: ['divorcer', 'divorce'],
  ami: ['ami', 'friend'],
  clan: ['clan', 'clan'],
  inviter: ['inviter', 'invite'],
  quitter: ['quitter', 'leave'],
  expulser: ['expulser', 'kick'],
  promouvoir: ['promouvoir', 'promote'],
  retrograder: ['rétrograder', 'demote'],
  transferer: ['transférer', 'transfer'],
  dissoudre: ['dissoudre', 'disband'],
  description: ['description', 'description'],
  ci: ['ci', 'id-card'],
  permis: ['permis', 'license'],
  passeport: ['passeport', 'passport'],
  voir: ['voir', 'view'],
  top: ['top', 'top']
};

const ENGLISH_DESCRIPTIONS = {
  '💾 Sauvegarder ou restaurer la structure du serveur (rôles, catégories, salons)': '💾 Back up or restore the server structure (roles, categories, channels)',
  '⭐ Premium • Créer une backup du serveur (rôles, salons, permissions)': '⭐ Premium • Back up server roles, channels, and permissions',
  '⭐ Premium • Charger une backup et l’appliquer à ce serveur': '⭐ Premium • Load a backup and apply it to this server',
  '⭐ Premium • Voir la liste de tes backups': '⭐ Premium • View your backups',
  '⭐ Premium • Supprimer une backup': '⭐ Premium • Delete a backup',
  '⭐ Premium • Voir les informations détaillées d’une backup': '⭐ Premium • View detailed backup information',
  '🤖 Crée la catégorie et le salon de l’assistant IA CoreLab': '🤖 Create the CoreLab AI assistant category and channel',
  'Système d’économie — argent, jeux et classement': 'Economy system — money, games, and leaderboard',
  'Voir votre porte-monnaie (ou celui d’un membre)': 'View your wallet (or another member’s)',
  'Récupérer votre récompense quotidienne': 'Claim your daily reward',
  'Travailler pour gagner de l’argent': 'Work to earn money',
  'Aller pêcher pour gagner de l’argent (ou rien du tout...)': 'Go fishing to earn money (or nothing at all...)',
  'Miser sur pile ou face, double ou rien': 'Bet on heads or tails: double or nothing',
  'Tenter sa chance à la machine à sous': 'Try your luck at the slot machine',
  'Jouer au blackjack contre le croupier': 'Play blackjack against the dealer',
  'Donner de l’argent à un membre': 'Give money to a member',
  'Déposer de l’argent de ton portefeuille vers ta banque': 'Deposit money from your wallet into your bank',
  'Retirer de l’argent de ta banque vers ton portefeuille': 'Withdraw money from your bank to your wallet',
  'Voir les membres les plus riches du serveur': 'View the richest members of the server',
  'Tourner la roue pour obtenir un objet, un lieu, une carte...': 'Spin the wheel to win an item, a place, a card...',
  'Voir votre collection (ou celle d\'un membre)': 'View your collection (or another member’s)',
  'Vendre un objet à la boutique ou à un membre': 'Sell an item to the shop or to a member',
  'Échanger un objet avec un membre': 'Trade an item with a member',
  '🔒 Admin • Ajouter de l’argent à un membre (sans limite)': '🔒 Admin • Add any amount of money to a member',
  '🔒 Admin • Ouvrir le panneau de configuration de l’économie': '🔒 Admin • Open the economy settings panel',
  'Créer et gérer des embeds personnalisés réutilisables': 'Create and manage reusable custom embeds',
  'Créer un nouvel embed personnalisé': 'Create a new custom embed',
  'Rouvrir le panneau d’édition d’un embed existant': 'Reopen the editor for an existing embed',
  'Supprimer un embed personnalisé': 'Delete a custom embed',
  'Lister les embeds personnalisés du serveur': 'List the server’s custom embeds',
  'Changer mon pseudo sur ce serveur': 'Change my nickname on this server',
  'Réinitialiser mon pseudo par défaut': 'Reset my nickname to its default',
  'Publier une annonce': 'Publish an announcement',
  'Ouvrir le panneau de configuration complet du serveur': 'Open the full server settings panel',
  'Définir le salon pour les annonces globales': 'Set the channel for global announcements',
  'Changer la langue du bot sur ce serveur': 'Change the bot language on this server',
  'Configurer les tickets ou publier le panneau': 'Set up tickets or publish the ticket panel',
  'Configurer le règlement du serveur': 'Configure the server rules',
  'Modifier le règlement déjà publié': 'Edit the already published rules',
  'Panneau de configuration du StarBoard': 'Open the Starboard settings panel',
  'Configurer les salons vocaux temporaires': 'Configure temporary voice channels',
  'Définir le salon du jeu de comptage et l’activer': 'Set the counting game channel and enable it',
  'Désactiver le jeu de comptage': 'Disable the counting game',
  'Voir le compte actuel et le record du serveur': 'View the current count and server record',
  'Remettre le compte à 0 (le record n’est pas touché)': 'Reset the count to 0 (the record is kept)',
  'Gérer les notifications YouTube, Twitch, Blog, Medal, TikTok': 'Manage YouTube, Twitch, blog, Medal, and TikTok notifications',
  '⭐ Premium • Suivre une chaîne YouTube, Twitch, un blog ou un profil Medal': '⭐ Premium • Follow a YouTube or Twitch channel, blog, or Medal profile',
  '⭐ Premium • Voir les notifications suivies': '⭐ Premium • View followed notifications',
  '⭐ Premium • Retirer une notification suivie': '⭐ Premium • Remove a followed notification',
  'Configurer le partenariat (titre, description, image, rôle)': 'Configure partnerships (title, description, image, role)',
  'Voir les partenaires enregistrés': 'View registered partners',
  'Voir les statistiques du partenariat': 'View partnership statistics',
  'Retirer un partenaire': 'Remove a partner',
  'Réinitialiser les statistiques à zéro': 'Reset statistics to zero',
  'Configurer la détection automatique de lien d’invitation': 'Configure automatic invite link detection',
  'Bannir temporairement un membre': 'Temporarily ban a member',
  'Rendre muet temporairement': 'Temporarily mute a member',
  'Rendre la parole à un membre': 'Unmute a member',
  'Mettre un membre en timeout': 'Timeout a member',
  'Retirer le timeout': 'Remove a member’s timeout',
  'Ajouter un rôle à un membre': 'Add a role to a member',
  'Retirer un rôle à un membre': 'Remove a role from a member',
  'Retirer tous les avertissements d’un membre': 'Clear all warnings from a member',
  'Enregistrer votre date d’anniversaire': 'Save your birthday',
  'Voir les infractions d’un membre': 'View a member’s infractions',
  'Ajouter une infraction à un membre': 'Add an infraction to a member',
  'Réinitialiser les infractions d’un membre': 'Reset a member’s infractions',
  'Envoyer un message dans un salon': 'Send a message in a channel',
  'Découvrez les avantages de CoreLab Premium 💎': 'Discover the benefits of CoreLab Premium 💎',
  '🚀 Invite CoreLab sur ton serveur': '🚀 Invite CoreLab to your server',
  '📋 Créer et gérer un formulaire réutilisable': '📋 Create and manage a reusable form',
  '🔒 Admin • Créer un nouveau formulaire': '🔒 Admin • Create a new form',
  '🔒 Admin • Voir les formulaires créés': '🔒 Admin • View created forms',
  '🔒 Admin • Supprimer un formulaire': '🔒 Admin • Delete a form',
  'Remplir un formulaire': 'Fill out a form',
  '📋 Rouvrir le panneau de gestion d’un formulaire existant': '📋 Reopen the management panel for an existing form',
  'Voir votre niveau et votre XP': 'View your level and XP',
  'Classement XP du serveur': 'Server XP leaderboard',
  'éfinir un rappel': 'Set a reminder',
  'Voir les rappels': 'View reminders',
  'Retirer un rappel': 'Remove a reminder',
  'Créer un événement': 'Create an event',
  'Voir les événements programmés': 'View scheduled events',
  'Retirer un événement': 'Remove an event',
  'Planifier un message automatique et récurrent à heure fixe': 'Schedule an automatic recurring message at a specific time',
  'Voir les messages planifiés': 'View scheduled messages',
  'Retirer un message planifié': 'Remove a scheduled message',
  'Supprimer automatiquement les messages après un délai': 'Automatically delete messages after a set time',
  'Voir les salons avec purge automatique': 'View channels with automatic message deletion',
  'Désactiver la purge automatique d’un salon': 'Disable automatic message deletion in a channel',
  'Gérer les rôles par bouton sur un message': 'Manage roles using buttons on a message',
  'Créer un sondage interactif': 'Create an interactive poll',
  'Clore un sondage': 'Close a poll',
  'Voir les sondages actifs': 'View active polls',
  'Lancer un giveaway': 'Start a giveaway',
  'Voir les giveaways actifs': 'View active giveaways',
  'Retirer au sort un nouveau gagnant': 'Draw a new giveaway winner',
  'Voir les statistiques du serveur': 'View server statistics',
  'Voir les statistiques d’un membre': 'View a member’s statistics',
  '🔒 Verrouiller un salon': '🔒 Lock a channel',
  '🔓 Déverrouiller un salon': '🔓 Unlock a channel',
  '🚨 Verrouiller TOUS les salons du serveur': '🚨 Lock ALL server channels',
  '✅ Déverrouiller TOUS les salons': '✅ Unlock ALL channels',
  'Attribuer un rôle temporaire à un membre': 'Assign a temporary role to a member',
  '📋 Voir les rôles temporaires actifs': '📋 View active temporary roles',
  '🗑️ Retirer manuellement un rôle temporaire': '🗑️ Manually remove a temporary role',
  'Soumettre une suggestion au staff 💡': 'Submit a suggestion to the staff 💡',
  'Convertir du texte en message vocal': 'Convert text to speech',
  '🎮 Mini-jeux : quiz, pendu, devine le nombre, 8balls, mots enchaînés': '🎮 Mini-games: quiz, hangman, guess the number, 8balls, and word chain',
  '🎱 Pose une question à la boule magique': '🎱 Ask the magic 8-ball a question',
  '🖼️ Afficher l\'avatar d\'un membre en grand': '🖼️ Show a member\'s avatar in full size',
  '🎨 Afficher la bannière d\'un membre en grand': '🎨 Show a member\'s banner in full size',
  '🌟 Réputation : remercie un membre (+1 rep) et consulte le classement': '🌟 Reputation: thank a member (+1 rep) and view the leaderboard',
  '🌟 Donner +1 de réputation à un membre (1 fois par jour)': '🌟 Give a member +1 reputation (once per day)',
  '👤 Voir la réputation d\'un membre': '👤 View a member\'s reputation',
  '🏆 Classement de la réputation du serveur': '🏆 Server reputation leaderboard',
  '🧠 Quiz à boutons : questions aléatoires générées par l’IA': '🧠 Button-based quiz with AI-generated random questions',
  '🪢 Pendu collaboratif : tout le salon joue ensemble': '🪢 Collaborative hangman: the whole channel plays together',
  '🔢 Devine le nombre mystérieux (⬆️ plus grand / ⬇️ plus petit)': '🔢 Guess the mystery number (⬆️ higher / ⬇️ lower)',
  '🛑 Arrêter le jeu en cours dans ce salon': '🛑 Stop the current game in this channel',
  '🏆 Voir le classement d’un jeu': '🏆 View a game leaderboard',
  '🔗 Admin • Activer les mots enchaînés dans un salon': '🔗 Admin • Enable word chain in a channel',
  '🔗 Admin • Désactiver les mots enchaînés': '🔗 Admin • Disable word chain',
  '🔗 Admin • Remettre la chaîne à zéro (le record est conservé)': '🔗 Admin • Reset the chain (the record is kept)',
  '🎮 Recherche de joueurs : trouve une équipe en 2 clics': '🎮 Looking for players: find a team in two clicks',
  '📣 Publier une annonce de recherche de joueurs': '📣 Post a looking-for-players announcement',
  '📋 Voir les annonces ouvertes': '📋 View open announcements',
  '🔒 Fermer toutes tes annonces ouvertes': '🔒 Close all your open announcements',
  '⚙️ Admin • Salon des annonces et rôle à pinger': '⚙️ Admin • Set the announcement channel and role to ping',
  'Expulser un membre': 'Kick a member',
  'Bannir un membre': 'Ban a member',
  'Avertir un membre': 'Warn a member',
  'Voir les avertissements d’un membre': 'View a member’s warnings',
  'Supprimer des messages': 'Delete messages',
  'Supprimer les messages d’un utilisateur': 'Delete a user’s messages',
  'Rendre muet un membre (sans limite de durée)': 'Mute a member indefinitely',
  'Supprimer un salon ou une catégorie entière': 'Delete a channel or an entire category',
  '🛡️ Panneau de configuration du système de protection': '🛡️ Open the protection system settings panel',
  '🚩 Signaler un membre au staff': '🚩 Report a member to the staff',
  '🪪 Roleplay : profil, carte d’identité, permis, passeport': '🪪 Roleplay: profile, ID card, driver’s license, and passport',
  'Créer ton profil RP': 'Create your roleplay profile',
  'Voir un profil RP': 'View a roleplay profile',
  'Supprimer ton profil RP': 'Delete your roleplay profile',
  'Carte nationale d’identité': 'National ID card',
  'Afficher la carte d’identité': 'Show the ID card',
  'Permis de conduire': 'Driver’s license',
  'Afficher le permis': 'Show the driver’s license',
  'Ajouter une catégorie à ton permis': 'Add a category to your license',
  'Retirer une catégorie de ton permis': 'Remove a category from your license',
  'Passeport': 'Passport',
  'Afficher le passeport': 'Show the passport',
  '📊 Configure des salons vocaux affichant les statistiques du serveur (comme le bot ServerStats)': '📊 Set up voice channels that display server statistics (like the ServerStats bot)',
  '💞 Mariage, amis et clans': '💞 Marriage, friends, and clans',
  '👤 Voir un profil social (mariage, amis, clan, jeux)': '👤 View a social profile (marriage, friends, clan, games)',
  '💍 Mariage': '💍 Marriage',
  '💍 Demander quelqu’un en mariage': '💍 Propose to someone',
  '💔 Divorcer de ton conjoint': '💔 Divorce your spouse',
  '🤝 Liste d’amis': '🤝 Friends list',
  '🤝 Envoyer une demande d’ami': '🤝 Send a friend request',
  '🚫 Retirer un ami': '🚫 Remove a friend',
  '📋 Voir une liste d’amis': '📋 View your friends list',
  '🛡️ Clans': '🛡️ Clans',
  '🛡️ Créer ton clan (coûte des 💠 si l’économie est active)': '🛡️ Create your clan (costs 💠 when the economy is enabled)',
  'ℹ️ Voir un clan (le tien par défaut)': 'ℹ️ View a clan (yours by default)',
  '🏆 Classement des clans': '🏆 Clan leaderboard',
  '📨 Inviter un membre dans ton clan': '📨 Invite a member to your clan',
  '👋 Quitter ton clan': '👋 Leave your clan',
  '🚪 Expulser un membre du clan': '🚪 Kick a member from the clan',
  '🛡️ Nommer un membre officier (chef uniquement)': '🛡️ Promote a member to officer (leader only)',
  '⬇️ Retirer le grade d’officier (chef uniquement)': '⬇️ Remove an officer’s rank (leader only)',
  '👑 Donner la direction du clan à un autre membre': '👑 Transfer clan leadership to another member',
  '💥 Dissoudre le clan (chef uniquement)': '💥 Disband the clan (leader only)',
  '💰 Déposer des 💠 dans la banque du clan': '💰 Deposit 💠 into the clan bank',
  '💸 Retirer des 💠 de la banque (chef uniquement)': '💸 Withdraw 💠 from the bank (leader only)',
  '📝 Changer la description du clan': '📝 Change the clan description',
  'Ajouter un bouton de rôle à un message': 'Add a role button to a message',
  'Retirer un bouton de rôle': 'Remove a role button',
  'Voir les boutons de rôle configurés': 'View configured role buttons',
  '🗳️ Vote pour CoreLab sur top.gg': '🗳️ Vote for CoreLab on top.gg',
  '🤖 Affiche les informations de CoreLab': '🤖 Show CoreLab information',
  'Créer un sondage à choix multiples avec boutons': 'Create a multiple-choice poll with buttons',
  '🎨 Personnaliser la couleur de toutes les cartes du serveur': '🎨 Customize the color of all server cards',
  '⚔️ Combats de cartes Pokémon en duel contre un membre': '⚔️ Pokémon card duels against another member',
  '⚔️ Défier un membre avec ta collection de cartes': '⚔️ Challenge a member with your card collection',
  '📊 Voir les statistiques de combat d\'un membre': '📊 View a member\'s battle statistics',
  '🏆 Classement des meilleurs combattants du serveur': '🏆 Leaderboard of the server\'s best fighters',
  '📖 Comment fonctionnent les combats de cartes': '📖 How card battles work',
  '🔒 Admin • Configurer les wallets crypto et publier le panneau': '🔒 Admin • Configure crypto wallets and publish the panel',
  'Créer et gérer des événements': 'Create and manage events',
  'Créer un événement (annonce + inscriptions + rappels)': 'Create an event (announcement + sign-ups + reminders)',
  'Voir les événements à venir': 'View upcoming events',
  'Annuler un événement': 'Cancel an event',
  'Liste des membres Premium (propriétaire)': 'List of Premium members (owner only)',
  '🏪 Marché & enchères de cartes Pokémon entre membres': '🏪 Pokémon card market & auctions between members',
  '🏷️ Mettre une carte en vente à prix fixe (7 jours)': '🏷️ List a card for sale at a fixed price (7 days)',
  '🔨 Mettre une carte aux enchères': '🔨 Put a card up for auction',
  '📜 Voir les annonces en cours': '📜 View active listings',
  '🛒 Acheter une annonce à prix fixe': '🛒 Buy a fixed-price listing',
  '💰 Placer une enchère': '💰 Place a bid',
  '🚫 Retirer une de tes annonces (la carte te revient)': '🚫 Remove one of your listings (the card returns to you)',
  '📦 Voir tes annonces et les enchères où tu es en tête': '📦 View your listings and the auctions you are leading',
  '🎡 Tourner la roue pour obtenir un objet, un lieu, une carte...': '🎡 Spin the wheel to win an item, a place, a card...',
  '📢 Envoie la pub CoreLab dans ce salon (propriétaire uniquement)': '📢 Send the CoreLab promo in this channel (owner only)',
  'Choisir les rôles à supprimer': 'Choose the roles to delete',
  'Configurer les salons de statistiques du serveur (membres, en ligne, boosts...)': 'Set up server statistics channels (members, online, boosts...)'
};

function normalizeText(value) {
  return value.replace(/[’‘]/g, "'");
}

const ENGLISH_DESCRIPTIONS_NORMALIZED = new Map(
  Object.entries(ENGLISH_DESCRIPTIONS).map(([source, translation]) => [normalizeText(source), translation])
);

// ─────────────────────────────────────────────────────────────────────
// Noms anglais « réels » des commandes slash
// ─────────────────────────────────────────────────────────────────────
// Le code du bot (client.commands, getSubcommand(), handlers...) continue
// de travailler avec les noms INTERNES (souvent en français).
//   • À l'enregistrement auprès de Discord : chaque commande / sous-commande /
//     groupe est enregistré sous son nom ANGLAIS (localizeCommandMetadata).
//   • À la réception d'une interaction : normalizeCommandInteraction() remet
//     les noms internes, pour que les handlers n'aient rien à changer.
// Pour renommer une commande : modifier NAME_LOCALIZATIONS (nom seul) ou
// PATH_NAME_OVERRIDES (nom qui dépend de l'endroit où il est utilisé).

// Clé = chemin interne complet (« parent/enfant »). Prioritaire sur NAME_LOCALIZATIONS.
const PATH_NAME_OVERRIDES = {
  marche: 'market',
  'marche/enchere': 'auction',
  'marche/acheter': 'buy',
  'marche/encherir': 'bid',
  'marche/mes-annonces': 'my-listings',
  'cartes-style': 'card-style',
  pub: 'promo',
  // « retirer » = withdraw par défaut (économie, banque de clan) mais « remove » ici :
  'config/notifications/retirer': 'remove',
  'roles-reaction/retirer': 'remove',
  'social/ami/retirer': 'remove',
  'rp/permis/retirer': 'remove',
  'reputation/donner': 'give'
};

function englishName(pathParts) {
  const override = PATH_NAME_OVERRIDES[pathParts.join('/')];
  if (override) return override;
  const last = pathParts[pathParts.length - 1];
  return NAME_LOCALIZATIONS[last]?.[1] || last;
}

// nom anglais → { name: nom interne, children: Map(nom anglais → …) }
const REVERSE_NAMES = new Map();

function localizeCommandMetadata(commands) {
  REVERSE_NAMES.clear();

  function localize(node, parents, siblings) {
    const internal = node.name;
    const path = [...parents, internal];
    let english = englishName(path);
    if (siblings.has(english)) {
      console.error(`[Commandes] Conflit de nom anglais « ${english} » pour /${path.join(' ')} — nom interne conservé.`);
      english = internal;
    }
    const entry = { name: internal, children: new Map() };
    siblings.set(english, entry);

    const description = node.description;
    const englishDescription = ENGLISH_DESCRIPTIONS_NORMALIZED.get(normalizeText(description));
    node.name = english;
    delete node.name_localizations;
    if (englishDescription) node.description = englishDescription;
    node.description_localizations = { fr: description };

    for (const option of node.options || []) {
      if (option.type === 1 || option.type === 2) localize(option, path, entry.children);
    }
  }

  for (const command of commands) localize(command, [], REVERSE_NAMES);
  return commands;
}

// Remet les noms internes sur une interaction slash / autocomplétion reçue de Discord.
function normalizeCommandInteraction(interaction) {
  if (!interaction || interaction.__commandNamesNormalized) return interaction;
  const root = REVERSE_NAMES.get(interaction.commandName);
  if (!root) return interaction;
  interaction.__commandNamesNormalized = true;

  const options = interaction.options;
  let node = root;
  if (options && typeof options._group === 'string') {
    const group = node.children.get(options._group);
    if (group) { options._group = group.name; node = group; }
  }
  if (options && typeof options._subcommand === 'string') {
    const sub = node.children.get(options._subcommand);
    if (sub) options._subcommand = sub.name;
  }
  interaction.commandName = root.name;
  return interaction;
}

// Nom affiché (anglais) d'une commande de premier niveau à partir de son nom interne.
function displayCommandName(internalName) {
  return englishName([internalName]);
}

module.exports = { localizeCommandMetadata, normalizeCommandInteraction, displayCommandName, englishName, NAME_LOCALIZATIONS, PATH_NAME_OVERRIDES };