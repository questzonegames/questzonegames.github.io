// ===== Quest Zone — avatar rig anchors =====
//
// The single, central store of where things sit on the body, measured
// directly from the bald base art's own alpha channel (avatar-front.png /
// -right.png / -back.png / -left.png — see the head-anchor calibration
// notes in docs/avatar-equipment.md for exactly how). Nothing here is
// eyeballed and nothing here is derived from any item's own old position —
// per the rig rebuild directive, an item's placement is calibrated FROM
// these anchors, never the other way around.
//
// Anchors are stored as a PERCENTAGE of that direction's own base-art
// canvas (matching assets/img/avatar/avatar-<dir>.png's real pixel
// dimensions), not of the on-screen container — the container's own size/
// aspect-ratio varies per page and is handled once by object-fit:contain
// on .avatar-sprite; every layer (base body, hair, equip frame) shares that
// exact same box, so a percentage-of-canvas anchor lines up identically
// everywhere the avatar renders, with zero per-page math.
//
// HEAD anchor types (generic — see FINAL GOAL: an item never defines its
// own anchor, it just says which one it uses):
//   ABOVE_HEAD — above the very top of the skull; halos, floating icons
//   SKULL      — upper cranium / brow line; crowns, caps, most headwear
//   FOREHEAD   — brow/eye line; tiaras, goggles (not yet placed on an item)
//   NECK       — where the head silhouette narrows to the neck; collars
// FOREHEAD here is intentionally close to SKULL — alpha-channel analysis
// of a silhouette can only find shape edges, not internal features like an
// eye-line, so FOREHEAD is an approximation pending a real forehead-level
// item to calibrate against (see docs/avatar-equipment.md).
(function () {
  var HEAD_ANCHORS = {
    front: {
      canvasW: 636, canvasH: 1514,
      centerXPct: 50.31,          // real measured skull horizontal centre
      aboveHeadYPct: 0.66,        // a little above the measured skull-top (y=20)
      skullYPct: 6.66,            // mid-cranium plateau (y~100), NOT the ear line
      skullWidthPct: 25.47,
      foreheadYPct: 9.58,
      neckYPct: 14.86,
      neckWidthPct: 17.61
    },
    back: {
      canvasW: 584, canvasH: 1514,
      centerXPct: 49.49,
      aboveHeadYPct: 0.66,
      skullYPct: 6.66,
      skullWidthPct: 28.42,
      foreheadYPct: 9.71,
      neckYPct: 14.86,
      neckWidthPct: 18.49
    },
    // right/left: centerXPct here is the SIDE-VIEW skull band's own
    // front-to-back midpoint (not a left/right symmetry line — a profile
    // silhouette isn't symmetric front-to-back), measured the same way.
    right: {
      canvasW: 302, canvasH: 1515,
      centerXPct: 54.64,
      aboveHeadYPct: 0.66,
      skullYPct: 7.26,
      skullWidthPct: 66.89,
      foreheadYPct: 9.90,
      neckYPct: 15.84,
      neckWidthPct: 53.64
    },
    left: {
      canvasW: 302, canvasH: 1515,
      centerXPct: 45.03,
      aboveHeadYPct: 0.66,
      skullYPct: 7.26,
      skullWidthPct: 66.89,
      foreheadYPct: 9.90,
      neckYPct: 15.84,
      neckWidthPct: 53.64
    }
  };

  window.QZAvatarRig = { HEAD_ANCHORS: HEAD_ANCHORS };
})();
