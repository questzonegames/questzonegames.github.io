// ===== Pup N Away — Lobby / Level Select / Challenges / Equipment menus =====
//
// The four supplied PNGs (lobby, level select, challenges, equipment) are
// the ENTIRE visual design for these screens — this module never draws
// or recreates any of that artwork. It only builds and wires the real,
// responsive HTML controls that sit on top of each image, positioned as
// percentages of the image's own intrinsic size (see PNA_CONFIG.UI_HOTSPOTS,
// measured directly from each PNG's pixels) so every hitbox stays locked
// to its baked button/card/tab as the image scales.
//
// pup-n-away.js owns navigation (showScreen/goTo) and passes this module
// a small callback interface; this module never changes game state
// itself beyond firing those callbacks.
(function () {
  const CFG = window.PNA_CONFIG;
  const H = CFG.UI_HOTSPOTS;

  function $(id) { return document.getElementById(id); }
  function pct(n) { return n + '%'; }

  function styleHotspot(el, box) {
    el.style.position = 'absolute';
    el.style.left = pct(box.left);
    el.style.top = pct(box.top);
    el.style.width = pct(box.width);
    el.style.height = pct(box.height);
  }

  // Like styleHotspot(), but sizes the element by its own widget PNG's
  // real aspect ratio (box.aspect = width/height) instead of a measured
  // height percentage — the box's height then falls out of the image's
  // TRUE proportions at whatever width it renders, so a button/card/tab
  // widget can never be stretched or squashed, on any screen size.
  function styleAspectBox(el, box) {
    el.style.position = 'absolute';
    el.style.left = pct(box.left);
    el.style.top = pct(box.top);
    el.style.width = pct(box.width);
    if (box.aspect) el.style.aspectRatio = String(box.aspect);
    else if (box.height != null) el.style.height = pct(box.height);
  }

  // A themed custom dropdown (button + our own styled option list, not
  // the browser's native <select> popup) layered over a decorative
  // dropdown PNG — no native grey box or OS-drawn list ever shows.
  // `opts.flourish` widens the text/arrow clearance for the equipment
  // widgets, whose moon/cloud decoration sits further inward than the
  // plain challenges ones. Returns { wrapper, getValue, setValue,
  // addEventListener } — addEventListener('change', fn) fires on pick,
  // matching how a native <select>'s change event is normally consumed.
  let openDropdown = null;
  function closeOpenDropdown() {
    if (!openDropdown) return;
    openDropdown.panel.classList.add('hidden');
    openDropdown.btn.setAttribute('aria-expanded', 'false');
    openDropdown = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (openDropdown && !openDropdown.wrapper.contains(e.target) && !openDropdown.panel.contains(e.target)) closeOpenDropdown();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openDropdown) closeOpenDropdown(); });

  function buildImageSelect(imgSrc, box, labels, values, ariaLabel, opts) {
    opts = opts || {};
    const wrapper = document.createElement('div');
    wrapper.className = 'pna-image-select' + (opts.flourish ? ' pna-flourish' : '');
    styleAspectBox(wrapper, box);
    const img = document.createElement('img');
    img.className = 'pna-image-select-art';
    img.alt = ''; img.draggable = false;
    img.src = imgSrc;
    wrapper.appendChild(img);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pna-image-select-input';
    btn.setAttribute('aria-label', ariaLabel);
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const valueLabel = document.createElement('span');
    valueLabel.className = 'pna-image-select-value';
    btn.appendChild(valueLabel);
    wrapper.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'pna-dropdown-panel hidden';
    panel.setAttribute('role', 'listbox');
    document.body.appendChild(panel);

    let currentValue = values[0];
    const listeners = [];
    function setValue(v, fire) {
      currentValue = v;
      const idx = values.indexOf(v);
      valueLabel.textContent = labels[idx >= 0 ? idx : 0];
      panel.querySelectorAll('.pna-dropdown-option').forEach((o) => {
        o.setAttribute('aria-selected', String(o.dataset.value === String(v)));
      });
      if (fire) listeners.forEach((fn) => fn());
    }
    labels.forEach((label, i) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'pna-dropdown-option';
      opt.textContent = label;
      opt.dataset.value = values[i];
      opt.setAttribute('role', 'option');
      opt.addEventListener('click', () => {
        setValue(values[i], true);
        closeOpenDropdown();
        btn.focus();
      });
      panel.appendChild(opt);
    });
    setValue(values[0], false);

    function openPanel() {
      if (btn.disabled) return;
      closeOpenDropdown();
      const r = wrapper.getBoundingClientRect();
      panel.style.left = r.left + 'px';
      panel.style.top = (r.bottom + 4) + 'px';
      panel.style.width = Math.max(r.width, 140) + 'px';
      panel.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      openDropdown = { wrapper, panel, btn };
    }
    btn.addEventListener('click', () => {
      if (openDropdown && openDropdown.panel === panel) closeOpenDropdown();
      else openPanel();
    });

    return {
      wrapper,
      get disabled() { return btn.disabled; },
      set disabled(v) { btn.disabled = v; },
      get value() { return currentValue; },
      set value(v) { setValue(v, false); },
      addEventListener(ev, fn) { if (ev === 'change') listeners.push(fn); }
    };
  }

  // A real, transparent, keyboard/mouse/touch-usable <input type=search>
  // layered exactly over a decorative search-field PNG.
  function buildImageSearch(imgSrc, box, ariaLabel, opts) {
    opts = opts || {};
    const wrapper = document.createElement('div');
    wrapper.className = 'pna-image-search' + (opts.flourish ? ' pna-flourish' : '');
    styleAspectBox(wrapper, box);
    const img = document.createElement('img');
    img.className = 'pna-image-search-art';
    img.alt = ''; img.draggable = false;
    img.src = imgSrc;
    wrapper.appendChild(img);
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'pna-image-search-input';
    input.setAttribute('aria-label', ariaLabel);
    wrapper.appendChild(input);
    return { wrapper, input };
  }

  // The decorative track/thumb PNGs replace the browser's native
  // scrollbar entirely (hidden via CSS on the real scrolling container —
  // see .pna-scroll-list) — `box` fills the FULL list height (a track is
  // a stretchable capsule, unlike a button/card, so it's sized by
  // left/top/width/height like any other hotspot, not by its own native
  // aspect ratio) while the thumb's real height/position is kept in sync
  // with actual scroll progress by wireCustomScrollbar() below.
  function buildScrollbarWidgets(trackSrc, thumbSrc, box) {
    const track = document.createElement('div');
    track.className = 'pna-image-scrollbar-track';
    styleHotspot(track, box);
    const trackImg = document.createElement('img');
    trackImg.className = 'pna-image-scrollbar-track-art';
    trackImg.alt = ''; trackImg.draggable = false;
    trackImg.src = trackSrc;
    track.appendChild(trackImg);
    const thumb = document.createElement('img');
    thumb.className = 'pna-image-scrollbar-thumb';
    thumb.alt = ''; thumb.draggable = false;
    thumb.src = thumbSrc;
    track.appendChild(thumb);
    return { track, thumb };
  }

  // ---------------------------------------------------------------
  // Generic custom scrollbar — the baked scrollbar track/thumb art is
  // covered by a real, draggable thumb element kept in sync with the
  // real scroll position of `container` (still a genuinely scrollable
  // native element — wheel/trackpad/touch/keyboard all work on it
  // untouched; this only replaces the VISUAL thumb, never scroll
  // handling itself).
  // ---------------------------------------------------------------
  function wireCustomScrollbar(container, thumbEl) {
    function syncThumb() {
      const track = container.parentElement.querySelector('.pna-scrollbar-track') || thumbEl.parentElement;
      const trackH = track.clientHeight;
      const contentH = container.scrollHeight;
      const visibleH = container.clientHeight;
      if (contentH <= visibleH + 1) {
        thumbEl.style.display = 'none';
        return;
      }
      thumbEl.style.display = 'block';
      const thumbH = Math.max(24, (visibleH / contentH) * trackH);
      const maxThumbTop = trackH - thumbH;
      const scrollRatio = container.scrollTop / (contentH - visibleH);
      thumbEl.style.height = thumbH + 'px';
      thumbEl.style.top = (scrollRatio * maxThumbTop) + 'px';
    }
    container.addEventListener('scroll', syncThumb);
    window.addEventListener('resize', syncThumb);

    let dragging = false, dragStartY = 0, dragStartScroll = 0;
    thumbEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragStartY = e.clientY;
      dragStartScroll = container.scrollTop;
      thumbEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    thumbEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const track = thumbEl.parentElement;
      const trackH = track.clientHeight;
      const contentH = container.scrollHeight;
      const visibleH = container.clientHeight;
      const maxThumbTop = trackH - thumbEl.clientHeight;
      if (maxThumbTop <= 0) return;
      const deltaY = e.clientY - dragStartY;
      const deltaScroll = (deltaY / maxThumbTop) * (contentH - visibleH);
      container.scrollTop = dragStartScroll + deltaScroll;
    });
    function endDrag() { dragging = false; }
    thumbEl.addEventListener('pointerup', endDrag);
    thumbEl.addEventListener('pointercancel', endDrag);

    // Every call site (including the render functions below) calls this
    // right after populating the list, but that can happen BEFORE
    // goTo() actually removes the screen's `hidden` class — at that
    // instant the container is `display:none`, every layout measurement
    // above reads as 0, and the thumb gets hidden as "nothing to
    // scroll". It then stayed hidden until the next real scroll event
    // recomputed it with correct numbers, which read as "the thumb
    // doesn't appear until you scroll". A rAF-deferred re-sync re-runs
    // once the screen has actually been shown and laid out.
    function syncThumbRobust() {
      syncThumb();
      requestAnimationFrame(syncThumb);
    }
    syncThumbRobust();
    return syncThumbRobust;
  }

  function createMenuManager(deps) {
    const { levels, integration, audio, onSelectLevel, onReturnToLobby } = deps;

    // ---- sounds — hover/click on any real (non-disabled) control ----
    function wireInteractiveSound(el) {
      el.addEventListener('pointerenter', () => audio.play('buttonHover'));
      el.addEventListener('click', () => audio.play('buttonClick'));
    }
    function wireDisabledSound(el) {
      el.addEventListener('click', () => audio.play('buttonUnavailable'));
    }
    function wireHoverSound(el) {
      el.addEventListener('pointerenter', () => audio.play('buttonHover'));
    }

    // =================================================================
    // LOBBY — the 5 buttons are static markup in index.html (they exist
    // from first paint, unlike the other 3 screens' dynamically-built
    // content); only their measured hotspot geometry needs applying.
    // =================================================================
    function positionLobbyHotspots() {
      const box = H.lobby;
      const rows = [
        ['pna-btn-start', box.buttons.start],
        ['pna-lobby-btn-level-select', box.buttons.levelSelect],
        ['pna-lobby-btn-challenges', box.buttons.challenges],
        ['pna-lobby-btn-equipment', box.buttons.equipment],
        ['pna-lobby-btn-return-home', box.buttons.returnHome]
      ];
      rows.forEach(([id, row]) => {
        const el = $(id);
        if (!el) return;
        styleHotspot(el, { left: box.left, width: box.width, top: row.top, height: row.height });
        // Click sound is already played by pup-n-away.js's own handler
        // for each of these 5 buttons — only hover is wired here, so it
        // never plays twice per click.
        wireHoverSound(el);
      });
    }

    // =================================================================
    // LEVEL SELECT — blank template (outer frame + baked Return to
    // Lobby button) plus separate act-button/act-name-plate/level-card/
    // padlock widget PNGs, all positioned/sized from
    // PNA_CONFIG.UI_HOTSPOTS.levelSelect and never stretched (every
    // widget keeps its own real aspect ratio via styleAspectBox()).
    // =================================================================
    let levelSelectBuilt = false;
    let lsCards = [];

    // A small themed tooltip near a locked Act button — used instead of
    // a native disabled state so the cursor stays normal (never
    // not-allowed/a red prohibited symbol) while still making it clear
    // the click did nothing.
    function showLockedActHint(anchorEl, text) {
      const root = anchorEl.closest('.pna-ui-interactions');
      if (!root) return;
      let hint = root.querySelector('.pna-locked-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'pna-locked-hint hidden';
        root.appendChild(hint);
      }
      const rect = anchorEl.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      hint.textContent = text;
      hint.style.left = (rect.right - rootRect.left + 10) + 'px';
      hint.style.top = (rect.top - rootRect.top + rect.height / 2) + 'px';
      hint.classList.remove('hidden');
      clearTimeout(hint._pnaTimer);
      hint._pnaTimer = setTimeout(() => hint.classList.add('hidden'), 1600);
    }

    function buildLevelSelectStatic() {
      if (levelSelectBuilt) return;
      levelSelectBuilt = true;
      const root = $('pna-ls-interactions');
      const art = CFG.ASSETS.ui.levelSelect;
      const L = H.levelSelect;

      // ---- Act 1-10 buttons — a real <button> whose own art IS the
      // act-button PNG (blue normal / gold selected), never a duplicate
      // box drawn behind or over it. Act 1 is the only real, unlocked
      // act today; 2-10 stay real, ENABLED buttons (normal cursor, no
      // native :disabled, no red prohibited symbol) that simply decline
      // the action with a themed hint — there is no code path anywhere
      // that flips them open.
      for (let act = 1; act <= 10; act++) {
        const isAct1 = act === 1;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pna-ls-act-btn';
        btn.id = 'pna-ls-act-' + act;
        styleAspectBox(btn, {
          left: L.actList.left, width: L.actList.width,
          top: L.actList.rowTop + (act - 1) * L.actList.rowHeight,
          aspect: L.actList.buttonAspect
        });
        const img = document.createElement('img');
        img.className = 'pna-ls-act-btn-art';
        img.alt = ''; img.draggable = false;
        img.src = isAct1 ? art.actButtonSelected : art.actButtonNormal;
        btn.appendChild(img);
        const label = document.createElement('span');
        label.className = 'pna-ls-act-btn-label';
        label.textContent = 'ACT ' + act;
        btn.appendChild(label);

        if (isAct1) {
          btn.setAttribute('aria-label', 'Act 1');
          wireHoverSound(btn);
          btn.addEventListener('click', () => audio.play('buttonClick'));
        } else {
          btn.setAttribute('aria-label', 'Act ' + act + ' — locked');
          btn.setAttribute('aria-disabled', 'true');
          const lockImg = document.createElement('img');
          lockImg.className = 'pna-ls-act-lock';
          lockImg.alt = ''; lockImg.draggable = false;
          lockImg.src = art.lockedPadlock;
          btn.appendChild(lockImg);
          btn.addEventListener('click', () => {
            audio.play('buttonUnavailable');
            showLockedActHint(btn, 'Complete the previous Act to unlock');
          });
        }
        root.appendChild(btn);
      }

      // ---- Act name plate — live HTML text over the separate plate PNG.
      const namePlate = document.createElement('div');
      namePlate.className = 'pna-ls-name-plate';
      styleAspectBox(namePlate, L.actNamePlate);
      const plateArt = document.createElement('img');
      plateArt.className = 'pna-ls-name-plate-art';
      plateArt.alt = ''; plateArt.draggable = false;
      plateArt.src = art.actNamePlate;
      namePlate.appendChild(plateArt);
      const plateLabel = document.createElement('div');
      plateLabel.className = 'pna-ls-name-plate-label';
      plateLabel.id = 'pna-ls-act-name-label';
      plateLabel.textContent = 'ACT 1';
      namePlate.appendChild(plateLabel);
      root.appendChild(namePlate);

      // ---- Three Act 1 level cards — level-card.png + real thumbnail/
      // lock/badge/name, filled in with live data by refreshLevelSelect().
      lsCards = [];
      levels.all().forEach((level, i) => {
        const c = L.cards;
        const wrap = document.createElement('div');
        wrap.className = 'pna-ls-card';
        styleAspectBox(wrap, { left: c.left[i], width: c.width, top: c.top, aspect: c.aspect });

        const cardArt = document.createElement('img');
        cardArt.className = 'pna-ls-card-art';
        cardArt.alt = ''; cardArt.draggable = false;
        cardArt.src = art.levelCard;
        wrap.appendChild(cardArt);

        // Thumbnail sits inside its own clipped box (the card's gold
        // window), so a cover-fit image can never spill past the frame.
        const thumbBox = document.createElement('div');
        thumbBox.className = 'pna-ls-thumb-box';
        styleHotspot(thumbBox, c.thumb);
        wrap.appendChild(thumbBox);

        const thumb = document.createElement('img');
        thumb.className = 'pna-ls-thumb';
        thumb.alt = ''; thumb.draggable = false;
        thumb.src = CFG.ASSETS.backgrounds[level.background];
        thumbBox.appendChild(thumb);

        const lock = document.createElement('img');
        lock.className = 'pna-ls-lock-overlay hidden';
        lock.alt = ''; lock.draggable = false;
        lock.src = art.lockedPadlock;
        thumbBox.appendChild(lock);

        const badge = document.createElement('div');
        badge.className = 'pna-ls-complete-badge hidden';
        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="4 12 9 17 20 6"/></svg>';
        thumbBox.appendChild(badge);

        const nameLabel = document.createElement('div');
        nameLabel.className = 'pna-ls-card-name';
        styleHotspot(nameLabel, c.nameplate);
        nameLabel.textContent = level.name;
        wrap.appendChild(nameLabel);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pna-ls-card-btn';
        btn.addEventListener('click', () => {
          if (btn.getAttribute('aria-disabled') === 'true') {
            audio.play('buttonUnavailable');
            showLockedActHint(btn, 'Complete the previous level to unlock');
            return;
          }
          audio.play('buttonClick');
          onSelectLevel(level.id);
        });
        wireHoverSound(btn);
        wrap.appendChild(btn);

        root.appendChild(wrap);
        lsCards.push({ level, wrap, lock, badge, btn });
      });

      const returnBtn = $('pna-ls-return');
      styleHotspot(returnBtn, L.returnToLobby);
      wireHoverSound(returnBtn);
      returnBtn.addEventListener('click', () => { audio.play('buttonClick'); onReturnToLobby(); });
    }

    async function refreshLevelSelect() {
      buildLevelSelectStatic();
      const completedIds = await integration.getLevelCompletions();
      const completedSet = new Set(completedIds);
      const allLevels = levels.all();
      lsCards.forEach(({ level, lock, badge, btn }) => {
        const prevLevel = allLevels.find((l) => l.act === level.act && l.positionInAct === level.positionInAct - 1);
        const unlocked = level.positionInAct === 1 || (prevLevel && completedSet.has(prevLevel.id));
        const completed = completedSet.has(level.id);
        lock.classList.toggle('hidden', !!unlocked);
        badge.classList.toggle('hidden', !completed);
        btn.setAttribute('aria-disabled', String(!unlocked));
        btn.setAttribute('aria-label', unlocked
          ? (level.name + (completed ? ' (completed, replay)' : ''))
          : (level.name + ' — locked'));
      });
    }

    // =================================================================
    // CHALLENGES — blank template + separate tier-button/dropdown/
    // search/card/scrollbar widgets. Cards are generated straight from
    // PNA_CONFIG.CHALLENGE_CATALOG (empty today — no real challenges
    // exist yet), so adding real entries later needs no other change.
    // =================================================================
    const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'mythic'];
    let selectedChallengeTier = 'bronze';
    let selectedChallengeAct = 'all';
    let challengeSearchQuery = '';
    let challengesBuilt = false;
    let chSyncScrollbar = null;

    function buildChallengesStatic() {
      if (challengesBuilt) return;
      challengesBuilt = true;
      const root = $('pna-ch-interactions');
      const art = CFG.ASSETS.ui.challenges;
      const t = H.challenges.tiers;
      const tabW = t.width / t.count;

      TIERS.forEach((tier, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pna-tab-btn' + (tier === selectedChallengeTier ? ' pna-tab-selected' : '');
        btn.id = 'pna-ch-tier-' + tier;
        styleAspectBox(btn, { left: t.left + i * tabW, width: tabW, top: t.top, aspect: t.buttonAspect });
        const img = document.createElement('img');
        img.className = 'pna-tab-btn-art';
        img.alt = ''; img.draggable = false;
        img.src = tier === selectedChallengeTier ? art.tierButtonSelected : art.tierButtonNormal;
        btn.appendChild(img);
        const label = document.createElement('span');
        label.className = 'pna-tab-btn-label';
        label.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
        btn.appendChild(label);
        btn.setAttribute('aria-label', label.textContent + ' challenges');
        btn.setAttribute('aria-pressed', String(tier === selectedChallengeTier));
        btn.addEventListener('click', () => {
          audio.play('buttonClick');
          selectedChallengeTier = tier;
          TIERS.forEach((tt) => {
            const b = $('pna-ch-tier-' + tt);
            if (!b) return;
            const isSel = tt === tier;
            b.querySelector('.pna-tab-btn-art').src = isSel ? art.tierButtonSelected : art.tierButtonNormal;
            b.classList.toggle('pna-tab-selected', isSel);
            b.setAttribute('aria-pressed', String(isSel));
          });
          renderChallengeCards();
        });
        wireHoverSound(btn);
        root.appendChild(btn);
      });

      // Filter By Act — only "All Acts"/"Act 1" exist since no other
      // act's content exists yet.
      const actFilter = buildImageSelect(art.filterDropdown, H.challenges.filterByAct,
        ['All Acts', 'Act 1'], ['all', '1'], 'Filter challenges by act');
      actFilter.addEventListener('change', () => {
        audio.play('buttonClick');
        selectedChallengeAct = actFilter.value;
        renderChallengeCards();
      });
      root.appendChild(actFilter.wrapper);

      // Secondary filter — a real, OPEN-able dropdown like the others
      // (a disabled control that visually did nothing when clicked read
      // as broken) — just with only "All" until the catalog above
      // actually defines further filterable categories.
      const secondaryFilter = buildImageSelect(art.filterDropdown, H.challenges.secondaryFilter,
        ['All'], ['all'], 'Additional challenge filter');
      root.appendChild(secondaryFilter.wrapper);

      // Search — filters by title/description as the player types.
      const search = buildImageSearch(art.searchField, H.challenges.search, 'Search challenges');
      search.input.addEventListener('input', () => {
        challengeSearchQuery = search.input.value.trim().toLowerCase();
        renderChallengeCards();
      });
      root.appendChild(search.wrapper);

      // Scrollable card list — real overflow-y:auto container (mouse
      // wheel/trackpad/touch/keyboard all work natively, native
      // scrollbar hidden via CSS); the track/thumb PNGs are a purely
      // visual overlay kept in sync with real scroll position.
      const listWrap = document.createElement('div');
      listWrap.className = 'pna-scroll-list';
      listWrap.id = 'pna-ch-card-list';
      listWrap.tabIndex = 0;
      styleHotspot(listWrap, H.challenges.cardList);
      root.appendChild(listWrap);

      const { track, thumb } = buildScrollbarWidgets(art.scrollbarTrack, art.scrollbarThumb, H.challenges.scrollbar);
      root.appendChild(track);
      chSyncScrollbar = wireCustomScrollbar(listWrap, thumb);

      const returnBtn = $('pna-ch-return');
      styleHotspot(returnBtn, H.challenges.returnToLobby);
      wireHoverSound(returnBtn);
      returnBtn.addEventListener('click', () => { audio.play('buttonClick'); onReturnToLobby(); });
    }

    function buildChallengeCard(ch) {
      const art = CFG.ASSETS.ui.challenges;
      const c = H.challenges.card;
      const card = document.createElement('div');
      card.className = 'pna-ch-card';
      card.style.width = '100%';
      card.style.aspectRatio = String(c.aspect);

      const cardArt = document.createElement('img');
      cardArt.className = 'pna-ch-card-art';
      cardArt.alt = ''; cardArt.draggable = false;
      cardArt.src = art.challengeCard;
      card.appendChild(cardArt);

      const icon = document.createElement('div');
      icon.className = 'pna-ch-card-icon';
      styleHotspot(icon, c.icon);
      icon.textContent = ch.icon || '';
      card.appendChild(icon);

      const title = document.createElement('div');
      title.className = 'pna-ch-card-title';
      styleHotspot(title, c.title);
      title.textContent = ch.title;
      card.appendChild(title);

      const desc = document.createElement('div');
      desc.className = 'pna-ch-card-desc';
      styleHotspot(desc, c.description);
      desc.textContent = ch.description || '';
      card.appendChild(desc);

      return card;
    }

    function renderChallengeCards() {
      const list = $('pna-ch-card-list');
      if (!list) return;
      list.innerHTML = '';

      let items = CFG.CHALLENGE_CATALOG.filter((c) => c.tier === selectedChallengeTier);
      if (selectedChallengeAct !== 'all') items = items.filter((c) => String(c.act) === selectedChallengeAct);
      if (challengeSearchQuery) {
        items = items.filter((c) =>
          c.title.toLowerCase().includes(challengeSearchQuery) ||
          (c.description || '').toLowerCase().includes(challengeSearchQuery));
      }

      if (!items.length) {
        // No real challenges exist yet (see PNA_CONFIG.CHALLENGE_CATALOG),
        // so without this the scroll area/custom scrollbar would have
        // nothing to scroll and be untestable. Explicitly marked,
        // non-interactive skeleton cards — never real/invented challenge
        // data — just enough to require scrolling in the 2-column grid.
        const grid = document.createElement('div');
        grid.className = 'pna-challenge-grid';
        for (let i = 0; i < 10; i++) {
          const ph = document.createElement('div');
          ph.className = 'pna-ch-card pna-ch-card-placeholder';
          ph.style.aspectRatio = String(H.challenges.card.aspect);
          ph.setAttribute('aria-hidden', 'true');
          ph.setAttribute('data-placeholder', 'true');
          const art = document.createElement('img');
          art.className = 'pna-ch-card-art';
          art.alt = ''; art.draggable = false;
          art.src = CFG.ASSETS.ui.challenges.challengeCard;
          ph.appendChild(art);
          grid.appendChild(ph);
        }
        list.appendChild(grid);
      } else {
        const grid = document.createElement('div');
        grid.className = 'pna-challenge-grid';
        items.forEach((ch) => grid.appendChild(buildChallengeCard(ch)));
        list.appendChild(grid);
      }
      if (chSyncScrollbar) chSyncScrollbar();
    }

    function refreshChallenges() {
      buildChallengesStatic();
      renderChallengeCards();
      const list = $('pna-ch-card-list');
      if (list) list.scrollTop = 0;
    }

    // =================================================================
    // EQUIPMENT — blank template + separate tab/dropdown/search/card/
    // scrollbar widgets, a full-width grid (no side preview panel —
    // clicking an owned card equips it directly, matching the game's
    // existing right-click-to-equip behaviour as a supplementary path).
    // Reads PNA_CONFIG.EQUIPMENT_CATALOG (empty today) filtered by real
    // ownership via the EXISTING inventory system — see
    // getOwnedEquipment()/getEquippedBasket()/equipBasket() in
    // pup-n-away-integration.js.
    // =================================================================
    let selectedEquipmentView = 'owned';
    let equipmentSearchQuery = '';
    let equipmentBuilt = false;
    let eqSyncScrollbar = null;
    let eqCtxMenu = null;
    let ownedCache = [];
    let equippedIdCache = null;

    function buildEquipmentStatic() {
      if (equipmentBuilt) return;
      equipmentBuilt = true;
      const root = $('pna-eq-interactions');
      const art = CFG.ASSETS.ui.equipment;
      const E = H.equipment;

      ['owned', 'unowned'].forEach((view) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pna-tab-btn' + (view === selectedEquipmentView ? ' pna-tab-selected' : '');
        btn.id = 'pna-eq-tab-' + view;
        styleAspectBox(btn, { left: E.tabs[view].left, width: E.tabs[view].width, top: E.tabs[view].top, aspect: E.tabs.aspect });
        const img = document.createElement('img');
        img.className = 'pna-tab-btn-art';
        img.alt = ''; img.draggable = false;
        img.src = view === selectedEquipmentView ? art.tabButtonSelected : art.tabButtonNormal;
        btn.appendChild(img);
        const label = document.createElement('span');
        label.className = 'pna-tab-btn-label';
        label.textContent = view === 'owned' ? 'Owned' : 'Unowned';
        btn.appendChild(label);
        btn.setAttribute('aria-label', label.textContent + ' equipment');
        btn.setAttribute('aria-pressed', String(view === selectedEquipmentView));
        btn.addEventListener('click', () => {
          audio.play('buttonClick');
          selectedEquipmentView = view;
          ['owned', 'unowned'].forEach((v) => {
            const b = $('pna-eq-tab-' + v);
            if (!b) return;
            b.classList.toggle('pna-tab-selected', v === view);
            b.querySelector('.pna-tab-btn-art').src = v === view ? art.tabButtonSelected : art.tabButtonNormal;
            b.setAttribute('aria-pressed', String(v === view));
          });
          renderEquipmentGrid();
        });
        wireHoverSound(btn);
        root.appendChild(btn);
      });

      // 4 filter dropdowns — real, enabled selects; only "All" until
      // Pup N Away basket cosmetics actually define real categories
      // (type/rarity/etc. — see PNA_CONFIG.EQUIPMENT_CATALOG's own
      // comment). Reusing the site's avatar-equipment category system
      // would not apply here — that catalog is for a different slot
      // family entirely (head/body/boots/...), not basket skins.
      const f = E.filters;
      const filterW = f.width / f.count;
      const filterLabels = ['Type', 'Rarity', 'Cosmetic', 'Sort'];
      for (let i = 0; i < f.count; i++) {
        const sel = buildImageSelect(art.filterDropdown,
          { left: f.left + i * filterW, width: filterW, top: f.top, aspect: f.aspect },
          ['All'], ['all'], filterLabels[i] + ' filter', { flourish: true });
        root.appendChild(sel.wrapper);
      }

      const search = buildImageSearch(art.searchField, E.search, 'Search equipment', { flourish: true });
      search.input.addEventListener('input', () => {
        equipmentSearchQuery = search.input.value.trim().toLowerCase();
        renderEquipmentGrid();
      });
      root.appendChild(search.wrapper);

      // The scrollable VIEWPORT (pna-eq-grid) and the CSS-grid layout of
      // cards (pna-eq-grid-inner) are deliberately two separate elements
      // — putting the empty-state message directly inside a CSS grid
      // container let its own grid row balloon to an oversized height
      // (a big blank gap above the placeholder cards); as a plain block
      // sibling before the inner grid, it only ever takes its own
      // natural height.
      const grid = document.createElement('div');
      grid.className = 'pna-scroll-list';
      grid.id = 'pna-eq-grid';
      grid.tabIndex = 0;
      styleHotspot(grid, E.grid);
      root.appendChild(grid);

      const innerGrid = document.createElement('div');
      innerGrid.className = 'pna-equipment-grid';
      innerGrid.id = 'pna-eq-grid-inner';
      innerGrid.style.setProperty('--pna-eq-cols', String(E.grid.columns));
      grid.appendChild(innerGrid);

      const { track, thumb } = buildScrollbarWidgets(art.scrollbarTrack, art.scrollbarThumb, E.scrollbar);
      root.appendChild(track);
      eqSyncScrollbar = wireCustomScrollbar(grid, thumb);

      const returnBtn = $('pna-eq-return');
      styleHotspot(returnBtn, E.returnToLobby);
      wireHoverSound(returnBtn);
      returnBtn.addEventListener('click', () => { audio.play('buttonClick'); onReturnToLobby(); });

      // Right-click "Equip" context menu — preserved as a supplementary
      // path alongside the normal direct click/Enter-to-equip flow on
      // an owned card (see buildEquipmentCard() below), for parity with
      // any other Quest Zone equip surface that offers right-click.
      const ctxMenu = document.createElement('div');
      ctxMenu.className = 'pna-eq-context-menu hidden';
      ctxMenu.innerHTML = '<button type="button">Equip</button>';
      document.body.appendChild(ctxMenu);
      document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) ctxMenu.classList.add('hidden'); });
      eqCtxMenu = ctxMenu;
    }

    async function equipItem(itemId, cellEl) {
      audio.play('buttonClick');
      if (cellEl) cellEl.disabled = true;
      const ok = await integration.equipBasket(itemId);
      if (ok) await refreshEquipment();
      else if (cellEl) cellEl.disabled = false;
    }

    function buildEquipmentCard(item) {
      const art = CFG.ASSETS.ui.equipment;
      const c = H.equipment.card;
      const isOwnedView = selectedEquipmentView === 'owned';
      const isEquipped = item.id === equippedIdCache;

      const card = document.createElement(isOwnedView ? 'button' : 'div');
      card.className = 'pna-eq-card';
      card.style.aspectRatio = String(c.aspect);

      if (isOwnedView) {
        card.type = 'button';
        card.setAttribute('aria-label', item.name + (isEquipped ? ' (equipped)' : '') + ' — activate to equip');
        card.addEventListener('click', () => equipItem(item.id, card));
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const ctx = eqCtxMenu;
          if (!ctx) return;
          ctx.style.left = e.clientX + 'px';
          ctx.style.top = e.clientY + 'px';
          ctx.classList.remove('hidden');
          ctx.querySelector('button').onclick = () => { ctx.classList.add('hidden'); equipItem(item.id, card); };
        });
        wireHoverSound(card);
      } else {
        card.setAttribute('aria-label', item.name + ' (not owned)');
      }

      const cardArt = document.createElement('img');
      cardArt.className = 'pna-eq-card-art';
      cardArt.alt = ''; cardArt.draggable = false;
      cardArt.src = art.itemCard;
      card.appendChild(cardArt);

      const image = document.createElement('img');
      image.className = 'pna-eq-card-image';
      styleHotspot(image, c.image);
      image.alt = ''; image.draggable = false;
      image.src = item.previewImage || '';
      card.appendChild(image);

      const name = document.createElement('div');
      name.className = 'pna-eq-card-name';
      styleHotspot(name, c.nameplate);
      name.textContent = item.name;
      card.appendChild(name);

      if (isEquipped) {
        const badge = document.createElement('div');
        badge.className = 'pna-eq-equipped-badge';
        badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="4 12 9 17 20 6"/></svg>';
        card.appendChild(badge);
      }
      return card;
    }

    function renderEquipmentGrid() {
      const scrollBox = $('pna-eq-grid');
      const grid = $('pna-eq-grid-inner');
      if (!scrollBox || !grid) return;
      grid.innerHTML = '';
      const catalog = CFG.EQUIPMENT_CATALOG;
      const ownedIds = new Set(ownedCache.map((it) => it.id));
      let items = selectedEquipmentView === 'owned'
        ? ownedCache
        : catalog.filter((it) => !ownedIds.has(it.id));
      if (equipmentSearchQuery) {
        items = items.filter((it) => it.name.toLowerCase().includes(equipmentSearchQuery));
      }

      if (!items.length) {
        // No real equipment exists yet (see PNA_CONFIG.EQUIPMENT_CATALOG),
        // so the grid would otherwise be completely empty and the custom
        // scrollbar untestable. These are explicitly marked, non-
        // interactive skeleton boxes — never real/invented items — just
        // enough of them to require scrolling in the 5-column grid.
        for (let i = 0; i < 14; i++) {
          const ph = document.createElement('div');
          ph.className = 'pna-eq-card pna-eq-card-placeholder';
          ph.style.aspectRatio = String(H.equipment.card.aspect);
          ph.setAttribute('aria-hidden', 'true');
          ph.setAttribute('data-placeholder', 'true');
          const art = document.createElement('img');
          art.className = 'pna-eq-card-art';
          art.alt = ''; art.draggable = false;
          art.src = CFG.ASSETS.ui.equipment.itemCard;
          ph.appendChild(art);
          grid.appendChild(ph);
        }
      } else {
        items.forEach((item) => grid.appendChild(buildEquipmentCard(item)));
      }
      if (eqSyncScrollbar) eqSyncScrollbar();
    }

    async function refreshEquipment() {
      buildEquipmentStatic();
      const [owned, equippedId] = await Promise.all([
        integration.getOwnedEquipment(),
        integration.getEquippedBasket()
      ]);
      ownedCache = owned;
      equippedIdCache = equippedId;
      renderEquipmentGrid();
    }

    return { positionLobbyHotspots, refreshLevelSelect, refreshChallenges, refreshEquipment };
  }

  window.PNA_Menus = { createMenuManager };
})();
