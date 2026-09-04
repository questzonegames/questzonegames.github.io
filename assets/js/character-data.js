// ===== Quest Zone — avatar customization option lists =====
//
// Reference data only, same idea as inventory-data.js: every option that
// currently EXISTS as a real, usable asset — not a wishlist. Right now
// that's just one hairstyle per gender and no beards/skin tones/colours
// yet, which is why Design/Colour rows on the Customise screen show a
// single value with disabled arrows instead of a real cycle.
//
// Adding a real option later (a new hairstyle, a skin tone, a beard) is
// just adding an entry to the matching array below plus the image files
// it points at — profile/customise.html reads these lists directly and
// needs no other change to pick it up.
(function () {
  const GENDERS = [
    { key: 'male', label: 'Male' },
    { key: 'female', label: 'Female' }
  ];

  // keyed by gender — each gender's own hairstyle list, since a hairstyle
  // asset is drawn for one body type, not shared across both. 'none' is
  // real for both genders on day one (it's just the bald base itself —
  // zero art needed); everything past that needs actual per-gender art
  // (see AVAILABLE_HAIRSTYLES in avatar-viewer.js) before it belongs here.
  const HAIRSTYLES = {
    male: [
      { key: 'none', label: 'Bald' },
      { key: 'short-spiky', label: 'Short Spiky' }
    ],
    female: [
      { key: 'none', label: 'Bald' }
    ]
  };

  const BEARDS = {
    male: [
      { key: 'none', label: 'None' }
    ],
    female: [
      { key: 'none', label: 'None' }
    ]
  };

  // Applies to whichever hairstyle is selected (a hairstyle asset is
  // rendered once, in one colour, then recoloured per this list the same
  // way skin tones are — see avatar-viewer.js / RecolorHairLayer). Real
  // for every hairstyle including 'none' (where it's simply unused).
  const HAIR_COLOURS = [
    { key: 'black', label: 'Black' },
    { key: 'dark-brown', label: 'Dark Brown' },
    { key: 'light-brown', label: 'Light Brown' },
    { key: 'blonde', label: 'Blonde' },
    { key: 'white', label: 'White' },
    { key: 'ginger', label: 'Ginger' },
    { key: 'grey', label: 'Grey' }
  ];

  const BEARD_COLOURS = [
    { key: 'default', label: 'Default' }
  ];

  // keyed by gender, same reasoning as hairstyles/beards above — skin tone
  // art is a full body render per combination (see assets/img/avatar/), not
  // a tintable layer, so what's available genuinely differs per gender
  // until matching art exists for both.
  //
  // 'normal' is the site's original default character (assets/img/avatar/
  // avatar-*.png, predating this whole customization system) — it was
  // always a male-presenting body, so it belongs here as one of male's skin
  // tones, not as a stand-in "female" look. Its underlying key stays
  // 'normal' (unchanged — that's what's already saved in every account's
  // avatar_customization row) even though the label shown here is now
  // "Light Tanned", matching its place in the 4-tone set alongside Pale,
  // Dark Tanned, and Black. female is deliberately EMPTY: there is no
  // female base art at all yet, and profile/customise.html disables the
  // Female button whenever a gender's list is empty rather than letting it
  // silently fall back to showing the male body under the wrong label (a
  // real bug this project actually shipped once — see the avatar-viewer.js
  // comment on AVAILABLE_BASES).
  const SKIN_COLOURS = {
    male: [
      { key: 'normal', label: 'Light Tanned' },
      { key: 'pale', label: 'Pale' },
      { key: 'dark-tanned', label: 'Dark Tanned' },
      { key: 'black', label: 'Black' }
    ],
    female: []
  };

  window.QZ_CHARACTER_OPTIONS = {
    genders: GENDERS,
    hairstyles: HAIRSTYLES,
    beards: BEARDS,
    hairColours: HAIR_COLOURS,
    beardColours: BEARD_COLOURS,
    skinColours: SKIN_COLOURS
  };
})();
