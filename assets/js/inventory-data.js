// ===== Quest Zone — item catalog =====
//
// This is reference data only — every item that CAN exist in the game,
// not what any particular account owns. Ownership and what's equipped
// now live in Supabase (inventory_items / equipped_items, both governed
// by RLS — see supabase/schema.sql and assets/js/inventory.js), which is
// why a brand new account correctly starts with an empty inventory: it
// has zero rows in those tables regardless of how many items exist here.
//
//   window.QZ_EQUIPMENT_SLOTS — the 10 canonical slots, in display order
//   window.QZ_ITEM_CATALOG    — every item definition that exists
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
      // Fully encloses the scalp, so any hairstyle would clip through it —
      // avatar-viewer.js hides the current hair layer whenever the
      // equipped head item sets this, rather than trying to render a
      // crown mesh that fits every hairstyle's shape. See its own comment
      // above setHairstyle for the full mechanism (not built yet — no
      // hairstyle art exists to hide). Leave this false/omitted on a head
      // item that doesn't cover the hair (a circlet, glasses, a hairpin),
      // so it keeps layering on top of hair normally.
      hidesHair: true,
      views: {
        front: '../assets/img/equipment/head/admin-crown-front.png',
        right: '../assets/img/equipment/head/admin-crown-right.png',
        back:  '../assets/img/equipment/head/admin-crown-back.png',
        left:  '../assets/img/equipment/head/admin-crown-left.png'
      }
    }
  ];

  window.QZ_EQUIPMENT_SLOTS = SLOTS;
  window.QZ_ITEM_CATALOG = ITEMS;
})();
