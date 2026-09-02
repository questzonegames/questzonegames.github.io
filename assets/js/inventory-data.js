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
//
// An item's `views` (front/right/back/left image paths) is what makes it
// actually appear on the avatar, worn correctly at every angle — see
// avatar-viewer.js's setAvatarEquipment. An item with no `views` yet still
// works everywhere else (Worn Equipment, Inventory, equip/unequip), it
// just shows as an icon chip on the avatar instead of true on-body art.
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
    {
      id: 'admin-crown',
      name: 'Admin Crown',
      slot: 'head',
      icon: '👑',
      views: {
        front: '../assets/img/equipment/head/admin-crown-front.png',
        right: '../assets/img/equipment/head/admin-crown-right.png',
        back:  '../assets/img/equipment/head/admin-crown-back.png',
        left:  '../assets/img/equipment/head/admin-crown-left.png'
      }
    }
  ];

  // nothing equipped by default — the avatar opens bare-headed
  const DEFAULT_EQUIPPED = {
    head: null,
    necklace: null,
    body: null,
    legs: null,
    boots: null,
    gloves: null,
    back: null,
    mainHand: null,
    offHand: null,
    accessory: null
  };

  window.QZ_EQUIPMENT_SLOTS = SLOTS;
  window.QZ_INVENTORY = ITEMS;
  window.QZ_DEFAULT_EQUIPPED = DEFAULT_EQUIPPED;
})();
