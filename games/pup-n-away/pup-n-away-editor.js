// ===== Pup N Away — admin Level Editor =====
//
// MVP scope (see the implementation report handed back with this
// feature for what's deferred): select/move/add/remove/duplicate/lock
// the object types this engine actually has real behavior for today —
// the level's one Dog Start Position, its one Basket Start Position
// (always present, never toolbar assets, never removable/duplicable),
// and any number of Dream Bones (the only real spawnable asset today).
// Hazards, boosters, wind, movement paths and per-type width/height/
// rotation editing are NOT implemented because the physics/collision
// engine has no corresponding behavior for them yet — adding fake
// controls for systems that don't exist would be a mock, not a real
// editor.
//
// Every load/save/publish/restore call goes through
// PNA_Integration.getLevelEditorData()/saveLevelDraft()/publishLevel()/
// restoreLevelVersion(), each of which calls a SECURITY DEFINER RPC
// that re-checks public.is_admin() itself server-side (see
// supabase/migrations/20260919010000_pup_n_away_level_layouts.sql) —
// this module never trusts profile.is_admin for anything but whether
// to SHOW its own launch button/UI.
(function () {
  function createEditor(deps) {
    const { canvas, images, CFG, levels, integration, audio, ui, startPlaytest, onExitToLobby, resizeCanvasForDPR } = deps;
    const DESIGN_W = CFG.DESIGN_W, DESIGN_H = CFG.DESIGN_H;
    const BONE_RADIUS = CFG.COLLECTIBLE_TYPES.dreamBone.radius;
    const HISTORY_LIMIT = 60;

    // Matches pup-n-away-basket.js's fixed bounce-plane Y (state.y =
    // CFG.DESIGN_H - 90, never overridden per-level) and the dogStart Y
    // every static PNA_CONFIG.LEVELS entry actually uses. These are
    // deliberate, named defaults — never guessed from whatever the
    // level happened to be edited to.
    const BASKET_BASELINE_Y = DESIGN_H - 90;
    const DEFAULT_BASKET_POSITION = { x: DESIGN_W / 2, y: BASKET_BASELINE_Y };
    const DEFAULT_DOG_POSITION = { x: DESIGN_W / 2, y: DESIGN_H - 260, vx: 0, vy: -900 };
    // Dog Start Position is vertical-movement-only, the mirror image of
    // the basket's horizontal-only rule — its X is permanently pinned
    // to the level's exact horizontal centre. Y bounds are padded by
    // its own icon radius so it can never render half off-screen.
    const DOG_FIXED_X = DESIGN_W / 2;
    const DOG_MIN_Y = 56;
    const DOG_MAX_Y = DESIGN_H - 56;

    const el = {
      topbar: document.getElementById('pna-editor-topbar'),
      toolbar: document.getElementById('pna-editor-toolbar'),
      toolbarArt: document.getElementById('pna-editor-toolbar-art'),
      toolbarSlots: document.getElementById('pna-editor-toolbar-slots'),
      props: document.getElementById('pna-editor-props'),
      propsBody: document.getElementById('pna-editor-props-body'),
      selectionStatusBody: document.getElementById('pna-editor-selection-status-body'),
      spawnedAssetsList: document.getElementById('pna-editor-spawned-assets-list'),
      actSelect: document.getElementById('pna-editor-act-select'),
      levelSelect: document.getElementById('pna-editor-level-select'),
      levelName: document.getElementById('pna-editor-level-name'),
      unsavedDot: document.getElementById('pna-editor-unsaved-dot'),
      undoBtn: document.getElementById('pna-editor-undo'),
      redoBtn: document.getElementById('pna-editor-redo'),
      gridBtn: document.getElementById('pna-editor-grid-toggle'),
      snapBtn: document.getElementById('pna-editor-snap-toggle'),
      hitboxBtn: document.getElementById('pna-editor-hitbox-toggle'),
      zoomOutBtn: document.getElementById('pna-editor-zoom-out'),
      zoomInBtn: document.getElementById('pna-editor-zoom-in'),
      zoomResetBtn: document.getElementById('pna-editor-zoom-reset'),
      zoomValue: document.getElementById('pna-editor-zoom-value'),
      playtestBtn: document.getElementById('pna-editor-playtest'),
      saveDraftBtn: document.getElementById('pna-editor-save-draft'),
      publishBtn: document.getElementById('pna-editor-publish'),
      exitBtn: document.getElementById('pna-editor-exit'),
      dragReadout: document.getElementById('pna-editor-drag-readout')
    };

    // Measured directly off assets/img/pup-n-away/ui/editor/admin-tool.png
    // (a percentage-gridline overlay read at 1% steps, same method as
    // every other PNA_CONFIG.UI_HOTSPOTS entry) — the top-left slot of
    // its 3-column x 7-row grid. Every other slot is left genuinely
    // empty (per the brief); this is the only one wired up, since
    // Dream Bone is the only real spawnable asset today.
    const TOOLBAR_SLOT_1 = { left: 26.0, width: 13.5, top: 21.0, height: 11.5 };

    const DREAM_BONE_DEF = { assetType: 'dream_bone', label: 'Dream Bone', imgKey: 'collectibles.dreamBone' };

    let isOpen = false;
    let currentLevelId = null;
    let objects = [];
    let baseline = [];
    let selectedId = null;
    let history = [];
    let future = [];
    let dragState = null; // { id, offsetX, offsetY, moved, historyPushed }
    let placingType = null; // toolbar "click to arm" placement mode
    let toolbarDragGhost = null; // toolbar "drag out" placement
    let showGrid = false, snapToGrid = false, showHitboxes = false;
    let zoom = 1;
    let versions = [];
    let publishedVersion = null;
    let bgImage = null;
    let contextMenuEl = null;
    let wired = false;

    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function isDirty() { return JSON.stringify(objects) !== JSON.stringify(baseline); }
    function newInstanceId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
    function isLocked(o) { return !!o.locked; }
    function findObj(id) { return objects.find((o) => o.instanceId === id); }

    function pushHistory() {
      history.push(clone(objects));
      if (history.length > HISTORY_LIMIT) history.shift();
      future = [];
    }
    function undo() {
      if (!history.length) return;
      future.push(clone(objects));
      objects = history.pop();
      if (selectedId && !objects.some((o) => o.instanceId === selectedId)) selectedId = null;
      renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
    }
    function redo() {
      if (!future.length) return;
      history.push(clone(objects));
      objects = future.pop();
      if (selectedId && !objects.some((o) => o.instanceId === selectedId)) selectedId = null;
      renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
    }

    // Every level always has exactly one dog_spawn and one basket_spawn
    // — inserted here (using the named defaults, never guessed) if a
    // legacy/older saved layout doesn't have one, and the basket is
    // always clamped back onto its fixed baseline regardless of what
    // was saved. Called on every load, so it's impossible for the
    // editor to ever end up with zero or two of either.
    function ensureRequiredObjects(list) {
      const out = list.filter((o) => o.assetType !== 'dog_spawn' && o.assetType !== 'basket_spawn');
      const dog = list.find((o) => o.assetType === 'dog_spawn');
      const basket = list.find((o) => o.assetType === 'basket_spawn');
      out.unshift(basket ? Object.assign({}, basket, { y: BASKET_BASELINE_Y }) : {
        instanceId: 'basket-spawn', assetType: 'basket_spawn',
        x: DEFAULT_BASKET_POSITION.x, y: BASKET_BASELINE_Y,
        rotation: 0, scale: 1, layer: 5, enabled: true, locked: false, properties: {}
      });
      out.unshift(dog ? Object.assign({}, clone(dog), { x: DOG_FIXED_X, y: clampDogY(dog.y) }) : {
        instanceId: 'dog-spawn', assetType: 'dog_spawn',
        x: DOG_FIXED_X, y: DEFAULT_DOG_POSITION.y,
        rotation: 0, scale: 1, layer: 5, enabled: true, locked: false,
        properties: { vx: DEFAULT_DOG_POSITION.vx, vy: DEFAULT_DOG_POSITION.vy }
      });
      return out;
    }

    // ---------------------------------------------------------------
    // Open / close / level switching
    // ---------------------------------------------------------------
    async function open(opts) {
      opts = opts || {};
      wireOnce();
      // The editor draws directly onto the SAME #pna-canvas the game
      // uses (see tick()/draw()) — any still-visible menu overlay
      // (Lobby, Level Select, ...) would otherwise sit on top of it,
      // both visually and for clicks, since overlays are separate
      // absolutely-positioned DOM elements, not part of the canvas.
      ui.showScreen(null);
      ui.setHudVisible(false);
      document.body.classList.add('pna-editor-mode');
      isOpen = true;
      buildLevelPickers();
      buildToolbarSlots();
      const wantLevelId = opts.reopenLevelId || currentLevelId || levels.all()[0].id;
      const ok = await loadLevel(wantLevelId, { force: true, silentIfForbidden: true });
      if (!ok) { close({ skipConfirm: true }); return false; }
      return true;
    }

    function close(opts) {
      opts = opts || {};
      if (!opts.skipConfirm && isDirty()) {
        const ok = window.confirm('You have unsaved changes in the Level Editor. Leave without saving?');
        if (!ok) return false;
      }
      isOpen = false;
      document.body.classList.remove('pna-editor-mode');
      closeContextMenu();
      if (onExitToLobby) onExitToLobby();
      return true;
    }

    async function loadLevel(levelId, opts) {
      opts = opts || {};
      if (!opts.force && isDirty()) {
        const ok = window.confirm('You have unsaved changes on this level. Switch levels without saving?');
        if (!ok) return false;
      }
      setStatus('Loading level…', false);
      try {
        const data = await integration.getLevelEditorData(levelId);
        const staticLevel = levels.all().find((l) => l.id === levelId);
        let loaded;
        if (data && data.draftObjects) loaded = data.draftObjects;
        else if (data && data.publishedObjects) loaded = data.publishedObjects;
        else loaded = levels.levelToEditorObjects(staticLevel);
        currentLevelId = levelId;
        objects = ensureRequiredObjects(clone(loaded));
        baseline = clone(objects);
        publishedVersion = data ? data.publishedVersion : null;
        selectedId = null;
        history = []; future = [];
        bgImage = images[levels.backgroundKey(staticLevel)] || null;
        syncLevelPickers();
        renderProps();
        renderSelectionStatus();
        setStatus('', false);
        draw();
        updateToolbarState();
        loadVersions();
        return true;
      } catch (err) {
        if (opts.silentIfForbidden) return false;
        setStatus('Could not load this level: ' + (err && err.message ? err.message : 'unknown error'), true);
        return false;
      }
    }

    async function loadVersions() {
      try { versions = await integration.listLevelVersions(currentLevelId); }
      catch (err) { versions = []; }
    }

    // ---------------------------------------------------------------
    // Level pickers (Act / Level / Name) — built dynamically from
    // levels.all(), so a future Act 2+ needs no editor change.
    // ---------------------------------------------------------------
    function buildLevelPickers() {
      const acts = [...new Set(levels.all().map((l) => l.act))].sort((a, b) => a - b);
      el.actSelect.innerHTML = acts.map((a) => '<option value="' + a + '">Act ' + a + '</option>').join('');
      el.actSelect.onchange = () => { buildLevelSelectForAct(parseInt(el.actSelect.value, 10)); switchToPickedLevel(); };
      el.levelSelect.onchange = () => switchToPickedLevel();
    }
    function buildLevelSelectForAct(actNumber) {
      const inAct = levels.all().filter((l) => l.act === actNumber).sort((a, b) => a.positionInAct - b.positionInAct);
      el.levelSelect.innerHTML = inAct.map((l) =>
        '<option value="' + l.id + '">Level ' + l.positionInAct + ' — ' + l.name + '</option>').join('');
    }
    function switchToPickedLevel() {
      const id = el.levelSelect.value;
      if (id && id !== currentLevelId) loadLevel(id, {});
    }
    function syncLevelPickers() {
      const level = levels.all().find((l) => l.id === currentLevelId);
      if (!level) return;
      el.actSelect.value = String(level.act);
      buildLevelSelectForAct(level.act);
      el.levelSelect.value = level.id;
      el.levelName.textContent = level.name;
    }

    // ---------------------------------------------------------------
    // Left ADMIN toolbar — the real supplied 3-column graphic, shown
    // whole and uncropped; only its first slot gets a real interactive
    // hotspot (Dream Bone, the only actual spawnable asset). Every
    // other slot is genuinely left empty, per the brief.
    // ---------------------------------------------------------------
    function buildToolbarSlots() {
      el.toolbarSlots.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pna-editor-asset-slot';
      btn.id = 'pna-editor-asset-dream-bone';
      btn.style.left = TOOLBAR_SLOT_1.left + '%';
      btn.style.top = TOOLBAR_SLOT_1.top + '%';
      btn.style.width = TOOLBAR_SLOT_1.width + '%';
      btn.style.height = TOOLBAR_SLOT_1.height + '%';
      btn.setAttribute('aria-label', 'Dream Bone — click to arm placement, or drag onto the level');
      btn.title = 'Dream Bone';
      const img = document.createElement('img');
      img.alt = ''; img.draggable = false;
      if (images[DREAM_BONE_DEF.imgKey]) img.src = images[DREAM_BONE_DEF.imgKey].src;
      btn.appendChild(img);
      btn.addEventListener('click', () => armPlacement());
      btn.addEventListener('pointerdown', onToolbarPointerDown);
      el.toolbarSlots.appendChild(btn);
    }
    function armPlacement() {
      audio.play('buttonClick');
      placingType = placingType === 'dream_bone' ? null : 'dream_bone';
      if (placingType) selectedId = null; // "READY TO PLACE" must win over any prior selection
      const slot = document.getElementById('pna-editor-asset-dream-bone');
      if (slot) slot.classList.toggle('pna-editor-asset-armed', !!placingType);
      renderProps(); renderSelectionStatus(); draw();
    }

    // Drag-out-of-toolbar placement: pointerdown on the slot starts a
    // ghost image following the pointer; releasing over the stage
    // creates a new Dream Bone there, releasing elsewhere cancels.
    function onToolbarPointerDown(e) {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      function ensureGhost() {
        if (toolbarDragGhost) return;
        toolbarDragGhost = document.createElement('img');
        toolbarDragGhost.src = images[DREAM_BONE_DEF.imgKey] ? images[DREAM_BONE_DEF.imgKey].src : '';
        toolbarDragGhost.style.cssText = 'position:fixed;z-index:80;width:44px;height:44px;object-fit:contain;' +
          'pointer-events:none;opacity:0.85;transform:translate(-50%,-50%);filter:drop-shadow(0 2px 8px rgba(0,0,0,0.6));';
        document.body.appendChild(toolbarDragGhost);
      }
      function move(ev) {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > 6) { dragging = true; ensureGhost(); placingType = null; closeArmedVisual(); }
        if (dragging && toolbarDragGhost) { toolbarDragGhost.style.left = ev.clientX + 'px'; toolbarDragGhost.style.top = ev.clientY + 'px'; }
      }
      function up(ev) {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (toolbarDragGhost) { toolbarDragGhost.remove(); toolbarDragGhost = null; }
        if (!dragging) return; // a plain click — armPlacement()'s own click handler covers that
        const rect = canvas.getBoundingClientRect();
        const inside = ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        if (!inside) return; // released outside the stage — cancelled
        const p = toDesignSpace(ev.clientX, ev.clientY);
        createBoneAt(p.x, p.y);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    function closeArmedVisual() {
      const slot = document.getElementById('pna-editor-asset-dream-bone');
      if (slot) slot.classList.remove('pna-editor-asset-armed');
    }
    function createBoneAt(x, y) {
      pushHistory();
      const obj = {
        instanceId: newInstanceId('dream_bone'),
        assetType: 'dream_bone',
        x: Math.round(clampX(snap(x))), y: Math.round(clampY(snap(y))),
        rotation: 0, scale: 1, layer: 4, enabled: true, locked: false, properties: {}
      };
      objects.push(obj);
      selectedId = obj.instanceId;
      markDirtyUI(); renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
    }

    // ---------------------------------------------------------------
    // Canvas <-> design-space coordinate conversion — uses the REAL
    // rendered bounds every time (never cached), so it stays correct
    // across resize/zoom. This SAME function backs rendering,
    // selection, dragging, hitboxes and saving — never a second,
    // divergent conversion.
    // ---------------------------------------------------------------
    function toDesignSpace(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * DESIGN_W,
        y: ((clientY - rect.top) / rect.height) * DESIGN_H
      };
    }
    function toCanvasSpace(x, y) {
      const rect = canvas.getBoundingClientRect();
      return { x: (x / DESIGN_W) * rect.width, y: (y / DESIGN_H) * rect.height };
    }
    function snap(v) { return snapToGrid ? Math.round(v / 20) * 20 : v; }
    function iconRadiusFor(assetType) { return assetType === 'dream_bone' ? BONE_RADIUS : 56; }
    function clampX(x) { return Math.max(0, Math.min(DESIGN_W, x)); }
    function clampY(y) { return Math.max(0, Math.min(DESIGN_H, y)); }
    function clampDogY(y) { return Math.max(DOG_MIN_Y, Math.min(DOG_MAX_Y, y)); }

    // ---------------------------------------------------------------
    // Drawing — editor layer order (background -> grid -> placed
    // objects -> hitboxes -> selection outline -> lock badge) matches
    // the brief. The editor owns the canvas entirely while open (real
    // gameplay is fully paused — see pup-n-away.js's loop()).
    // ---------------------------------------------------------------
    // Sets #pna-canvas's CSS width/height IN JS, in px, from #pna-
    // stage-wrap's own measured box — deliberately not left to CSS
    // aspect-ratio (see the long comment on body.pna-editor-mode
    // #pna-canvas in index.html for the circular-dependency bug that
    // caused). Safe to call every time draw() runs; a no-op cost when
    // the box hasn't changed.
    function layoutStage() {
      const wrap = document.getElementById('pna-stage-wrap');
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (w <= 0 || h <= 0) return; // not laid out yet — try again next draw()
      const targetRatio = DESIGN_W / DESIGN_H;
      let cssW, cssH;
      if (w / h > targetRatio) { cssH = h; cssW = h * targetRatio; }
      else { cssW = w; cssH = w / targetRatio; }
      canvas.style.width = Math.round(cssW) + 'px';
      canvas.style.height = Math.round(cssH) + 'px';
    }

    function draw() {
      // Synced HERE, not left to wait for the next requestAnimationFrame
      // tick — draw() can be called directly from loadLevel()/open()
      // before the game's own rAF loop has run even once at the
      // editor's new CSS layout size, which was the real cause of the
      // canvas showing a stale, undersized bitmap (its CSS box was
      // already correctly 16:9, but its backing store/drawn pixels
      // were still whatever an earlier, smaller layout had produced).
      layoutStage();
      // resizeCanvasForDPR() (in pup-n-away.js) already sets the
      // canvas's BASE transform to design-space scale via
      // ctx.setTransform(scaleX,0,0,scaleY,0,0) — the same convention
      // every other draw() in this game relies on (dog/basket/
      // collectibles all draw directly in 1920x1080 design
      // coordinates, unscaled). Applying a SECOND ctx.scale() here on
      // top of that (as an earlier version of this function did) was
      // the actual cause of the background/objects rendering
      // compressed into a small corner — the two scales multiplied
      // together instead of one replacing the other.
      if (resizeCanvasForDPR) resizeCanvasForDPR();
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

      if (bgImage) ctx.drawImage(bgImage, 0, 0, DESIGN_W, DESIGN_H);
      else { ctx.fillStyle = '#0a1230'; ctx.fillRect(0, 0, DESIGN_W, DESIGN_H); }

      if (showGrid) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        for (let x = 0; x <= DESIGN_W; x += 20 * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, DESIGN_H); ctx.stroke(); }
        for (let y = 0; y <= DESIGN_H; y += 20 * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(DESIGN_W, y); ctx.stroke(); }
      }

      // Editor-only guide showing the basket's fixed horizontal line —
      // never drawn during normal gameplay (this whole module never
      // runs then).
      ctx.save();
      ctx.strokeStyle = 'rgba(255,214,107,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(0, BASKET_BASELINE_Y); ctx.lineTo(DESIGN_W, BASKET_BASELINE_Y); ctx.stroke();
      ctx.restore();

      const drawOrder = objects.slice().sort((a, b) => (a.layer || 0) - (b.layer || 0));
      drawOrder.forEach((o) => {
        const img = imgFor(o);
        const r = iconRadiusFor(o.assetType);
        ctx.save();
        ctx.globalAlpha = o.enabled === false ? 0.35 : 1;
        if (img) ctx.drawImage(img, o.x - r, o.y - r, r * 2, r * 2);
        else { ctx.fillStyle = '#ffd66b'; ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();

        if (showHitboxes && o.assetType === 'dream_bone') {
          ctx.save();
          ctx.strokeStyle = '#2dff8f'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(o.x, o.y, BONE_RADIUS, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }

        if (o.instanceId === selectedId) {
          ctx.save();
          ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
          ctx.strokeRect(o.x - r - 6, o.y - r - 6, (r + 6) * 2, (r + 6) * 2);
          ctx.restore();
        }
        if (o.locked) {
          ctx.save();
          ctx.fillStyle = '#ffb84d'; ctx.font = 'bold ' + Math.round(r * 0.5) + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(10,16,40,0.9)'; ctx.lineWidth = 3;
          ctx.strokeText('🔒', o.x + r * 0.7, o.y - r * 0.7);
          ctx.fillText('🔒', o.x + r * 0.7, o.y - r * 0.7);
          ctx.restore();
        }
      });
      ctx.restore();
    }
    function imgFor(o) {
      if (o.assetType === 'dog_spawn') return images.dogSit;
      if (o.assetType === 'basket_spawn') return images['baskets.default'];
      if (o.assetType === 'dream_bone') return images[DREAM_BONE_DEF.imgKey];
      return null;
    }
    function labelFor(assetType) {
      if (assetType === 'dog_spawn') return 'DOG START POSITION';
      if (assetType === 'basket_spawn') return 'BASKET START POSITION';
      if (assetType === 'dream_bone') return 'DREAM BONE';
      return assetType;
    }

    // ---------------------------------------------------------------
    // Pointer interaction — select, drag-move (with setPointerCapture
    // so a fast cursor movement never drops the drag), click-to-place,
    // and the right-click context menu. Topmost object (by array/paint
    // order, i.e. last drawn) wins when objects overlap.
    // ---------------------------------------------------------------
    // Hit-tests in the SAME visual stacking order draw() paints in
    // (ascending layer, so higher layer = drawn later = on top), and
    // picks the topmost match — matching what the admin actually sees,
    // not raw array/insertion order (two objects, e.g. a bone and the
    // dog spawn, can legitimately share the exact same design-space
    // point).
    function hitTest(x, y) {
      const drawOrder = objects.slice().sort((a, b) => (a.layer || 0) - (b.layer || 0));
      for (let i = drawOrder.length - 1; i >= 0; i--) {
        const o = drawOrder[i];
        const r = iconRadiusFor(o.assetType);
        if (Math.hypot(o.x - x, o.y - y) <= r) return o;
      }
      return null;
    }

    function onPointerDown(e) {
      if (!isOpen || e.button === 2) return;
      const p = toDesignSpace(e.clientX, e.clientY);
      closeContextMenu();

      if (placingType) {
        createBoneAt(p.x, p.y);
        placingType = null;
        closeArmedVisual();
        return;
      }

      const hit = hitTest(p.x, p.y);
      selectedId = hit ? hit.instanceId : null;
      renderProps(); renderSelectionStatus(); draw();
      if (hit) {
        // Guarded: setPointerCapture() can throw (NotFoundError) if the
        // browser doesn't consider this pointerId "active" at the exact
        // moment it's called — must never abort selection/drag setup.
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* drag still proceeds via normal bubbling */ }
        dragState = {
          id: hit.instanceId, pointerId: e.pointerId,
          offsetX: p.x - hit.x, offsetY: p.y - hit.y,
          moved: false, historyPushed: false
        };
      }
    }
    function onPointerMove(e) {
      if (!isOpen || !dragState || dragState.pointerId !== e.pointerId) return;
      const o = findObj(dragState.id);
      if (!o || isLocked(o)) return;
      if (!dragState.historyPushed) { pushHistory(); dragState.historyPushed = true; } // one drag = one undo entry
      const p = toDesignSpace(e.clientX, e.clientY);
      const nx = clampX(snap(p.x - dragState.offsetX));
      const ny = clampY(snap(p.y - dragState.offsetY));
      // Basket is horizontal-only, permanently — vertical pointer
      // movement is completely ignored while dragging it. Dog Start
      // Position is the mirror image: vertical-only, permanently
      // pinned to the level's horizontal centre — horizontal pointer
      // movement is completely ignored while dragging it.
      if (o.assetType === 'dog_spawn') {
        o.x = DOG_FIXED_X;
        o.y = Math.round(clampDogY(snap(p.y - dragState.offsetY)));
      } else {
        o.x = Math.round(nx);
        o.y = o.assetType === 'basket_spawn' ? BASKET_BASELINE_Y : Math.round(ny);
      }
      dragState.moved = true;
      draw();
      el.dragReadout.style.display = 'block';
      const cs = toCanvasSpace(o.x, o.y);
      const rect = canvas.getBoundingClientRect();
      el.dragReadout.style.left = (rect.left + cs.x) + 'px';
      el.dragReadout.style.top = (rect.top + cs.y) + 'px';
      el.dragReadout.textContent = 'x: ' + Math.round(o.x) + '  y: ' + Math.round(o.y);
      renderProps(); renderSelectionStatus();
    }
    function onPointerUp(e) {
      if (!isOpen || !dragState || dragState.pointerId !== e.pointerId) return;
      try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (dragState.historyPushed && !dragState.moved) history.pop(); // captured but never actually moved
      if (dragState.moved) { markDirtyUI(); renderProps(); renderSelectionStatus(); }
      dragState = null;
      el.dragReadout.style.display = 'none';
      updateToolbarState();
    }

    function onContextMenu(e) {
      if (!isOpen) return;
      e.preventDefault();
      const p = toDesignSpace(e.clientX, e.clientY);
      const hit = hitTest(p.x, p.y);
      if (!hit) return; // native menu stays suppressed only over the stage in general use; nothing to show here
      selectedId = hit.instanceId; renderProps(); renderSelectionStatus(); draw();
      openContextMenu(e.clientX, e.clientY, hit);
    }
    function openContextMenu(clientX, clientY, obj) {
      closeContextMenu();
      const menu = document.createElement('div');
      menu.className = 'pna-editor-context-menu';
      menu.style.left = clientX + 'px'; menu.style.top = clientY + 'px';
      const isProtected = obj.assetType === 'dog_spawn' || obj.assetType === 'basket_spawn';

      addItem(!isLocked(obj) ? 'Lock Position' : 'Unlock Position', () => toggleLock(obj.instanceId));
      if (!isProtected) addItem('Duplicate Asset', () => duplicateObject(obj.instanceId));
      if (isProtected) addItem('Set to Default Position', () => resetToDefault(obj.instanceId));
      if (!isProtected) {
        const removeBtn = addItem('Remove Asset', () => removeObject(obj.instanceId));
        removeBtn.classList.add('pna-editor-btn-danger');
      }
      addItem('Cancel', closeContextMenu);

      function addItem(label, handler) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.addEventListener('click', () => { handler(); closeContextMenu(); });
        menu.appendChild(b);
        return b;
      }
      document.body.appendChild(menu);
      contextMenuEl = menu;
    }
    function closeContextMenu() { if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; } }

    function toggleLock(instanceId) {
      const o = findObj(instanceId);
      if (!o) return;
      pushHistory();
      o.locked = !o.locked;
      markDirtyUI(); renderProps(); renderSelectionStatus(); draw();
    }
    function resetToDefault(instanceId) {
      const o = findObj(instanceId);
      if (!o || isLocked(o)) return;
      pushHistory();
      if (o.assetType === 'dog_spawn') {
        o.x = DEFAULT_DOG_POSITION.x; o.y = DEFAULT_DOG_POSITION.y;
        o.properties = { vx: DEFAULT_DOG_POSITION.vx, vy: DEFAULT_DOG_POSITION.vy };
      } else if (o.assetType === 'basket_spawn') {
        o.x = DEFAULT_BASKET_POSITION.x; o.y = BASKET_BASELINE_Y;
      }
      markDirtyUI(); renderProps(); renderSelectionStatus(); draw();
    }
    function duplicateObject(instanceId) {
      const o = findObj(instanceId);
      if (!o || o.assetType !== 'dream_bone') return; // only Dream Bones may be duplicated
      pushHistory();
      const copy = clone(o);
      copy.instanceId = newInstanceId('dream_bone');
      copy.locked = false;
      copy.x = Math.min(DESIGN_W, o.x + 40);
      copy.y = Math.min(DESIGN_H, o.y + 40);
      objects.push(copy);
      selectedId = copy.instanceId;
      markDirtyUI(); renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
    }
    function removeObject(instanceId) {
      const o = findObj(instanceId);
      if (!o || o.assetType !== 'dream_bone') return; // dog/basket can never be removed
      pushHistory();
      objects = objects.filter((x) => x.instanceId !== instanceId);
      if (selectedId === instanceId) selectedId = null;
      markDirtyUI(); renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
    }

    // ---------------------------------------------------------------
    // Selection status panel (item 10 in the brief) — a small
    // persistent panel next to the toolbar, never a browser alert().
    // ---------------------------------------------------------------
    function renderSelectionStatus() {
      const o = findObj(selectedId);
      if (!o) {
        el.selectionStatusBody.textContent = placingType === 'dream_bone' ? 'DREAM BONE READY TO PLACE' : 'NO ASSET SELECTED';
      } else {
        const lockSpan = '<span class="' + (o.locked ? 'pna-editor-status-locked">Locked' : 'pna-editor-status-unlocked">Unlocked') + '</span>';
        el.selectionStatusBody.innerHTML =
          labelFor(o.assetType) + ' SELECTED<br>' + lockSpan +
          '<br><span class="pna-editor-status-coords">x: ' + Math.round(o.x) + '  y: ' + Math.round(o.y) + '</span>';
      }
      renderSpawnedAssets();
    }

    // ---------------------------------------------------------------
    // Spawned Assets panel — every currently placed object, live.
    // Bones are numbered in placement order (Dream Bone 1, 2, 3...),
    // matching how an admin actually thinks about "the level's bones",
    // not their internal instance IDs.
    // ---------------------------------------------------------------
    function renderSpawnedAssets() {
      el.spawnedAssetsList.innerHTML = '';
      let boneN = 0;
      const ordered = objects.slice().sort((a, b) => {
        const rank = (o) => o.assetType === 'dog_spawn' ? 0 : o.assetType === 'basket_spawn' ? 1 : 2;
        return rank(a) - rank(b);
      });
      ordered.forEach((o) => {
        const isBone = o.assetType === 'dream_bone';
        if (isBone) boneN++;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'pna-editor-spawn-row' + (o.instanceId === selectedId ? ' pna-editor-spawn-row-selected' : '');
        const img = document.createElement('img');
        img.alt = ''; img.draggable = false;
        const imgSrc = imgFor(o);
        if (imgSrc) img.src = imgSrc.src;
        row.appendChild(img);
        const label = document.createElement('span');
        label.className = 'pna-editor-spawn-row-label';
        label.textContent = isBone ? 'Dream Bone ' + boneN : toTitleCase(labelFor(o.assetType));
        row.appendChild(label);
        const lock = document.createElement('span');
        lock.className = 'pna-editor-spawn-row-lock';
        lock.textContent = o.locked ? '🔒' : '';
        row.appendChild(lock);
        row.addEventListener('click', () => {
          selectedId = o.instanceId; placingType = null; closeArmedVisual();
          renderProps(); renderSelectionStatus(); draw();
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          selectedId = o.instanceId; renderProps(); renderSelectionStatus(); draw();
          openContextMenu(e.clientX, e.clientY, o);
        });
        el.spawnedAssetsList.appendChild(row);
      });
    }
    function toTitleCase(s) { return s.replace(/\w\S*/g, (t) => t.charAt(0) + t.substr(1).toLowerCase()); }

    // ---------------------------------------------------------------
    // Properties panel — direct mouse interaction is the primary
    // editing method (see onPointerDown/Move above); this panel is for
    // precise adjustment on top of that, not the only way to move
    // something.
    // ---------------------------------------------------------------
    function renderProps() {
      const o = findObj(selectedId);
      if (!o) { el.propsBody.innerHTML = '<div class="pna-editor-props-empty">Select an object to edit its properties, or click a toolbar asset to place a new one.</div>'; return; }
      const locked = isLocked(o);
      const isBasket = o.assetType === 'basket_spawn';
      const isDog = o.assetType === 'dog_spawn';
      const isProtected = isDog || isBasket;
      let html = '<div class="pna-editor-props-id">' + labelFor(o.assetType) + '<br>' + o.instanceId + '</div>';
      html += field('X', 'x', Math.round(o.x), locked || isDog, isDog ? 'Permanently centred — never editable.' : '');
      html += field('Y', 'y', Math.round(o.y), locked || isBasket, isBasket ? 'Fixed to the gameplay baseline — never editable.' : '');
      if (o.assetType === 'dog_spawn') {
        html += field('Launch VX', 'vx', (o.properties && o.properties.vx) || 0, locked);
        html += field('Launch VY', 'vy', (o.properties && o.properties.vy) || 0, locked);
      }
      html += '<div class="pna-editor-field pna-editor-field-row"><input type="checkbox" id="pna-editor-prop-locked" ' + (locked ? 'checked' : '') + '><label for="pna-editor-prop-locked">Locked</label></div>';
      html += '<div class="pna-editor-props-actions">';
      if (isProtected) html += '<button type="button" class="pna-editor-btn" id="pna-editor-prop-default">Set to Default</button>';
      if (!isProtected) {
        html += '<button type="button" class="pna-editor-btn" id="pna-editor-prop-duplicate" ' + (locked ? 'disabled' : '') + '>Duplicate</button>';
        html += '<button type="button" class="pna-editor-btn pna-editor-btn-danger" id="pna-editor-prop-remove">Remove</button>';
      }
      html += '</div>';
      el.propsBody.innerHTML = html;

      function field(label, key, value, disabled, note) {
        return '<div class="pna-editor-field"><label>' + label + '</label><input type="number" data-prop="' + key + '" value="' + value + '" ' + (disabled ? 'disabled' : '') + '>' +
          (note ? '<span class="pna-editor-field-note">' + note + '</span>' : '') + '</div>';
      }

      [...el.propsBody.querySelectorAll('input[type="number"]:not([disabled])')].forEach((input) => {
        input.addEventListener('input', () => applyPropInput(o, input.dataset.prop, input.value, false));
        input.addEventListener('change', () => applyPropInput(o, input.dataset.prop, input.value, true));
      });
      const lockedBox = document.getElementById('pna-editor-prop-locked');
      if (lockedBox) lockedBox.addEventListener('change', () => { pushHistory(); o.locked = lockedBox.checked; markDirtyUI(); renderProps(); renderSelectionStatus(); draw(); });
      const dupBtn = document.getElementById('pna-editor-prop-duplicate');
      if (dupBtn) dupBtn.addEventListener('click', () => duplicateObject(o.instanceId));
      const remBtn = document.getElementById('pna-editor-prop-remove');
      if (remBtn) remBtn.addEventListener('click', () => removeObject(o.instanceId));
      const defBtn = document.getElementById('pna-editor-prop-default');
      if (defBtn) defBtn.addEventListener('click', () => resetToDefault(o.instanceId));
    }
    function applyPropInput(o, key, rawValue, commit) {
      if (isLocked(o)) return;
      const value = parseFloat(rawValue);
      if (!isFinite(value)) return;
      if (commit) pushHistory();
      if (key === 'x') o.x = o.assetType === 'dog_spawn' ? DOG_FIXED_X : clampX(value);
      else if (key === 'y') o.y = o.assetType === 'basket_spawn' ? BASKET_BASELINE_Y : o.assetType === 'dog_spawn' ? clampDogY(value) : clampY(value);
      else if (key === 'vx' || key === 'vy') { o.properties = o.properties || {}; o.properties[key] = value; }
      draw();
      if (commit) { markDirtyUI(); updateToolbarState(); renderSelectionStatus(); }
    }

    // ---------------------------------------------------------------
    // Save / Publish / Playtest
    // ---------------------------------------------------------------
    function markDirtyUI() { el.unsavedDot.classList.toggle('hidden', !isDirty()); }
    function setStatus(msg, isError) {
      let box = document.getElementById('pna-editor-status');
      if (!box) {
        box = document.createElement('div');
        box.id = 'pna-editor-status';
        document.getElementById('pna-stage-wrap').appendChild(box);
      }
      box.textContent = msg;
      box.style.color = isError ? '#ff8a8a' : '#eaf0ff';
      box.style.display = msg ? 'block' : 'none';
    }
    function updateToolbarState() {
      el.undoBtn.disabled = !history.length;
      el.redoBtn.disabled = !future.length;
    }

    async function saveDraft() {
      audio.play('buttonClick');
      setStatus('Saving draft…', false);
      try {
        await integration.saveLevelDraft(currentLevelId, objects);
        baseline = clone(objects);
        markDirtyUI();
        setStatus('Draft saved.', false);
        setTimeout(() => setStatus('', false), 2000);
      } catch (err) {
        setStatus('Save failed: ' + (err && err.message ? err.message : 'unknown error') + ' — nothing was saved.', true);
      }
    }

    async function publish() {
      audio.play('buttonClick');
      const problems = validateLocally();
      if (problems.length) { setStatus('Cannot publish: ' + problems[0], true); return; }
      const ok = window.confirm('Publish this layout? It immediately becomes the live level for all players.');
      if (!ok) return;
      setStatus('Publishing…', false);
      try {
        const version = await integration.publishLevel(currentLevelId, objects);
        baseline = clone(objects);
        markDirtyUI();
        levels.setLevelOverride(currentLevelId, levels.editorObjectsToLevelFields(objects));
        publishedVersion = version;
        loadVersions();
        setStatus('Published as version ' + version + '.', false);
        setTimeout(() => setStatus('', false), 2500);
      } catch (err) {
        setStatus('Publish failed: ' + (err && err.message ? err.message : 'unknown error') + ' — the live level was NOT changed.', true);
      }
    }

    // Mirrors the server-side checks in pna_level_layouts_validate_objects()
    // so the admin gets an immediate, specific answer instead of a raw
    // RPC error for the common cases. Dog/basket are always present
    // (see ensureRequiredObjects()) so those two checks can never
    // actually fail from the editor itself — kept anyway as a safety net.
    function validateLocally() {
      const problems = [];
      const dogCount = objects.filter((o) => o.assetType === 'dog_spawn').length;
      const basketCount = objects.filter((o) => o.assetType === 'basket_spawn').length;
      const boneCount = objects.filter((o) => o.assetType === 'dream_bone' && o.enabled !== false).length;
      if (dogCount !== 1) problems.push('the level needs exactly one Dog Start Position (has ' + dogCount + ').');
      if (basketCount !== 1) problems.push('the level needs exactly one Basket Start Position (has ' + basketCount + ').');
      if (boneCount < 1) problems.push('the level needs at least one enabled Dream Bone.');
      const ids = new Set(objects.map((o) => o.instanceId));
      if (ids.size !== objects.length) problems.push('two objects share the same instance ID.');
      if (objects.some((o) => !isFinite(o.x) || !isFinite(o.y))) problems.push('an object has an invalid position.');
      return problems;
    }

    async function restoreVersion(version) {
      const ok = window.confirm('Restore version ' + version + '? This publishes it as a new current version.');
      if (!ok) return;
      try {
        const newVersion = await integration.restoreLevelVersion(currentLevelId, version);
        await loadLevel(currentLevelId, { force: true });
        setStatus('Restored version ' + version + ' as new version ' + newVersion + '.', false);
      } catch (err) {
        setStatus('Restore failed: ' + (err && err.message ? err.message : 'unknown error'), true);
      }
    }

    function playtest() {
      audio.play('buttonClick');
      const problems = validateLocally();
      if (problems.length) { setStatus('Cannot playtest: ' + problems[0], true); return; }
      const fields = levels.editorObjectsToLevelFields(objects);
      isOpen = false; // hand the canvas back to the real game loop
      document.body.classList.remove('pna-editor-mode');
      startPlaytest(currentLevelId, fields);
    }

    // ---------------------------------------------------------------
    // Wiring / keyboard shortcuts (once)
    // ---------------------------------------------------------------
    function wireOnce() {
      if (wired) return;
      wired = true;
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('contextmenu', onContextMenu);
      canvas.addEventListener('dragstart', (e) => e.preventDefault()); // never a native image-drag ghost

      el.undoBtn.addEventListener('click', () => { audio.play('buttonClick'); undo(); });
      el.redoBtn.addEventListener('click', () => { audio.play('buttonClick'); redo(); });
      el.gridBtn.addEventListener('click', () => { showGrid = !showGrid; el.gridBtn.classList.toggle('pna-editor-btn-toggle-on', showGrid); draw(); });
      el.snapBtn.addEventListener('click', () => { snapToGrid = !snapToGrid; el.snapBtn.classList.toggle('pna-editor-btn-toggle-on', snapToGrid); });
      el.hitboxBtn.addEventListener('click', () => { showHitboxes = !showHitboxes; el.hitboxBtn.classList.toggle('pna-editor-btn-toggle-on', showHitboxes); draw(); });
      el.zoomInBtn.addEventListener('click', () => setZoom(zoom + 0.1));
      el.zoomOutBtn.addEventListener('click', () => setZoom(zoom - 0.1));
      el.zoomResetBtn.addEventListener('click', () => setZoom(1));
      el.saveDraftBtn.addEventListener('click', saveDraft);
      el.publishBtn.addEventListener('click', publish);
      el.playtestBtn.addEventListener('click', playtest);
      el.exitBtn.addEventListener('click', () => { audio.play('buttonClick'); close({}); });

      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerdown', (e) => {
        if (contextMenuEl && !contextMenuEl.contains(e.target)) closeContextMenu();
      });
      window.addEventListener('beforeunload', (e) => {
        if (isOpen && isDirty()) { e.preventDefault(); e.returnValue = ''; }
      });
      window.addEventListener('resize', () => { if (isOpen) draw(); });
      // Catches every real layout change to the stage box (window
      // resize, the editor grid reflowing, zoom) independent of
      // whether the game's own rAF loop happens to be running —
      // belt-and-suspenders alongside draw()'s own resizeCanvasForDPR()
      // call above.
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => { if (isOpen) draw(); });
        ro.observe(document.getElementById('pna-stage-wrap'));
      }
    }
    function setZoom(z) {
      zoom = Math.max(0.5, Math.min(2, z));
      el.zoomValue.textContent = Math.round(zoom * 100) + '%';
      canvas.style.transform = 'scale(' + zoom + ')';
    }
    function isTypingTarget(elm) {
      if (!elm) return false;
      const tag = elm.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || elm.isContentEditable;
    }
    function onKeyDown(e) {
      if (!isOpen) return;
      if (isTypingTarget(document.activeElement)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(); return; }
      if (e.key === 'Escape') { e.preventDefault(); placingType = null; closeArmedVisual(); closeContextMenu(); selectedId = null; renderProps(); renderSelectionStatus(); draw(); return; }
      const sel = findObj(selectedId);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.assetType === 'dream_bone') { e.preventDefault(); removeObject(selectedId); return; }
      if (sel && !isLocked(sel) && e.key.indexOf('Arrow') === 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        // Basket: horizontal-only (Up/Down ignored). Dog: vertical-only
        // (Left/Right ignored, permanently pinned to DOG_FIXED_X).
        // Dream Bones: free movement on both axes.
        const isDog = sel.assetType === 'dog_spawn';
        const isBasket = sel.assetType === 'basket_spawn';
        let moved = true;
        if (isDog && e.key === 'ArrowUp') { pushHistory(); sel.y = clampDogY(sel.y - step); sel.x = DOG_FIXED_X; }
        else if (isDog && e.key === 'ArrowDown') { pushHistory(); sel.y = clampDogY(sel.y + step); sel.x = DOG_FIXED_X; }
        else if (!isDog && e.key === 'ArrowLeft') { pushHistory(); sel.x = clampX(sel.x - step); }
        else if (!isDog && e.key === 'ArrowRight') { pushHistory(); sel.x = clampX(sel.x + step); }
        else if (!isDog && !isBasket && e.key === 'ArrowUp') { pushHistory(); sel.y = clampY(sel.y - step); }
        else if (!isDog && !isBasket && e.key === 'ArrowDown') { pushHistory(); sel.y = clampY(sel.y + step); }
        else moved = false;
        if (!moved) return;
        markDirtyUI(); renderProps(); renderSelectionStatus(); draw(); updateToolbarState();
      }
    }

    function tick() { if (isOpen) draw(); }

    return {
      open, close, tick,
      isOpen: () => isOpen,
      get currentLevelId() { return currentLevelId; },
      get objects() { return objects; },
      get selectedId() { return selectedId; }
    };
  }

  window.PNA_Editor = { createEditor };
})();
