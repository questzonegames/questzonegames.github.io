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
  // asset is drawn for one body type, not shared across both
  const HAIRSTYLES = {
    male: [
      { key: 'default', label: 'Default' }
    ],
    female: [
      { key: 'default', label: 'Default' }
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

  const HAIR_COLOURS = [
    { key: 'default', label: 'Default' }
  ];

  const BEARD_COLOURS = [
    { key: 'default', label: 'Default' }
  ];

  // keyed by gender, same reasoning as hairstyles/beards above — skin tone
  // art is a full body render per combination (see assets/img/avatar/), not
  // a tintable layer, so what's available genuinely differs per gender
  // until matching art exists for both.
  const SKIN_COLOURS = {
    male: [
      { key: 'black', label: 'Black' },
      { key: 'pale', label: 'Pale' }
    ],
    female: [
      { key: 'default', label: 'Default' }
    ]
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
