// ===== Quest Zone — Guidebook content =====
// Data-driven on purpose: to add a new article later, just push a new
// object into GUIDEBOOK_DATA.entries (and a new category into
// GUIDEBOOK_DATA.categories if needed). Nothing in guidebook.html needs
// to change — the page renders and indexes whatever is in here.
//
// Entry shape:
//   id        — unique slug, used for the #anchor and scroll-to target
//   category  — must match a categories[].id
//   icon      — emoji shown on the collapsed panel
//   title     — panel title
//   summary   — one line, shown when collapsed
//   content   — array of blocks: {type:'p'|'ul'|'ol'|'example', text|items}
//   keywords  — direct terms this article should match
//   synonyms  — related/loose terms a player might search instead

window.GUIDEBOOK_DATA = {
  categories: [
    { id: 'getting-started', title: 'Getting Started', icon: '🚀' },
    { id: 'your-account', title: 'Your Account', icon: '👤' },
    { id: 'progression', title: 'Progression', icon: '⚡' },
    { id: 'achievements-rewards', title: 'Achievements & Rewards', icon: '🏆' },
    { id: 'avatar-equipment', title: 'Avatar & Equipment', icon: '🎽' },
    { id: 'playing-games', title: 'Playing Games', icon: '🎮' }
  ],

  entries: [
    // ---------------- GETTING STARTED ----------------
    {
      id: 'home-page',
      category: 'getting-started',
      icon: '🏠',
      title: 'Home Page',
      summary: 'The main Quest Zone hub — browse games, search, and jump into your Profile.',
      content: [
        { type: 'p', text: 'The Home Page is the main Quest Zone hub.' },
        { type: 'p', text: 'From the Home Page, players can:' },
        { type: 'ul', items: [
          'browse Total Level Games',
          'browse Arcade Games',
          'search for games',
          'open their Profile',
          'access the Guidebook',
          'use the main site navigation'
        ]},
        { type: 'p', text: 'Players click a game card to launch that game.' }
      ],
      keywords: ['home', 'homepage', 'main page', 'hub', 'landing page'],
      synonyms: ['start', 'main menu', 'front page']
    },
    {
      id: 'creating-an-account',
      category: 'getting-started',
      icon: '🆕',
      title: 'Creating an Account',
      summary: 'An account saves your progression — levels, achievements, Quest Points, and more.',
      content: [
        { type: 'p', text: 'Creating a Quest Zone account allows players to save their progression.' },
        { type: 'p', text: 'An account will allow players to keep things such as:' },
        { type: 'ul', items: [
          'game levels',
          'Total Level',
          'achievements',
          'Quest Points',
          'cosmetics',
          'inventory',
          'avatar appearance',
          'leaderboard progress'
        ]},
        { type: 'p', text: 'Players choose a username when creating their account.' },
        { type: 'p', text: 'The exact signup steps and requirements may change as this system is rolled out — this guide will be updated to match.' }
      ],
      keywords: ['create account', 'sign up', 'signup', 'register', 'new account'],
      synonyms: ['join', 'registration', 'make an account']
    },
    {
      id: 'logging-in',
      category: 'getting-started',
      icon: '🔑',
      title: 'Logging In',
      summary: 'Log in to load your saved progression, avatar, and Quest Points.',
      content: [
        { type: 'p', text: 'Logging in gives the player access to their saved Quest Zone account.' },
        { type: 'p', text: 'After logging in, their:' },
        { type: 'ul', items: [
          'progression',
          'avatar',
          'achievements',
          'inventory',
          'Quest Points',
          'game levels'
        ]},
        { type: 'p', text: 'can be loaded from their account.' }
      ],
      keywords: ['log in', 'login', 'sign in', 'signin', 'access account'],
      synonyms: ['authenticate', 'get in']
    },

    // ---------------- YOUR ACCOUNT ----------------
    {
      id: 'your-profile',
      category: 'your-account',
      icon: '🪪',
      title: 'Your Profile',
      summary: 'The main hub for your account — avatar, Quest Points, achievements, and more.',
      content: [
        { type: 'p', text: "The Profile is the main hub for the player's Quest Zone account." },
        { type: 'p', text: 'The Profile page contains:' },
        { type: 'ul', items: [
          'Avatar',
          'Username',
          'Quest Points',
          'Pinned Achievements',
          'Skills',
          'Inventory',
          'Achievements'
        ]},
        { type: 'p', text: 'Each section can be opened to view more information.' }
      ],
      keywords: ['profile', 'account page', 'dashboard'],
      synonyms: ['my page', 'account overview']
    },
    {
      id: 'username',
      category: 'your-account',
      icon: '🔖',
      title: 'Username',
      summary: 'Your player name, shown across your Profile, leaderboards, and achievements.',
      content: [
        { type: 'p', text: 'Your username is your Quest Zone player name.' },
        { type: 'p', text: 'It represents you across the website.' },
        { type: 'p', text: 'Your username may be visible on:' },
        { type: 'ul', items: [
          'your Profile',
          'leaderboards',
          'rankings',
          'achievements',
          'other public areas of Quest Zone'
        ]}
      ],
      keywords: ['username', 'name', 'player name', 'account name'],
      synonyms: ['gamertag', 'handle', 'display name', 'nickname']
    },
    {
      id: 'your-avatar',
      category: 'your-account',
      icon: '🧑‍🚀',
      title: 'Your Avatar',
      summary: 'Your Quest Zone character — updates with whatever equipment you have on.',
      content: [
        { type: 'p', text: "The Avatar represents the player's Quest Zone character." },
        { type: 'p', text: 'The Avatar:' },
        { type: 'ul', items: [
          'appears on the Profile page',
          'wears cosmetics and equipment',
          'updates when equipment changes',
          'can be customized using owned items'
        ]},
        { type: 'p', text: 'The Avatar should visually reflect what the player currently has equipped.' }
      ],
      keywords: ['avatar', 'character', 'figure', 'appearance'],
      synonyms: ['my character', 'player model']
    },

    // ---------------- PROGRESSION ----------------
    {
      id: 'skills',
      category: 'progression',
      icon: '📊',
      title: 'Skills',
      summary: "Your levels in each Total Level Game — from Level 1 up to Level 99.",
      content: [
        { type: 'p', text: "The Skills tab shows the player's levels in the official Total Level Games." },
        { type: 'p', text: 'There are 24 Total Level Games. Each game:' },
        { type: 'ul', items: [
          'has its own level',
          'runs from Level 1 to Level 99',
          'gives XP when played',
          'appears as a Skill',
          'contributes to Total Level'
        ]},
        { type: 'example', text: 'If Space Snake is Level 20, the Skills tab should display: Space Snake — Level 20 / 99' }
      ],
      keywords: ['skills', 'skill', 'level', 'leveling', 'xp', 'rank'],
      synonyms: ['experience', 'grinding', 'skill levels']
    },
    {
      id: 'total-level',
      category: 'progression',
      icon: '📈',
      title: 'Total Level',
      summary: 'The combined total of your levels across every Total Level Game.',
      content: [
        { type: 'p', text: "Total Level is the combined total of the player's levels across all Total Level Games." },
        { type: 'example', text: 'Space Snake = Level 30, Game 2 = Level 21, Game 3 = Level 7 → Total Level = 58' },
        { type: 'p', text: 'Total Level gives an overall indication of how much progression the player has achieved across Quest Zone.' }
      ],
      keywords: ['total level', 'combined level', 'overall level', 'xp', 'level', 'rank'],
      synonyms: ['grand total', 'progression score']
    },
    {
      id: 'total-level-games',
      category: 'progression',
      icon: '🎮',
      title: 'Total Level Games',
      summary: "Quest Zone's 24 official progression games, each with Levels 1–99.",
      content: [
        { type: 'p', text: 'Quest Zone has 24 official Total Level Games. These are the main progression games.' },
        { type: 'p', text: 'Total Level Games:' },
        { type: 'ul', items: [
          'award XP',
          'have Levels 1–99',
          'appear in the Skills tab',
          'contribute to Total Level',
          'use balanced XP/progression systems',
          'can have achievements',
          'can reward Quest Points',
          'can reward cosmetics or other unlocks'
        ]},
        { type: 'p', text: 'Space Snake is an example of a Total Level Game.' }
      ],
      keywords: ['total level games', 'official games', 'main games', 'xp', 'level', 'progression'],
      synonyms: ['core games', 'skill games']
    },
    {
      id: 'arcade-games',
      category: 'progression',
      icon: '🕹️',
      title: 'Arcade Games',
      summary: "Extra games for fun — they don't affect Total Level, but can still reward you.",
      content: [
        { type: 'p', text: 'Arcade Games are extra games that exist mainly for fun.' },
        { type: 'p', text: 'Arcade Games:' },
        { type: 'ul', items: [
          'do not appear in the Skills tab',
          'do not increase Total Level',
          'do not require the same XP balancing as Total Level Games'
        ]},
        { type: 'p', text: 'They can still:' },
        { type: 'ul', items: [
          'have achievements',
          'have high scores',
          'have leaderboards',
          'unlock cosmetics',
          'reward Quest Points',
          'contain special challenges'
        ]},
        { type: 'p', text: 'This allows Quest Zone to keep adding fun games without affecting the main Total Level progression system.' }
      ],
      keywords: ['arcade games', 'arcade', 'extra games', 'fun games', 'mini games'],
      synonyms: ['side games', 'bonus games']
    },

    // ---------------- ACHIEVEMENTS & REWARDS ----------------
    {
      id: 'achievements',
      category: 'achievements-rewards',
      icon: '🏆',
      title: 'Achievements',
      summary: 'Challenges and milestones you can complete across Quest Zone.',
      content: [
        { type: 'p', text: 'Achievements are challenges and milestones players can complete throughout Quest Zone.' },
        { type: 'p', text: 'Achievements can be earned through things such as:' },
        { type: 'ul', items: [
          'reaching levels',
          'achieving high scores',
          'completing challenges',
          'playing certain games',
          'completing special tasks',
          'reaching overall account milestones'
        ]},
        { type: 'p', text: 'In the Achievements page:' },
        { type: 'ul', items: [
          'locked achievements appear grayed out',
          'unlocked achievements appear in full color'
        ]},
        { type: 'p', text: "The color/style of an unlocked achievement represents its current achievement tier." }
      ],
      keywords: ['achievements', 'trophy', 'badge', 'challenge', 'milestone'],
      synonyms: ['medals', 'awards', 'unlocks']
    },
    {
      id: 'achievement-tiers',
      category: 'achievements-rewards',
      icon: '🎖️',
      title: 'Achievement Tiers',
      summary: 'Bronze → Silver → Gold → Platinum → Diamond → Mythic.',
      content: [
        { type: 'p', text: 'Achievements can progress through six tiers, in this order:' },
        { type: 'ol', items: ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Mythic'] },
        { type: 'ul', items: [
          'Bronze is the lowest tier.',
          'Mythic is the highest tier.',
          'Some achievements can progress through multiple tiers.',
          'Harder milestones move the achievement into higher tiers.',
          'The badge appearance changes depending on the highest tier reached.'
        ]},
        { type: 'example', text: 'A player might first earn Bronze for an achievement, then later improve it to Silver, Gold, Platinum, Diamond and eventually Mythic.' },
        { type: 'p', text: 'Mythic is the most prestigious tier in Quest Zone.' }
      ],
      keywords: ['achievement tiers', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'mythic', 'tier', 'rank'],
      synonyms: ['badge levels', 'prestige', 'grade']
    },
    {
      id: 'pinned-achievements',
      category: 'achievements-rewards',
      icon: '📌',
      title: 'Pinned Achievements',
      summary: 'The achievements you choose to show off on your Profile.',
      content: [
        { type: 'p', text: 'Pinned Achievements are achievements the player has chosen to display prominently on their Profile.' },
        { type: 'p', text: 'They are used to show off accomplishments the player is especially proud of.' },
        { type: 'p', text: 'Pinned Achievements:' },
        { type: 'ul', items: [
          'appear on the Profile page',
          'can be changed by the player',
          'link back to the Achievements section'
        ]},
        { type: 'p', text: 'Clicking the Pinned Achievements area opens the Achievements page.' }
      ],
      keywords: ['pinned achievements', 'pinned', 'favorite achievements', 'showcase'],
      synonyms: ['featured achievements', 'highlighted']
    },
    {
      id: 'quest-points',
      category: 'achievements-rewards',
      icon: '🔷',
      title: 'Quest Points',
      summary: "Quest Zone's reward currency, earned by playing and unlocking achievements.",
      content: [
        { type: 'p', text: 'Quest Points are a Quest Zone reward/currency system.' },
        { type: 'p', text: 'Players can earn Quest Points through activities such as:' },
        { type: 'ul', items: [
          'playing games',
          'completing achievements',
          'reaching milestones',
          'special challenges',
          'future events or rewards'
        ]},
        { type: 'p', text: 'Quest Points can later be used for things such as:' },
        { type: 'ul', items: [
          'cosmetics',
          'avatar items',
          'special rewards',
          'shop content'
        ]},
        { type: 'p', text: 'More uses for Quest Points may be added over time.' }
      ],
      keywords: ['quest points', 'points', 'currency', 'money', 'coins', 'gold', 'shop', 'reward'],
      synonyms: ['cash', 'credits', 'balance']
    },

    // ---------------- AVATAR & EQUIPMENT ----------------
    {
      id: 'inventory',
      category: 'avatar-equipment',
      icon: '🎒',
      title: 'Inventory',
      summary: 'Every piece of equipment and cosmetic item you own.',
      content: [
        { type: 'p', text: 'The Inventory contains all equipment and cosmetics the player owns.' },
        { type: 'p', text: 'Items may come from:' },
        { type: 'ul', items: [
          'achievements',
          'game rewards',
          'Quest Points',
          'events',
          'purchases',
          'special unlocks'
        ]},
        { type: 'p', text: 'Possible equipment categories include:' },
        { type: 'ul', items: [
          'Head', 'Necklace', 'Body', 'Legs', 'Boots',
          'Gloves', 'Back', 'Main Hand', 'Off Hand', 'Accessory'
        ]},
        { type: 'p', text: "Items stay in the player's Inventory unless equipped." }
      ],
      keywords: ['inventory', 'items', 'equipment', 'cosmetics', 'gear'],
      synonyms: ['clothes', 'outfit', 'armor', 'wear', 'equip', 'bag', 'storage']
    },
    {
      id: 'armory-equipment',
      category: 'avatar-equipment',
      icon: '🛡️',
      title: 'Armory & Equipment',
      summary: "Manage what your Avatar is wearing — equip, unequip, and change your outfit.",
      content: [
        { type: 'p', text: "The Armory is where the player manages what their Avatar is wearing." },
        { type: 'p', text: 'The player can access the Armory from their Profile/Avatar area.' },
        { type: 'p', text: 'Inside the Armory the player can:' },
        { type: 'ul', items: [
          'view equipped equipment',
          'browse owned items',
          'equip items',
          'unequip items',
          'change their outfit'
        ]},
        { type: 'p', text: 'When an item is equipped:' },
        { type: 'ul', items: [
          'it appears on the Avatar',
          'it appears in the relevant equipped slot'
        ]},
        { type: 'p', text: 'When an item is unequipped:' },
        { type: 'ul', items: [
          'it is removed from the Avatar',
          'it returns to the Inventory'
        ]},
        { type: 'p', text: 'The Avatar updates immediately whenever equipment changes.' }
      ],
      keywords: ['armory', 'equipment', 'equip', 'unequip', 'outfit', 'gear'],
      synonyms: ['armor', 'clothes', 'wear', 'dress up', 'loadout']
    },
    {
      id: 'cosmetics',
      category: 'avatar-equipment',
      icon: '🎨',
      title: 'Cosmetics',
      summary: 'Visual items that change how your Avatar looks.',
      content: [
        { type: 'p', text: "Cosmetics change the appearance of the player's Avatar." },
        { type: 'p', text: 'Cosmetics may include things such as:' },
        { type: 'ul', items: [
          'helmets', 'hats', 'clothing', 'armor', 'boots',
          'gloves', 'necklaces', 'backpacks', 'capes/back items',
          'weapons', 'accessories'
        ]},
        { type: 'p', text: 'Cosmetics may be earned from:' },
        { type: 'ul', items: [
          'achievements', 'games', 'challenges', 'events',
          'Quest Points', 'purchases where applicable'
        ]},
        { type: 'p', text: 'Cosmetics are mainly visual and do not necessarily affect gameplay.' }
      ],
      keywords: ['cosmetics', 'skins', 'outfits', 'wardrobe', 'appearance'],
      synonyms: ['clothes', 'gear', 'style', 'look']
    },

    // ---------------- PLAYING GAMES ----------------
    {
      id: 'game-controls',
      category: 'playing-games',
      icon: '⌨️',
      title: 'Game Controls',
      summary: 'Every game shows its own controls on its game page.',
      content: [
        { type: 'p', text: 'Each Quest Zone game may use different controls.' },
        { type: 'p', text: 'Examples can include:' },
        { type: 'ul', items: [
          'Arrow Keys',
          'WASD',
          'Space',
          'mouse',
          'game-specific controls'
        ]},
        { type: 'p', text: 'Each game clearly shows its own controls on its game page.' }
      ],
      keywords: ['controls', 'keys', 'keyboard', 'buttons', 'how to play'],
      synonyms: ['keybinds', 'input']
    },
    {
      id: 'leaderboards',
      category: 'playing-games',
      icon: '🏅',
      title: 'Leaderboards',
      summary: 'Compare your progress with other players — ranked by username.',
      content: [
        { type: 'p', text: 'Leaderboards allow players to compare their progress with other players.' },
        { type: 'p', text: 'Possible leaderboard categories can include:' },
        { type: 'ul', items: [
          'game high scores',
          'Total Level',
          'individual Total Level Game levels',
          'achievement progress',
          'other rankings added later'
        ]},
        { type: 'p', text: "The player's username is what appears on public leaderboard rankings." }
      ],
      keywords: ['leaderboard', 'leaderboards', 'rankings', 'high score', 'scoreboard'],
      synonyms: ['top players', 'standings']
    }
  ]
};
