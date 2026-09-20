// ===== Pup N Away — central configuration =====
//
// Everything that isn't pure engine logic lives here: the design
// coordinate system, every tunable physics/feel constant, the full
// asset manifest (every image path used by the game, in ONE place —
// see the "Asset paths" rule in the project brief), and the level
// manifest. No other file should hardcode an asset path or a tuning
// number — they all read from window.PNA_CONFIG.
//
// All assets referenced below were located by inspecting the supplied
// folder at build time (see the implementation report for the full
// discovered-asset mapping) and copied into assets/img/pup-n-away/ with
// stable, descriptive names — nothing here points at a local machine
// path.
(function () {
  const DESIGN_W = 1920;
  const DESIGN_H = 1080;

  const IMG = '../../assets/img/pup-n-away/';

  // ---------------------------------------------------------------
  // Asset manifest — every image path, in one place.
  // ---------------------------------------------------------------
  const ASSETS = {
    logo: IMG + 'logo/logo.png',

    // Dog run-cycle — 5 frames per direction, in animation order. Real
    // supplied art (Quest-Zone-Dog-Run-Cycle/), used for both the
    // ground-running intro/outro shots AND as the airborne left/right
    // "moving" bounce poses (see dogBouncePoses below) — the supplied
    // "dog bounce" folder only contained ONE frame (a curled/tucked
    // pose), not a full set of rising/falling/left/right poses, so
    // those states reuse the closest run-cycle frame rather than
    // inventing new artwork, exactly as the brief allows ("map assets
    // according to their actual contents... use the closest supplied
    // pose").
    dogRun: {
      right: [
        IMG + 'dog/run-right/01-contact.png',
        IMG + 'dog/run-right/02-compression.png',
        IMG + 'dog/run-right/03-push-off.png',
        IMG + 'dog/run-right/04-extended.png',
        IMG + 'dog/run-right/05-gathered.png'
      ],
      left: [
        IMG + 'dog/run-left/01-contact.png',
        IMG + 'dog/run-left/02-compression.png',
        IMG + 'dog/run-left/03-push-off.png',
        IMG + 'dog/run-left/04-extended.png',
        IMG + 'dog/run-left/05-gathered.png'
      ]
    },
    dogCurled: IMG + 'dog/bounce/curled.png',   // the one real supplied "dog bounce" frame
    dogSit: IMG + 'dog/misc/sit.png',           // closest supplied pose for the intro's "settling down" beat

    // Real supplied basket art — a cloud/star basket, "Basket 01.png"
    // from the Pup-N-Away/basket/Baskets/Baskets folder (5 designs were
    // supplied; 01 is used as the default). Used as-is, at its own
    // 1774x887 aspect ratio (see PHYSICS.basketWidth/basketHeight in
    // this file). The renderer still falls back to a plain canvas shape
    // (see pup-n-away-basket.js) only if this image ever fails to load.
    baskets: {
      default: IMG + 'baskets/default-basket.png'
    },

    // Collectibles — 5 real items were supplied; the brief's v1 scope is
    // Dream Bone only, but every discovered item is registered here
    // (inactive) so a future level can turn one on without touching the
    // collectible engine at all (see COLLECTIBLE_TYPES below).
    collectibles: {
      dreamBone: IMG + 'collectibles/dream-bone.png',
      goldenDreamBone: IMG + 'collectibles/golden-dream-bone.png',
      goldenHeartBiscuit: IMG + 'collectibles/golden-heart-biscuit.png',
      nightmareBone: IMG + 'collectibles/nightmare-bone.png',
      freezeTimeBiscuit: IMG + 'collectibles/freeze-time-biscuit.png',
      dreamTennisBall: IMG + 'collectibles/dream-tennis-ball.png',
      squeakyMoonToy: IMG + 'collectibles/squeaky-moon-toy.png',
      starDogBiscuit: IMG + 'collectibles/star-dog-biscuit.png'
    },

    // Permanent obstacles — real gameplay hazards/bumpers, not
    // collectibles (nothing here is ever picked up or removed). The
    // Star Core Orb is the first of these; `reference` is ONLY the
    // Map Editor toolbar preview/placed-icon — it is never drawn during
    // real gameplay, which assembles the object live from the other
    // three layers (see pup-n-away-obstacles.js).
    obstacles: {
      starCoreOrb: {
        reference: IMG + 'obstacles/star-core-orb/reference.png',
        shell: IMG + 'obstacles/star-core-orb/orb-shell.png',
        star: IMG + 'obstacles/star-core-orb/star.png',
        ring: IMG + 'obstacles/star-core-orb/ring.png'
      }
    },

    backgrounds: {
      dreamBedroom: IMG + 'backgrounds/act1/dream-bedroom.png',
      backGarden: IMG + 'backgrounds/act1/back-garden.png',
      houseRooftop: IMG + 'backgrounds/act1/house-rooftop.png',
      aboveTheCity: IMG + 'backgrounds/act2/above-the-city.png',
      cloudAscent: IMG + 'backgrounds/act2/cloud-ascent.png',
      dreamSpace: IMG + 'backgrounds/act2/dream-space.png',
      mountainCrossing: IMG + 'backgrounds/act3/mountain-crossing.png',
      oreLitRavine: IMG + 'backgrounds/act3/ore-lit-ravine.png',
      heartOfTheDeep: IMG + 'backgrounds/act3/heart-of-the-deep.png'
    },

    // Lobby-only rotating background slideshow (see pup-n-away-lobby-bg.js)
    // — 9 supplied dreamy-night-sky pieces, played in this exact order,
    // looping. Purely decorative behind the lobby menu; unrelated to the
    // Act 1 gameplay backgrounds above. Flattened by PNA_Assets.loadAll()
    // into images['lobbyBackgroundSlideshow.0'] .. .8, in array order.
    lobbyBackgroundSlideshow: [
      IMG + 'backgrounds/lobby-slideshow/01-dream-bedroom.png',
      IMG + 'backgrounds/lobby-slideshow/02-cloud-kingdom.png',
      IMG + 'backgrounds/lobby-slideshow/03-moonlit-garden.png',
      IMG + 'backgrounds/lobby-slideshow/04-dream-constellations.png',
      IMG + 'backgrounds/lobby-slideshow/05-dream-journey.png',
      IMG + 'backgrounds/lobby-slideshow/06-starry-attic-observatory.png',
      IMG + 'backgrounds/lobby-slideshow/07-enchanted-dream-forest.png',
      IMG + 'backgrounds/lobby-slideshow/08-floating-toy-dreamland.png',
      IMG + 'backgrounds/lobby-slideshow/09-aurora-mountain-dream.png'
    ],

    // Lobby (still one flattened PNG — untouched by the modular-asset
    // rebuild) + the three wide menu screens, each now assembled from a
    // blank frame TEMPLATE plus separate modular widget PNGs (buttons,
    // cards, dropdowns, scrollbars) rather than one flattened background.
    // Every live control/thumbnail/label is real HTML — see
    // pup-n-away-menus.js and the .pna-ui-*/.pna-ls-*/.pna-ch-*/.pna-eq-*
    // CSS in index.html. Act 1's own level backgrounds (above) double as
    // the Level Select thumbnails — no separate thumbnail images exist.
    ui: {
      lobby: IMG + 'ui/lobby.png',
      levelSelect: {
        template: IMG + 'ui/level-select/blank-template.png',
        actButtonNormal: IMG + 'ui/level-select/act-button-normal.png',
        actButtonSelected: IMG + 'ui/level-select/act-button-selected.png',
        actNamePlate: IMG + 'ui/level-select/act-name-plate.png',
        levelCard: IMG + 'ui/level-select/level-card.png',
        lockedPadlock: IMG + 'ui/level-select/locked-padlock.png',
        scrollbarTrack: IMG + 'ui/level-select/scrollbar-track.png',
        scrollbarThumb: IMG + 'ui/level-select/scrollbar-thumb.png'
      },
      challenges: {
        template: IMG + 'ui/challenges/blank-template.png',
        tierButtonNormal: IMG + 'ui/challenges/tier-button-normal.png',
        tierButtonSelected: IMG + 'ui/challenges/tier-button-selected.png',
        filterDropdown: IMG + 'ui/challenges/filter-dropdown.png',
        searchField: IMG + 'ui/challenges/search-field.png',
        challengeCard: IMG + 'ui/challenges/challenge-card.png',
        scrollbarTrack: IMG + 'ui/challenges/scrollbar-track.png',
        scrollbarThumb: IMG + 'ui/challenges/scrollbar-thumb.png'
      },
      equipment: {
        template: IMG + 'ui/equipment/blank-template.png',
        tabButtonNormal: IMG + 'ui/equipment/tab-button-normal.png',
        tabButtonSelected: IMG + 'ui/equipment/tab-button-selected.png',
        filterDropdown: IMG + 'ui/equipment/filter-dropdown.png',
        searchField: IMG + 'ui/equipment/search-field.png',
        itemCard: IMG + 'ui/equipment/equipment-item-card.png',
        scrollbarTrack: IMG + 'ui/equipment/scrollbar-track.png',
        scrollbarThumb: IMG + 'ui/equipment/scrollbar-thumb.png'
      },
      // Admin-only Level Editor entry point — real supplied plaque art
      // ("admin tool.png"), used as-is, never recolored/recreated with
      // CSS. Only ever shown to profile.is_admin (see
      // wireAdminDebugToggle()'s own comment for why that client flag
      // is fine for SHOWING a control — every actual editor read/write
      // re-checks public.is_admin() server-side regardless).
      editor: {
        adminPlaque: IMG + 'ui/editor/admin-tool.png'
      }
    }
  };

  // ---------------------------------------------------------------
  // UI hotspot geometry — every interactive region on the four menu
  // screens, as a PERCENTAGE of its own source PNG's full canvas
  // (matching the convention already used for the HUD toolbar and the
  // result panels). Measured directly from the supplied assets' own
  // pixels (alpha/color-boundary scans) where the art gave a clean
  // signal; the busier, text-heavy regions (the lobby's 5 stacked
  // buttons, the challenge tier tabs, the equipment grid) combine a
  // precise measured anchor with even-spacing math, since the artwork
  // itself lays those out as a regular grid. Nudge any of these directly
  // if the debug outline mode (?pnaUiDebug=1, see index.html) shows a
  // hitbox drifting from its baked button.
  // ---------------------------------------------------------------
  const UI_HOTSPOTS = {
    lobby: {
      // Re-measured a third time with a per-row majority-color-vote scan
      // (gold for Start Game, blue for the other 4) instead of a single
      // pixel column — the earlier two passes were both contaminated by
      // the decorative moon/star header art sitting directly above the
      // button stack, which is why they read too high. This pass
      // isolates each button's own large contiguous color band and
      // ignores small star/text-glyph interruptions.
      left: 13.3, width: 73.4,
      buttons: {
        start:        { top: 44.66, height: 8.07 },
        levelSelect:  { top: 55.27, height: 6.84 },
        challenges:   { top: 64.65, height: 6.84 },
        equipment:    { top: 73.89, height: 6.58 },
        returnHome:   { top: 82.1, height: 7.4 }
      }
    },
    // levelSelect/challenges/equipment below are laid out against each
    // screen's blank TEMPLATE (still 1672x941, same frame family as the
    // old flattened images, so the outer frame/Return-to-Lobby geometry
    // carries over) — every button/card/tab is now a separate widget
    // image sized by its own real aspect ratio (via CSS aspect-ratio, so
    // it can never be stretched) and positioned by left/top/width alone.
    levelSelect: {
      // measured directly from references/level select ref.png: the
      // act-button column's gold-bordered strip spans x=44..380 of 1672,
      // y=152..916 of 941, divided evenly into 10 rows.
      actList: {
        left: 2.63, width: 20.10,
        rowTop: 16.15, rowHeight: 8.12,
        count: 10,
        buttonAspect: 694 / 180 // act-button-normal.png / act-button-selected.png
      },
      // Pushed down a second time — 21% still clipped under the "LEVEL
      // SELECT" banner's lower decoration in practice. 25% gives real
      // clearance.
      actNamePlate: {
        left: 26.0, width: 69.0, top: 25.0,
        aspect: 1596 / 204 // act-name-plate.png
      },
      // 3 level cards, evenly spaced across the same span the name
      // plate occupies, sized by level-card.png's own aspect ratio.
      // Pushed down below the (now lower) name plate — plate bottom is
      // 25 + 69%*(1672/941)/7.82 ≈ 25 + 15.7 ≈ 40.7%, so cards start at 43%.
      cards: {
        left: [27.0, 50.2, 73.4], width: 21.5, top: 43.0,
        aspect: 680 / 488, // level-card.png
        // Sub-regions below are percentages of the CARD's OWN rendered
        // box (not the full screen) — measured directly from
        // level-card.png's pixels (its gold-bordered thumbnail window
        // and nameplate pill).
        thumb: { left: 6.18, width: 87.4, top: 22.1, height: 45.9 },
        nameplate: { left: 7.06, width: 85.6, top: 72.5, height: 18.9 },
        // Padlock size/position as a fraction of the card box, centered
        // over the thumbnail window.
        padlock: { widthOfCard: 24.0, aspect: 199 / 250 }
      },
      // NOT the same geometry as Challenges/Equipment's Return to Lobby
      // (an earlier pass wrongly assumed all three shared one position) —
      // this screen's act-list column occupies the left ~23% of the
      // panel, so its own Return to Lobby pill sits further left/lower,
      // not centered on the full panel width. Re-measured directly
      // against this template.
      // Read directly off a percentage-gridline overlay rendered onto
      // this template (the most reliable method after several rounds of
      // color-threshold pixel scanning kept getting fooled by the
      // frame's own connected gold border/decoration) — see the
      // implementation notes for how this was generated.
      // Read off a FINE (1%-step) percentage-gridline overlay, zoomed
      // into just this region — the previous 5%-step overlay wasn't
      // precise enough and left the box shifted noticeably right
      // (clipping "RET" off the front of the button in practice).
      returnToLobby: { left: 24.3, width: 26.4, top: 85.5, height: 7.5 }
    },
    challenges: {
      // The tier tabs' own box (left/width/top/height, size, hitbox fit)
      // is confirmed correct as-is — DO NOT adjust these four numbers.
      tiers: {
        left: 3.59, width: 93.18, top: 24.0, height: 9.5,
        count: 6,
        buttonAspect: 585 / 177 // tier-button-normal.png / -selected.png
      },
      // Tightened up against the tiers row and each other — the previous
      // pass left a large empty blue gap between the filter row and the
      // card list (and between the card list and the Return button) that
      // read as unused/broken space rather than a deliberately laid-out
      // screen.
      filterByAct: { left: 3.6, width: 30.0, top: 34.5, height: 6.5, aspect: 718 / 147 },
      secondaryFilter: { left: 36.5, width: 28.0, top: 34.5, height: 6.5, aspect: 718 / 147 },
      search: { left: 67.5, width: 29.0, top: 34.5, height: 6.5, aspect: 719 / 147 },
      // height trimmed from 41.6 to 37.1 (bottom moved from 88.5% to
      // 84.0%) — a pixel scan straight down the template's own vertical
      // centre found the flat blue content area's real bottom edge at
      // y=798/941 = 84.8%; the gold border begins immediately after.
      // The old 88.5% bottom ran the scrollable list ~4.5% INTO the
      // border/clouds/Return-to-Lobby artwork, which is what let
      // scrolled cards paint over that decoration and the button. See
      // .pna-ui-footer-mask in index.html for the second layer (same
      // template image, clipped to just this bottom band, stacked above
      // the card list) that then conceals the list's own clipped edge
      // with real matching artwork instead of a hard cut.
      cardList: { left: 3.6, width: 88.0, top: 46.9, height: 37.1 },
      scrollbar: {
        left: 93.5, width: 2.8, top: 46.9, height: 37.1,
        trackAspect: 84 / 411, thumbAspect: 71 / 165
      },
      // challenge-card.png sub-regions, as a percentage of the CARD's
      // own box — icon square, title bar, description box.
      card: {
        aspect: 1286 / 353,
        icon: { left: 1.87, width: 15.85, top: 21.5, height: 50.4 },
        title: { left: 21.8, width: 70.6, top: 17.0, height: 19.3 },
        description: { left: 21.8, width: 70.6, top: 41.4, height: 42.5 }
      },
      // Same shared Return-to-Lobby geometry as Level Select (see its
      // own comment) — re-measured directly, all three templates share
      // this exact pill position.
      // Read directly off a percentage-gridline overlay (see Level
      // Select's own comment above).
      // Read off a fine (1%-step) percentage-gridline overlay (see
      // Level Select's own comment above).
      returnToLobby: { left: 37.0, width: 25.2, top: 86.2, height: 6.7 }
    },
    equipment: {
      tabs: {
        owned:   { left: 31.5, width: 17.0, top: 25.0, height: 7.5 },
        unowned: { left: 49.5, width: 17.0, top: 25.0, height: 7.5 },
        aspect: 805 / 180 // tab-button-normal.png / -selected.png
      },
      // Row of 5 controls: 4 filter dropdowns + 1 search field, spanning
      // the full content width (no side preview panel in this design —
      // clicking an owned card equips it directly, see
      // pup-n-away-menus.js). Tightened against the tabs row and the
      // grid below, same reasoning as Challenges above.
      filters: { left: 3.6, width: 74.0, top: 33.5, height: 6.0, count: 4, aspect: 795 / 152 },
      search: { left: 79.0, width: 17.5, top: 33.5, height: 6.0, aspect: 798 / 149 },
      // height trimmed from 47.5 to 43.0 (bottom moved from 88.5% to
      // 84.0%) — same reasoning as Challenges' cardList above; a pixel
      // scan of this template found its own blue area ends at
      // y=790/941 = 84.0%. See .pna-ui-footer-mask in index.html.
      grid: { left: 3.6, width: 92.8, top: 41.0, height: 43.0, columns: 5 },
      scrollbar: {
        left: 97.0, width: 2.0, top: 41.0, height: 43.0,
        trackAspect: 84 / 451, thumbAspect: 83 / 224
      },
      // equipment-item-card.png sub-regions, as a percentage of the
      // CARD's own box — image window + nameplate pill.
      card: {
        aspect: 510 / 470,
        image: { left: 14.7, width: 70.0, top: 13.2, height: 56.2 },
        nameplate: { left: 14.7, width: 70.0, top: 74.9, height: 14.5 }
      },
      // Same left/width as Challenges' Return to Lobby (confirmed correct
      // there) — height trimmed slightly, since a live corner-pixel
      // check found this template's own pill sits marginally shorter.
      // Read directly off a percentage-gridline overlay (see Level
      // Select's own comment above).
      // Read off a fine (1%-step) percentage-gridline overlay (see
      // Level Select's own comment above).
      returnToLobby: { left: 36.9, width: 24.9, top: 85.7, height: 7.1 }
    }
  };

  // ---------------------------------------------------------------
  // Sprite anchors — pre-measured from the actual supplied PNGs (each
  // frame's real ink/alpha bounding box), NOT the raw transparent
  // canvas size. The run-cycle frames in particular have wildly
  // different amounts of transparent padding per pose (measured
  // directly: bottom-of-content ranges from y=824 to y=958 on a
  // 1024-tall canvas) — drawing them all at a fixed canvas position
  // would make the dog visibly jump around during the run animation.
  // Each entry's `footY`/`centerX` (in the ORIGINAL png's own pixel
  // space) is used to align every frame to one consistent world anchor
  // — see spriteDrawRect() in pup-n-away-dog.js.
  // ---------------------------------------------------------------
  const SPRITE_ANCHORS = {
    dogRunRight: [
      { w: 1536, h: 1024, centerX: 783.0, footY: 945 }, // 01-contact
      { w: 1536, h: 1024, centerX: 800.5, footY: 917 }, // 02-compression
      { w: 1536, h: 1024, centerX: 794.0, footY: 951 }, // 03-push-off
      { w: 1536, h: 1024, centerX: 784.0, footY: 824 }, // 04-extended
      { w: 1536, h: 1024, centerX: 829.5, footY: 874 }  // 05-gathered
    ],
    dogRunLeft: [
      { w: 1536, h: 1024, centerX: 771.5, footY: 929 }, // 01-contact
      { w: 1536, h: 1024, centerX: 753.0, footY: 907 }, // 02-compression
      { w: 1536, h: 1024, centerX: 755.5, footY: 958 }, // 03-push-off
      { w: 1536, h: 1024, centerX: 770.0, footY: 825 }, // 04-extended
      { w: 1536, h: 1024, centerX: 713.5, footY: 873 }  // 05-gathered
    ],
    // Airborne/curled poses use their own CENTER (not a foot position —
    // there's no ground contact mid-air) as the anchor.
    dogCurled: { w: 1254, h: 1254, centerX: 625.0, centerY: 522.5 },
    dogSit: { w: 1254, h: 1254, centerX: 614.5, centerY: 576.5 }
  };

  // A single, clearly named place to change the Golden Dream Bone's
  // bonus score — already defined at 250 from an earlier round, kept
  // (not reset to the brief's "500 if undefined" fallback) since the
  // project already had an intended value.
  const GOLDEN_DREAM_BONE_BONUS = 250;

  // ---------------------------------------------------------------
  // Collectible type registry — data-driven so a new collectible only
  // ever needs a new entry here, never a physics/engine change. `kind`
  // is what pup-n-away.js's onBoneCollected() branches on for a type's
  // actual gameplay side effect ('required' = counts toward level
  // completion, same as always; 'bonusScore'/'extraLife'/'loseLife'/
  // 'freezeTimer' are the 4 new pickups this round, none of which
  // count toward that total).
  const COLLECTIBLE_TYPES = {
    dreamBone: { asset: 'dreamBone', points: 100, radius: 46, active: true, kind: 'required' },
    goldenDreamBone: { asset: 'goldenDreamBone', points: GOLDEN_DREAM_BONE_BONUS, radius: 46, active: true, kind: 'bonusScore' },
    goldenHeartBiscuit: { asset: 'goldenHeartBiscuit', points: 0, radius: 46, active: true, kind: 'extraLife' },
    nightmareBone: { asset: 'nightmareBone', points: 0, radius: 46, active: true, kind: 'loseLife' },
    freezeTimeBiscuit: { asset: 'freezeTimeBiscuit', points: 0, radius: 46, active: true, kind: 'freezeTimer', freezeSeconds: 5 },
    dreamTennisBall: { asset: 'dreamTennisBall', points: 50, radius: 42, active: false },
    squeakyMoonToy: { asset: 'squeakyMoonToy', points: 75, radius: 44, active: false },
    starDogBiscuit: { asset: 'starDogBiscuit', points: 60, radius: 42, active: false }
  };

  // ---------------------------------------------------------------
  // Tuning constants — every physics/feel number the brief asked to be
  // configurable, named and in one place.
  // ---------------------------------------------------------------
  const PHYSICS = {
    gravity: 2200,                 // px/s^2, downward

    // ---- directional basket bounce ----
    // Launch SPEED now depends on a build-able "bounce charge" (0-1),
    // not a flat constant: hitting the basket dead-center repeatedly
    // ramps the charge up toward bounceSpeedMax (tuned so a fully-
    // charged center hit reaches almost to the top of the 1080-tall
    // screen); hitting off-center spends some of that built-up charge
    // to fling the dog outward toward the bones at an angle instead of
    // straight up. See computeBounceVelocity() in pup-n-away-physics.js
    // and dog.state.bounceCharge, which persists across bounces until
    // a fresh launch (level start / after a missed catch) resets it.
    bounceSpeedBase: 1300,         // px/s launch speed with zero charge (a single center hit)
    bounceSpeedMax: 2050,          // px/s launch speed at full charge — apex lands ~40px from the top
    centerHitThreshold: 0.25,      // |relativeHit| at or under this counts as "centered enough" to build charge
    chargeGainPerCenterHit: 0.34,  // charge gained per centered hit (~3 hits to reach full charge)
    chargeSpendRate: 0.6,          // fraction of charge spent per unit of |relativeHit| on an off-center hit
    minBounceAngleDeg: 0,          // dead-centre hit -> straight up
    maxBounceAngleDeg: 74,         // extreme edge hit, measured from vertical — kept safely under 90 so the
                                    // dog can never launch fully horizontally along the basket (per brief)
    minVerticalLaunchSpeed: 300,   // px/s upward, guaranteed floor even at the widest angle
    maxHorizontalSpeed: 1600,      // px/s cap on |vx| at all times, in flight or off a bounce
    basketMomentumTransfer: 0.18,  // fraction of the basket's OWN vx blended into the dog's post-bounce vx
    wallRestitution: 0.96,         // side/top wall bounce speed retention (slightly lossy, feels natural)

    // ---- basket ----
    // The real supplied basket art (a cloud/star basket, 1774x887 —
    // roughly a 2:1 width:height ratio) is drawn at its own aspect
    // ratio here so it's never stretched; basketWidth still doubles as
    // the physics catching-plane width used by the bounce formula.
    basketWidth: 260,
    basketHeight: 130,
    basketSpeed: 1300,             // px/s — constant speed the instant a direction key is held, no ramp-up
    basketSquashMs: 130,           // brief visual squash on impact
    // Default top-surface Y (the bounce plane) — was DESIGN_H - 90,
    // which put the basket's BOTTOM edge at (DESIGN_H-90)+basketHeight
    // = DESIGN_H+40, i.e. 40px (31% of its own height) permanently
    // below the visible canvas. Raised so the full basket renders
    // on-screen with a small margin. The single source of truth for
    // both the real physics default (pup-n-away-basket.js) and the
    // Level Editor's own default/guideline (pup-n-away-editor.js) —
    // never duplicated as a second hardcoded literal.
    basketDefaultSurfaceY: DESIGN_H - 140,

    // ---- dog ----
    dogVisualSize: 190,            // on-screen diameter (design px) every pose is scaled to
    dogCollisionRadius: 78,        // deliberately smaller than the visual sprite — fair, forgiving hitbox
    dogRunSpeed: 640,              // px/s, ground run during intro/outro sequences
    dogFrameMs: 90,                // run-cycle frame duration

    // ---- collision solver ----
    maxSubstepPx: 24,              // any frame-step predicted to move the dog further than this is split
    maxSubsteps: 8,

    // ---- lives / misses ----
    startingLives: 3,
    missResetDelayMs: 900,

    // ---- collectibles ----
    collectibleIdlePeriodMs: 2200,
    collectibleFloatPx: 10,
    collectibleSpinDeg: 6,

    // ---- Star Core Orb (permanent radial-bumper obstacle) ----
    // displaySize is the design-px width/height of the FULL assembled
    // canvas (all 3 layers share one 1254x1254 source canvas) at
    // scale:1; collisionRadius was measured directly off the supplied
    // ring artwork's own visible (non-transparent) pixel bounds — the
    // ring's outer edge sits at ~43.06% of the shared canvas's half-
    // width, so the collider always matches what the player actually
    // sees, at any scale.
    starCoreOrbDisplaySize: 110,
    starCoreOrbCollisionRadius: 47.5,
    // Named, independently-tunable rotation speeds — full turns per
    // second, matching how everything else in this block is a plain,
    // easily-adjusted number rather than a derived one.
    starCoreOrbStarRotationsPerSec: 1 / 4,   // one counterclockwise turn every 4s
    starCoreOrbRingRotationsPerSec: 1 / 6,   // one clockwise turn every 6s
    // Stronger than a normal wall bounce (which only reflects the dog's
    // existing speed at 0.96x), fast enough to redirect noticeably, but
    // safely under bounceSpeedMax so a full-charge basket bounce is
    // still the single fastest thing in the level.
    starCoreOrbLaunchSpeed: 1700
  };

  // ---------------------------------------------------------------
  // Level manifest — each level is fully self-contained data; the
  // engine never branches on a level id or filename directly.
  // ---------------------------------------------------------------
  function bonesGrid(points) {
    return points.map(([x, y]) => ({ x, y }));
  }

  // Every level identifies its own act and position within it (act,
  // positionInAct, 1-based) rather than the engine inferring that from
  // array order — see pup-n-away-levels.js's isFinalLevelOfAct()/
  // firstLevelIndexOfAct(), which read these fields instead of
  // assuming "3 levels per act" as a hardcoded rule. Only Act 1 exists
  // today (3 levels); adding Act 2 later is purely new LEVELS entries
  // with act:2, positionInAct:1..3 — no engine change needed.
  const LEVELS = [
    {
      id: 'dream-bedroom',
      name: 'Dream Bedroom',
      act: 1,
      positionInAct: 1,
      background: 'dreamBedroom',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [360, 260], [720, 190], [1080, 210], [1440, 260], [1650, 420],
        [270, 480], [960, 130], [560, 620], [1320, 600], [960, 820]
      ]),
      gravity: PHYSICS.gravity,
      bounceSpeed: PHYSICS.bounceSpeedMax
    },
    {
      id: 'back-garden',
      name: 'Back Garden',
      act: 1,
      positionInAct: 2,
      background: 'backGarden',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [200, 300], [500, 180], [850, 230], [1200, 180], [1550, 300],
        [1720, 520], [960, 400], [400, 620], [1350, 640], [700, 820], [1250, 860]
      ]),
      gravity: PHYSICS.gravity,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.03
    },
    {
      id: 'house-rooftop',
      name: 'House Rooftop',
      act: 1,
      positionInAct: 3,
      background: 'houseRooftop',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -950 },
      bones: bonesGrid([
        [260, 220], [640, 150], [960, 120], [1280, 150], [1660, 220],
        [180, 460], [1740, 460], [700, 340], [1220, 340], [960, 560],
        [460, 700], [1460, 700], [960, 860]
      ]),
      gravity: PHYSICS.gravity * 1.04,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.06
    },

    // ---- Act 2: "Journey to the Stars" ----
    // Bone layouts below are deliberately simple, evenly-spaced grids
    // using only the standard Dream Bone (per the brief: don't place
    // special collectibles into new levels just because the toolbar has
    // them) — a clean, fully data-driven placeholder that the Level
    // Editor can freely rearrange later once real layouts are designed.
    {
      id: 'above-the-city',
      name: 'Above the City',
      act: 2,
      positionInAct: 1,
      background: 'aboveTheCity',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [300, 260], [660, 190], [1020, 220], [1380, 190], [1650, 300],
        [200, 500], [960, 420], [1720, 500], [560, 660], [1360, 660], [960, 840]
      ]),
      gravity: PHYSICS.gravity * 1.08,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.09
    },
    {
      id: 'cloud-ascent',
      name: 'Cloud Ascent',
      act: 2,
      positionInAct: 2,
      background: 'cloudAscent',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [260, 240], [640, 170], [960, 140], [1280, 170], [1660, 240],
        [180, 470], [1740, 470], [700, 360], [1220, 360], [960, 580],
        [480, 720], [1440, 720]
      ]),
      gravity: PHYSICS.gravity * 1.12,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.12
    },
    {
      id: 'dream-space',
      name: 'Dream Space',
      act: 2,
      positionInAct: 3,
      background: 'dreamSpace',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -950 },
      bones: bonesGrid([
        [240, 220], [600, 150], [960, 120], [1320, 150], [1680, 220],
        [160, 440], [1760, 440], [680, 320], [1240, 320], [960, 540],
        [420, 680], [1500, 680], [960, 860]
      ]),
      gravity: PHYSICS.gravity * 1.16,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.15
    },

    // ---- Act 3: "From Frost to Flame" ----
    {
      id: 'mountain-crossing',
      name: 'Mountain Crossing',
      act: 3,
      positionInAct: 1,
      background: 'mountainCrossing',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [320, 260], [680, 190], [1040, 220], [1400, 190], [1660, 300],
        [220, 500], [960, 420], [1700, 500], [580, 660], [1340, 660], [960, 840]
      ]),
      gravity: PHYSICS.gravity * 1.20,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.18
    },
    {
      id: 'ore-lit-ravine',
      name: 'Ore-Lit Ravine',
      act: 3,
      positionInAct: 2,
      background: 'oreLitRavine',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 },
      bones: bonesGrid([
        [260, 240], [640, 170], [960, 140], [1280, 170], [1660, 240],
        [180, 470], [1740, 470], [700, 360], [1220, 360], [960, 580],
        [480, 720], [1440, 720]
      ]),
      gravity: PHYSICS.gravity * 1.24,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.21
    },
    {
      id: 'heart-of-the-deep',
      name: 'Heart of the Deep',
      act: 3,
      positionInAct: 3,
      background: 'heartOfTheDeep',
      basket: 'default',
      dogStart: { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -950 },
      bones: bonesGrid([
        [240, 220], [600, 150], [960, 120], [1320, 150], [1680, 220],
        [160, 440], [1760, 440], [680, 320], [1240, 320], [960, 540],
        [420, 680], [1500, 680], [960, 860]
      ]),
      gravity: PHYSICS.gravity * 1.28,
      bounceSpeed: PHYSICS.bounceSpeedMax * 1.24
    }
  ];

  // ---------------------------------------------------------------
  // Pup N Away basket-cosmetic equipment catalog — deliberately EMPTY
  // today. No basket skins have been supplied yet, so there is nothing
  // real to sell/own/equip; the Equipment screen (see
  // pup-n-away-menus.js) reads this exact array, so it correctly shows
  // an empty grid rather than any invented item. Ownership, once real
  // entries exist here, is validated against the EXISTING Quest Zone
  // inventory_items/equipped_items tables (slot 'pnaBasket') and the
  // existing equip_item() RPC — see getOwnedEquipment()/equipBasket() in
  // pup-n-away-integration.js — not a new, separate ownership system.
  // Add entries here (each server-side in item_definitions with
  // equipment_slot='pnaBasket') once real basket cosmetics are supplied;
  // nothing else in the Equipment screen needs to change.
  const EQUIPMENT_SLOT = 'pnaBasket';
  const EQUIPMENT_CATALOG = [];

  // ---------------------------------------------------------------
  // Challenge catalog — deliberately EMPTY today, same reasoning as
  // EQUIPMENT_CATALOG above: no real Pup N Away challenges have been
  // designed yet, so the Challenges screen (see pup-n-away-menus.js)
  // generates its cards directly from this array and correctly shows
  // none rather than inventing fake progress. Each future entry:
  // { id, tier ('bronze'|'silver'|'gold'|'platinum'|'diamond'|'mythic'),
  //   act, icon, title, description }. The screen already reads
  // tier/act to drive its tier-tab and Filter By Act controls, so
  // adding real challenges here needs no other code change.
  const CHALLENGE_CATALOG = [];

  window.PNA_CONFIG = {
    DESIGN_W, DESIGN_H,
    ASSETS, SPRITE_ANCHORS, COLLECTIBLE_TYPES, PHYSICS, LEVELS,
    UI_HOTSPOTS, EQUIPMENT_SLOT, EQUIPMENT_CATALOG, CHALLENGE_CATALOG,
    GAME_KEY: 'pup-n-away'
  };
})();
