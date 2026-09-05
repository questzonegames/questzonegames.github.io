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
      // A crown only physically covers the band of scalp its own body
      // occupies — everything else (spikes above/around it, sideburns,
      // lower/back hair) should keep showing right through. 'partial' tells
      // avatar-viewer.js to composite the hair layer through hairMasks
      // (one alpha mask per direction, precomputed from this crown's own
      // art at its actual on-head position/scale) instead of hiding hair
      // outright — see HEAD_HAIR_BEHAVIOR/applyHairOcclusion there for the
      // general mechanism every head-slot item shares. Reserve 'full' (hide
      // the whole hairstyle, no mask needed) for things that truly enclose
      // the entire head, like a full helmet or hood; 'none' (or omitting
      // hairBehavior entirely) for anything that doesn't touch hair at all.
      hairBehavior: 'partial',
      hairMasks: {
        front: '../assets/img/equipment/head/masks/admin-crown-front-hairmask.png',
        right: '../assets/img/equipment/head/masks/admin-crown-right-hairmask.png',
        back:  '../assets/img/equipment/head/masks/admin-crown-back-hairmask.png',
        left:  '../assets/img/equipment/head/masks/admin-crown-left-hairmask.png'
      },
      // Full-canvas, per-pose renders of the crown already placed at its
      // correct on-head pixel position (same canvas size as that pose's
      // base body art) — see avatar-viewer.js's setEquipLayer. Rendered
      // through the exact same box/contain-fit as the base body itself,
      // so it can't drift from the head the way a percent-of-container
      // position (views + EQUIP_POSITIONS) could across rendering
      // contexts. `views` stays too — inventory/examine UI elsewhere
      // (assets/js/inventory.js) still wants a small cropped thumbnail,
      // not a full transparent canvas.
      frames: {
        front: '../assets/img/equipment/head/frames/admin-crown-front-frame.png',
        right: '../assets/img/equipment/head/frames/admin-crown-right-frame.png',
        back:  '../assets/img/equipment/head/frames/admin-crown-back-frame.png',
        left:  '../assets/img/equipment/head/frames/admin-crown-left-frame.png'
      },
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
