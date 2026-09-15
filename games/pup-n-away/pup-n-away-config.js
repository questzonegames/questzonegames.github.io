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
      dreamTennisBall: IMG + 'collectibles/dream-tennis-ball.png',
      squeakyMoonToy: IMG + 'collectibles/squeaky-moon-toy.png',
      starDogBiscuit: IMG + 'collectibles/star-dog-biscuit.png'
    },

    backgrounds: {
      dreamBedroom: IMG + 'backgrounds/act1/dream-bedroom.png',
      backGarden: IMG + 'backgrounds/act1/back-garden.png',
      houseRooftop: IMG + 'backgrounds/act1/house-rooftop.png'
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

  // ---------------------------------------------------------------
  // Collectible type registry — data-driven so a new collectible only
  // ever needs a new entry here, never a physics/engine change.
  // ---------------------------------------------------------------
  const COLLECTIBLE_TYPES = {
    dreamBone: { asset: 'dreamBone', points: 100, radius: 46, active: true },
    goldenDreamBone: { asset: 'goldenDreamBone', points: 250, radius: 46, active: false },
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
    basketSpeed: 1300,             // px/s, max horizontal speed
    basketAcceleration: 9000,      // px/s^2 while a direction is held
    basketDeceleration: 12000,     // px/s^2 once released — brakes rather than sliding forever
    basketSquashMs: 130,           // brief visual squash on impact

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

    // ---- input smoothing ----
    pointerFollowLerp: 0.35        // mouse/touch basket-follow smoothing (0-1, higher = snappier)
  };

  // ---------------------------------------------------------------
  // Level manifest — each level is fully self-contained data; the
  // engine never branches on a level id or filename directly.
  // ---------------------------------------------------------------
  function bonesGrid(points) {
    return points.map(([x, y]) => ({ x, y }));
  }

  const LEVELS = [
    {
      id: 'dream-bedroom',
      name: 'Dream Bedroom',
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
    }
  ];

  window.PNA_CONFIG = {
    DESIGN_W, DESIGN_H,
    ASSETS, SPRITE_ANCHORS, COLLECTIBLE_TYPES, PHYSICS, LEVELS,
    GAME_KEY: 'pup-n-away'
  };
})();
