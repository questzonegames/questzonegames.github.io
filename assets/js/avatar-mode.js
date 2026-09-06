// ===== Quest Zone — avatar mode switch =====
//
// Single source of truth for whether the live site shows the full
// multi-angle avatar (front/right/back/left, rotation arrows, drag-to-turn)
// or the simplified front-view-only presentation Quest Zone actually needs
// today (the avatar is a 2D profile/cosmetic display, not a walk-around
// character). Every player-facing page that mounts the avatar viewer
// (profile/index.html, profile/skills.html, profile/customise.html,
// profile/inventory.html) reads this flag rather than hardcoding the
// choice, so flipping it back to 'multi-angle' restores the old
// rotating/draggable viewer and its arrow buttons everywhere at once,
// with zero other code changes.
//
// Nothing about the multi-angle system itself was removed to make this
// switch: avatar-viewer.js still renders all 4 poses and already supported
// a `staticFront` mount option before this file existed; the left/right/
// back art, the avatar_rig_anchors/avatar_rig_items rows for those
// directions, and the Avatar Rig editor's ability to calibrate them all
// still exist untouched — see profile/admin-avatar-storage.html (Admin
// Zone -> 3D Avatar Storage) for where that's kept reachable.
//
// Load this BEFORE avatar-viewer.js and before any page's own "mount the
// avatar" script on every page that mounts it.
window.QZ_AVATAR_MODE = 'front-only'; // 'front-only' | 'multi-angle'
