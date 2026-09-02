// ===== Quest Zone — demo inventory data =====
//
// Temporary local dataset standing in for real account data
// (profile.inventory / profile.equippedItems) until accounts/Supabase
// are wired up. Slot keys match the avatar viewer's equipment-anchor
// names, so this same shape is what a real backend would eventually
// hand to setAvatarEquipment().
//
//   window.QZ_EQUIPMENT_SLOTS  — the 10 canonical slots, in display order
//   window.QZ_INVENTORY        — every item the (demo) player owns
//   window.QZ_DEFAULT_EQUIPPED — which item id starts equipped per slot
(function () {
  const SLOTS = [
    { key: 'head',      label: 'Head' },
    { key: 'necklace',  label: 'Necklace' },
    { key: 'body',      label: 'Body' },
    { key: 'legs',      label: 'Legs' },
    { key: 'boots',     label: 'Boots' },
    { key: 'gloves',    label: 'Gloves' },
    { key: 'back',      label: 'Back' },
    { key: 'mainHand',  label: 'Main Hand' },
    { key: 'offHand',   label: 'Off Hand' },
    { key: 'accessory', label: 'Accessory' }
  ];

  const ITEMS = [
    { id: 'basic-cap',       name: 'Basic Cap',       slot: 'head',      icon: '🧢' },
    { id: 'blue-helmet',     name: 'Blue Helmet',     slot: 'head',      icon: '🪖' },
    { id: 'scout-hood',      name: 'Scout Hood',      slot: 'head',      icon: '🥷' },
    { id: 'astra-visor',     name: 'Astra Visor',     slot: 'head',      icon: '🕶️' },

    { id: 'silver-necklace', name: 'Silver Necklace', slot: 'necklace',  icon: '📿' },
    { id: 'star-pendant',    name: 'Star Pendant',    slot: 'necklace',  icon: '✨' },
    { id: 'void-locket',     name: 'Void Locket',     slot: 'necklace',  icon: '🔮' },
    { id: 'cosmic-chain',    name: 'Cosmic Chain',    slot: 'necklace',  icon: '⛓️' },

    { id: 'space-jacket',    name: 'Space Jacket',    slot: 'body',      icon: '🧥' },
    { id: 'cadet-vest',      name: 'Cadet Vest',      slot: 'body',      icon: '🦺' },
    { id: 'nebula-coat',     name: 'Nebula Coat',     slot: 'body',      icon: '🧥' },
    { id: 'void-armor',      name: 'Void Armor',      slot: 'body',      icon: '🥋' },

    { id: 'grey-joggers',    name: 'Grey Joggers',    slot: 'legs',      icon: '👖' },
    { id: 'cargo-pants',     name: 'Cargo Pants',     slot: 'legs',      icon: '👖' },
    { id: 'void-leggings',   name: 'Void Leggings',   slot: 'legs',      icon: '👖' },
    { id: 'star-trousers',   name: 'Star Trousers',   slot: 'legs',      icon: '👖' },

    { id: 'explorer-boots',  name: 'Explorer Boots',  slot: 'boots',     icon: '🥾' },
    { id: 'trail-runners',   name: 'Trail Runners',   slot: 'boots',     icon: '👟' },
    { id: 'star-walkers',    name: 'Star Walkers',    slot: 'boots',     icon: '🥾' },
    { id: 'void-treads',     name: 'Void Treads',     slot: 'boots',     icon: '👢' },

    { id: 'tech-gloves',     name: 'Tech Gloves',     slot: 'gloves',    icon: '🧤' },
    { id: 'grip-gauntlets',  name: 'Grip Gauntlets',  slot: 'gloves',    icon: '🧤' },
    { id: 'void-mitts',      name: 'Void Mitts',      slot: 'gloves',    icon: '🧤' },
    { id: 'star-grips',      name: 'Star Grips',      slot: 'gloves',    icon: '🧤' },

    { id: 'small-backpack',  name: 'Small Backpack',  slot: 'back',      icon: '🎒' },
    { id: 'star-cape',       name: 'Star Cape',       slot: 'back',      icon: '🧣' },
    { id: 'signal-cloak',    name: 'Signal Cloak',    slot: 'back',      icon: '🧣' },
    { id: 'void-pack',       name: 'Void Pack',       slot: 'back',      icon: '🎒' },

    { id: 'training-sword',  name: 'Training Sword',  slot: 'mainHand',  icon: '🗡️' },
    { id: 'star-blade',      name: 'Star Blade',      slot: 'mainHand',  icon: '⚔️' },
    { id: 'patrol-baton',    name: 'Patrol Baton',    slot: 'mainHand',  icon: '🏏' },
    { id: 'void-saber',      name: 'Void Saber',      slot: 'mainHand',  icon: '🗡️' },

    { id: 'small-shield',    name: 'Small Shield',    slot: 'offHand',   icon: '🛡️' },
    { id: 'void-buckler',    name: 'Void Buckler',    slot: 'offHand',   icon: '🛡️' },
    { id: 'scanner-pad',     name: 'Scanner Pad',     slot: 'offHand',   icon: '📡' },
    { id: 'star-ward',       name: 'Star Ward',       slot: 'offHand',   icon: '🔰' },

    { id: 'wristband',       name: 'Wristband',       slot: 'accessory', icon: '⌚' },
    { id: 'star-ring',       name: 'Star Ring',       slot: 'accessory', icon: '💍' },
    { id: 'signal-badge',    name: 'Signal Badge',    slot: 'accessory', icon: '🎖️' },
    { id: 'void-charm',      name: 'Void Charm',      slot: 'accessory', icon: '🔯' }
  ];

  // a starter loadout so Worn Equipment / Inventory both open with a mix
  // of equipped and empty (Accessory) slots to demonstrate both states
  const DEFAULT_EQUIPPED = {
    head: 'blue-helmet',
    necklace: 'silver-necklace',
    body: 'space-jacket',
    legs: 'grey-joggers',
    boots: 'explorer-boots',
    gloves: 'tech-gloves',
    back: 'small-backpack',
    mainHand: 'training-sword',
    offHand: 'small-shield',
    accessory: null
  };

  window.QZ_EQUIPMENT_SLOTS = SLOTS;
  window.QZ_INVENTORY = ITEMS;
  window.QZ_DEFAULT_EQUIPPED = DEFAULT_EQUIPPED;
})();
