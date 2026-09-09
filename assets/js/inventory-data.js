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
//
// WHERE on the body `views` actually lands is calibrated live, per
// direction, in Supabase (avatar_rig_items — see
// supabase/migrations/20260906010000_avatar_rig_editor.sql), editable by
// an admin at Admin Zone -> Avatar Rig. `anchorType` below is just which
// reusable body anchor (skull/forehead/above_head/neck — see
// assets/js/avatar-rig.js) the item's calibration is measured FROM; it is
// NOT the item's position itself, and it's only a fallback default (the
// real anchor_type actually used per-direction lives in the DB row, set
// by whichever anchor the admin picked in the editor).
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
    // First normal (non-admin-only) item in the catalog — awarded, not
    // found/bought/gifted, by "Welcome to Your Profile" (see
    // supabase/migrations/20260909040000_achievement_item_rewards.sql's
    // reward_item_ids and unlock_achievement()'s reward-grant step).
    // `tradeable: false` here is display-only/documentary — the real,
    // enforced rule lives server-side on item_definitions.tradeable (see
    // supabase/migrations/20260909050000_item_economy_foundation.sql),
    // seeded to match. `source`/`sourceAchievementId` document where it
    // came from; nothing reads them yet.
    //
    // Boots (and gloves) are a LEFT + RIGHT pair that needs independent
    // on-body positioning per foot — see docs/avatar-equipment.md's
    // "Split left/right parts" section. `parts` is what turns that on:
    // still ONE item (one inventory row, one equip action, one combined
    // icon below), but `views.left`/`views.right` are each their own
    // small on-body art, each calibrated separately in Admin Zone ->
    // Avatar Rig (pick "Doggy Slippers", then the Part selector switches
    // between Left Foot/Right Foot). Only `front` exists per side today
    // — Quest Zone is front-view-only live (see avatar-mode.js) — add
    // right/back/left later the same way if multi-angle ever returns.
    // `iconImage` is the dedicated combined-icon art (both slippers side
    // by side, already composed) — shown everywhere a flat "this item"
    // thumbnail is needed (Inventory grid, Worn Equipment, examine,
    // item-notify's "you received an item" popup); takes priority over
    // auto-compositing the two on-body views, which thumbHtml() only
    // does for a split-parts item with no dedicated iconImage.
    {
      id: 'doggy-slippers',
      name: 'Doggy Slippers',
      slot: 'boots',
      icon: '🥿',
      iconImage: '../assets/img/equipment/boots/doggy-slippers-icon.png',
      parts: ['left', 'right'],
      views: {
        left:  { front: '../assets/img/equipment/boots/doggy-slippers-left-front.png' },
        right: { front: '../assets/img/equipment/boots/doggy-slippers-right-front.png' }
      },
      tradeable: false,
      source: 'achievement',
      sourceAchievementId: 'welcome_to_your_profile'
    },
    {
      id: 'admin-crown',
      name: 'Admin Crown',
      slot: 'head',
      icon: '👑',
      anchorType: 'skull', // fallback only — see comment above; the DB row is authoritative
      // A crown only physically covers the band of scalp its own body
      // occupies — everything else (spikes above/around it, sideburns,
      // lower/back hair) should keep showing right through. 'partial' tells
      // avatar-viewer.js to composite the hair layer through a live-
      // generated occlusion mask (built fresh from wherever this crown is
      // CURRENTLY calibrated to sit, every time — see buildHairMaskDataUrl
      // in avatar-viewer.js) instead of hiding hair outright, so recalibrating
      // the crown in Admin Zone -> Avatar Rig can never leave a stale mask
      // behind. Reserve 'full' (hide the whole hairstyle) for things that
      // truly enclose the entire head, like a full helmet or hood; 'none'
      // (or omitting hairBehavior entirely) for anything that doesn't touch
      // hair at all.
      hairBehavior: 'partial',
      // hairMasks below is legacy — only consulted if the live rig-data
      // fetch fails entirely (see avatar-viewer.js's rigDataFallback) AND
      // this item is falling back to its pre-baked `frames`. Kept (not
      // deleted) purely as that offline/outage safety net; the real,
      // currently-used mask is always generated live.
      hairMasks: {
        front: '../assets/img/equipment/head/masks/admin-crown-front-hairmask.png',
        right: '../assets/img/equipment/head/masks/admin-crown-right-hairmask.png',
        back:  '../assets/img/equipment/head/masks/admin-crown-back-hairmask.png',
        left:  '../assets/img/equipment/head/masks/admin-crown-left-hairmask.png'
      },
      // Full-canvas, per-pose renders of the crown at its OLD, pre-Avatar-
      // Rig-editor fixed position — kept only as the emergency fallback
      // used if the live avatar_rig_* fetch fails (see avatar-viewer.js's
      // setEquipLayer). The real, normally-used position now comes from
      // Supabase (avatar_rig_items), editable at Admin Zone -> Avatar Rig,
      // not from these files. `views` stays load-bearing — it's both the
      // live-positioned art itself AND what inventory/examine UI elsewhere
      // (assets/js/inventory.js) uses for a small cropped thumbnail.
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
