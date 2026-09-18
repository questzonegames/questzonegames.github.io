// ===== Pup N Away — level manager =====
//
// Thin wrapper around PNA_CONFIG.LEVELS — the engine never branches on
// a level id, filename or index directly outside this module. Every
// level identifies its own act/positionInAct (see pup-n-away-config.js)
// so act boundaries are read from that metadata, never assumed from
// array order or a hardcoded "3 levels per act" rule.
(function () {
  const LEVELS = window.PNA_CONFIG.LEVELS;

  function levelsInAct(actNumber) {
    return LEVELS.filter((l) => l.act === actNumber);
  }
  function isFinalLevelOfAct(level) {
    const act = levelsInAct(level.act);
    return level.positionInAct >= act.length;
  }
  function firstLevelIndexOfAct(actNumber) {
    return LEVELS.findIndex((l) => l.act === actNumber && l.positionInAct === 1);
  }
  function highestAct() {
    return LEVELS.reduce((max, l) => Math.max(max, l.act), 1);
  }

  // ---------------------------------------------------------------
  // Level Editor object <-> level-field conversion, shared by the
  // editor (pup-n-away-editor.js) and the runtime override loader
  // below. The editor only ever touches object PLACEMENT (dog/basket
  // spawn, bones) — background/gravity/bounceSpeed stay whatever the
  // static LEVELS entry says, always.
  //
  // The basket's own start Y is a fixed physics constant (the bounce
  // plane, see pup-n-away-basket.js), never per-level — basket_spawn's
  // y is carried for display only and ignored on load; only its x is
  // real. There's a hazards/boosters/wind category in the editor's
  // toolbar spec that has NO corresponding gameplay behavior in this
  // engine today (the physics/collision system only knows about bones
  // as collectibles) — those object types are deliberately not
  // included here; adding them for real is a physics-engine change,
  // not an editor-data-model change.
  // Editor asset types (snake_case, matching dog_spawn/basket_spawn/
  // dream_bone's own convention) <-> the real gameplay collectible
  // `type` keys in PNA_CONFIG.COLLECTIBLE_TYPES (camelCase) — these 4
  // are non-required pickups (see level.pickups below), each with its
  // own stable identity through save/load/publish, never collapsed
  // into a generic Dream Bone.
  const PICKUP_ASSET_TYPES = {
    golden_dream_bone: 'goldenDreamBone',
    golden_heart_biscuit: 'goldenHeartBiscuit',
    nightmare_bone: 'nightmareBone',
    freeze_time_biscuit: 'freezeTimeBiscuit'
  };
  const PICKUP_TYPES_BY_COLLECTIBLE = {};
  Object.keys(PICKUP_ASSET_TYPES).forEach((k) => { PICKUP_TYPES_BY_COLLECTIBLE[PICKUP_ASSET_TYPES[k]] = k; });
  // ---------------------------------------------------------------
  function levelToEditorObjects(level) {
    const CFG = window.PNA_CONFIG;
    const objects = [];
    objects.push({
      instanceId: 'dog-spawn',
      assetType: 'dog_spawn',
      x: level.dogStart.x, y: level.dogStart.y,
      rotation: 0, scale: 1, layer: 5, enabled: true,
      properties: { vx: level.dogStart.vx, vy: level.dogStart.vy }
    });
    objects.push({
      instanceId: 'basket-spawn',
      assetType: 'basket_spawn',
      x: (level.basketStart && typeof level.basketStart.x === 'number') ? level.basketStart.x : CFG.DESIGN_W / 2,
      y: (level.basketStart && typeof level.basketStart.y === 'number') ? level.basketStart.y : CFG.PHYSICS.basketDefaultSurfaceY,
      rotation: 0, scale: 1, layer: 5, enabled: true,
      properties: {}
    });
    (level.bones || []).forEach((b, i) => {
      objects.push({
        instanceId: 'bone-' + i + '-' + Math.random().toString(36).slice(2, 8),
        assetType: 'dream_bone',
        x: b.x, y: b.y,
        rotation: 0, scale: 1, layer: 4, enabled: true,
        properties: {}
      });
    });
    (level.pickups || []).forEach((p, i) => {
      const assetType = PICKUP_TYPES_BY_COLLECTIBLE[p.type];
      if (!assetType) return; // unknown/future pickup type — never crash the editor over it
      objects.push({
        instanceId: 'pickup-' + i + '-' + Math.random().toString(36).slice(2, 8),
        assetType,
        x: p.x, y: p.y,
        rotation: 0, scale: 1, layer: 4, enabled: true,
        properties: {}
      });
    });
    return objects;
  }

  function editorObjectsToLevelFields(objects) {
    const list = Array.isArray(objects) ? objects : [];
    const dogObj = list.find((o) => o.assetType === 'dog_spawn');
    const basketObj = list.find((o) => o.assetType === 'basket_spawn');
    const bones = list
      .filter((o) => o.assetType === 'dream_bone' && o.enabled !== false)
      .map((o) => ({ x: o.x, y: o.y }));
    const pickups = list
      .filter((o) => PICKUP_ASSET_TYPES[o.assetType] && o.enabled !== false)
      .map((o) => ({ x: o.x, y: o.y, type: PICKUP_ASSET_TYPES[o.assetType] }));
    const fields = { bones, pickups };
    if (dogObj) {
      const p = dogObj.properties || {};
      fields.dogStart = { x: dogObj.x, y: dogObj.y, vx: p.vx || 0, vy: typeof p.vy === 'number' ? p.vy : -900 };
    }
    if (basketObj) fields.basketStart = { x: basketObj.x, y: basketObj.y };
    return fields;
  }

  function createLevelManager() {
    let index = 0;
    // levelId -> { dogStart?, basketStart?, bones? } — a published (or,
    // during Playtest, unsaved-draft) editor layout overriding the
    // static level's own object placement. See
    // resolvePublishedLevelOverrides() in pup-n-away.js.
    const overrides = {};
    function setLevelOverride(levelId, fields) { overrides[levelId] = fields; }
    function clearLevelOverride(levelId) { delete overrides[levelId]; }
    function getLevelOverride(levelId) { return overrides[levelId] || null; }

    function current() {
      const base = LEVELS[index];
      const ov = overrides[base.id];
      return ov ? Object.assign({}, base, ov) : base;
    }
    function currentNumber() { return index + 1; }
    function totalLevels() { return LEVELS.length; }
    function isLastLevel() { return index >= LEVELS.length - 1; }
    function advance() { if (!isLastLevel()) index++; return current(); }
    function reset() { index = 0; return current(); }
    function backgroundKey(level) { return 'backgrounds.' + level.background; }

    // Jumps to the first level of a given act (e.g. restarting the
    // current act after Game Over) — falls back to level 0 if that act
    // somehow doesn't exist rather than throwing.
    function goToActStart(actNumber) {
      const i = firstLevelIndexOfAct(actNumber);
      index = i >= 0 ? i : 0;
      return current();
    }

    // Used by Level Select (pick any unlocked level directly) and by
    // the Lobby's "resume at next incomplete level" logic — both jump
    // straight to a specific level rather than always starting/
    // advancing sequentially.
    function goToIndex(i) {
      if (i >= 0 && i < LEVELS.length) index = i;
      return current();
    }
    function goToLevelId(levelId) {
      const i = LEVELS.findIndex((l) => l.id === levelId);
      return goToIndex(i >= 0 ? i : 0);
    }
    function all() { return LEVELS; }

    return {
      current, currentNumber, totalLevels, isLastLevel, advance, reset, backgroundKey,
      goToActStart, goToIndex, goToLevelId, all, firstLevelIndexOfAct,
      isFinalLevelOfAct: () => isFinalLevelOfAct(current()),
      nextActExists: () => LEVELS.some((l) => l.act === current().act + 1),
      highestAct,
      setLevelOverride, clearLevelOverride, getLevelOverride,
      levelToEditorObjects, editorObjectsToLevelFields
    };
  }

  window.PNA_Levels = { createLevelManager };
})();
