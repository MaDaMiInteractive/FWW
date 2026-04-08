/* Campaign mode (manual form + stash + item generator)
   - Tabs: Locations / Units / Inventory (+ placeholders for others)
   - Items for units are equipped from the Stash (Inventory tab).
*/

(function () {
  'use strict';

  // -------------------- helpers --------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clampInt(v, min = 0, max = Number.POSITIVE_INFINITY) {
    const n = Number.parseInt(String(v), 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function safeImg(imgEl, src, fallback) {
    imgEl.src = src;
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = fallback;
    };
  }

  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function weightedChoice(entries) {
    // entries: [{w:number, value:any}]
    const total = entries.reduce((s, e) => s + Math.max(0, Number(e.w) || 0), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of entries) {
      r -= Math.max(0, Number(e.w) || 0);
      if (r <= 0) return e.value;
    }
    return entries[entries.length - 1]?.value ?? null;
  }

  function normalizeName(s) {
    return String(s || '').trim().toLowerCase();
  }

  function deepClone(obj) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(obj);
    } catch { /* ignore */ }
    return JSON.parse(JSON.stringify(obj));
  }

  const STASH_IMG = 'images/units/stash.png?v=20260318';

  // -------------------- db --------------------
  const db = {
    units: [],
    items: [],
    unitsById: {},
    itemsById: {},
    unitsMap: {},
    itemsMap: {},
  };

  async function loadDb() {
    const [uMap, iMap] = await Promise.all([
      fetch('images/units_map.json').then(r => r.json()).catch(() => ({})),
      fetch('images/items_map.json').then(r => r.json()).catch(() => ({})),
    ]);

    db.unitsMap = uMap || {};
    db.itemsMap = iMap || {};

    const [unitsRaw, itemsRaw] = await Promise.all([
      fetch('db/units.json').then(r => r.json()),
      fetch('db/items.json').then(r => r.json()),
    ]);

    if (!Array.isArray(unitsRaw)) {
      throw new Error('db/units.json has invalid format: expected array');
    }
    if (!Array.isArray(itemsRaw)) {
      throw new Error('db/items.json has invalid format: expected array');
    }

    db.units = unitsRaw.map(u => ({
      ...u,
      img: u.id === 'stash' ? STASH_IMG : (db.unitsMap[u.id] || `images/units/${u.id}.png`),
      name: (u.name || '').trim(),
    }));
    db.items = itemsRaw.map(it => ({
      ...it,
      img: db.itemsMap[it.id] || `images/items/${it.id}.png`,
      name: (it.name || '').trim(),
    }));

    db.unitsById = {};
    db.itemsById = {};
    db.units.forEach(u => { db.unitsById[u.id] = u; });
    db.items.forEach(it => { db.itemsById[it.id] = it; });
  }

  // -------------------- state --------------------
  const STORAGE_KEY = 'fww_campaign_state_v2';
  const SPECIAL_MOD_KEYS = ['str', 'per', 'end', 'cha', 'int', 'agi', 'luc'];

  function makeDefaultSpecialMods() {
    return {
      str: '',
      per: '',
      end: '',
      cha: '',
      int: '',
      agi: '',
      luc: '',
    };
  }

  function ensureUnitManualFields(unit) {
    if (!unit.specialMods || typeof unit.specialMods !== 'object') {
      unit.specialMods = makeDefaultSpecialMods();
    }
    SPECIAL_MOD_KEYS.forEach(key => {
      if (typeof unit.specialMods[key] !== 'string') unit.specialMods[key] = '';
    });
    if (typeof unit.visibilityMod !== 'string') unit.visibilityMod = '';
  }

  function makeDefaultLocation() {
    return {
      id: `loc_${Math.random().toString(36).slice(2, 10)}`,
      name: '',
      coordinate: '',
      hazard: '',
      facilities: [
        { tier: 1, slots: [{ name: '', active: false }, { name: '', active: false }] },
        { tier: 2, slots: [{ name: '', active: false }, { name: '', active: false }] },
        { tier: 3, slots: [{ name: '', active: false }, { name: '', active: false }] },
        { tier: 4, slots: [{ name: '', active: false }, { name: '', active: false }] },
      ],
    };
  }

  function makeDefaultUnit(unitId) {
    const base = db.unitsById[unitId];
    return {
      uid: `u_${Math.random().toString(36).slice(2, 10)}`,
      unitId,
      isStash: !!base?.is_stash,
      img: base?.is_stash ? STASH_IMG : (base?.img || 'images/missing-unit.png'),
      name: base?.name || 'Unit',
      rank: '',
      xp: 0,
      locationId: '',
      captive: false,
      sitOut: false,
      absent: false,
      paTraining: false,
      bounty: '',
      addicted: '',
      injuries: ['', '', ''],
      notes: '',
      specialMods: makeDefaultSpecialMods(),
      visibilityMod: '',
      equipment: [],
      perkSlots: [null, null, null, null], // 4
      upgradeSlots: [null, null, null, null, null, null, null, null], // 8
      killBoard: {
        melee: 0, pistol: 0, rifle: 0, hw: 0,
        ghouls: 0, superMutants: 0, raiders: 0, animals: 0, humans: 0,
      },
      expertise: {
        search: 0, computer: 0, lockpick: 0, repair: 0,
        crafting: 0, doctor: 0, battleCry: 0, trading: 0,
      },
    };
  }

  const DEFAULT_STATE = {
    version: 2,
    meta: {
      factionName: '',
      crewName: '',
      caps: 0,
      scout: 0,
      ap: 0,
      xp: 0,
      tier: 0,
      rep: '',
      note: '',
      playerName: '',
    },
    tab: 'Units',
    unitSubTab: 'Equipment', // Equipment|Upgrades
    currentUnitIndex: 0,
    locations: [],
    units: [],
    stash: { items: [] }, // itemId[]
  };

  let state = deepClone(DEFAULT_STATE);

  function restoreState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    state = deepClone(DEFAULT_STATE);

    // meta
    if (parsed.meta && typeof parsed.meta === 'object') {
      state.meta = { ...state.meta, ...parsed.meta };
    }

    // tabs
    if (typeof parsed.tab === 'string') state.tab = parsed.tab;
    if (typeof parsed.unitSubTab === 'string') state.unitSubTab = parsed.unitSubTab;

    // collections
    if (Array.isArray(parsed.locations)) state.locations = parsed.locations;
    if (Array.isArray(parsed.units)) state.units = parsed.units;

    // stash
    if (parsed.stash && typeof parsed.stash === 'object' && Array.isArray(parsed.stash.items)) {
      state.stash.items = parsed.stash.items;
    }

    // index
    if (typeof parsed.currentUnitIndex === 'number') state.currentUnitIndex = parsed.currentUnitIndex;

    // sanitize
    if (state.currentUnitIndex < 0) state.currentUnitIndex = 0;
    if (state.currentUnitIndex >= state.units.length) state.currentUnitIndex = Math.max(0, state.units.length - 1);

    // ensure arrays sizes
    state.units.forEach(u => {
      u.isStash = Boolean(u.isStash || db.unitsById[u.unitId]?.is_stash);
      if (u.isStash) {
        u.img = STASH_IMG;
      }
      if (u.isStash && (!u.name || u.name === 'Stash' || u.name === 'Inventory')) {
        u.name = db.unitsById[u.unitId]?.name || 'Сундук / инвентарь';
      }

      if (!Array.isArray(u.injuries)) u.injuries = ['', '', ''];
      while (u.injuries.length < 3) u.injuries.push('');
      u.injuries = u.injuries.slice(0, 3);

      if (!Array.isArray(u.perkSlots)) u.perkSlots = [null, null, null, null];
      while (u.perkSlots.length < 4) u.perkSlots.push(null);
      u.perkSlots = u.perkSlots.slice(0, 4);

      if (!Array.isArray(u.upgradeSlots)) u.upgradeSlots = Array(8).fill(null);
      while (u.upgradeSlots.length < 8) u.upgradeSlots.push(null);
      u.upgradeSlots = u.upgradeSlots.slice(0, 8);

      if (!u.killBoard || typeof u.killBoard !== 'object') {
        u.killBoard = deepClone(makeDefaultUnit(u.unitId).killBoard);
      }
      if (!u.expertise || typeof u.expertise !== 'object') {
        u.expertise = deepClone(makeDefaultUnit(u.unitId).expertise);
      }
      if (!Array.isArray(u.equipment)) u.equipment = [];
      ensureUnitManualFields(u);
    });
  }

  let persistTimer = null;
  function persistState() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }, 120);
  }

  // -------------------- UI refs --------------------
  const contentEl = $('#campaignContent');

  // -------------------- render shell --------------------
  function renderMeta() {
    $('#metaFactionName').value = state.meta.factionName || '';
    $('#metaCrewName').value = state.meta.crewName || '';
    $('#metaCaps').value = String(state.meta.caps ?? 0);
    $('#metaScout').value = String(state.meta.scout ?? 0);
    $('#metaAp').value = String(state.meta.ap ?? 0);
    $('#metaXp').value = String(state.meta.xp ?? 0);
    $('#metaTier').value = String(state.meta.tier ?? 0);
    $('#metaRep').value = state.meta.rep ?? '';
    $('#metaNote').value = state.meta.note || '';
    $('#metaPlayerName').value = state.meta.playerName || '';
  }

  function setActiveTab(tabKey) {
    state.tab = tabKey;
    persistState();
    $$('.campaign-tabs .tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabKey));
    render();
  }

  function render() {
    renderMeta();
    document.body.dataset.tab = state.tab || '';

    // tab highlight
    $$('.campaign-tabs .tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.tab));

    contentEl.innerHTML = '';
    switch (state.tab) {
      case 'Locations': renderLocations(); break;
      case 'Units': renderUnits(); break;
      case 'Inventory': renderInventory(); break;
      default: renderPlaceholder(state.tab); break;
    }
  }

  function renderPlaceholder(tabKey) {
    const block = document.createElement('section');
    block.className = 'panel-block';
    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = tabKey;
    const p = document.createElement('div');
    p.className = 'placeholder';
    p.textContent = 'Раздел в разработке. Сейчас доступны: локации, персонажи, инвентарь и генератор предметов.';
    block.appendChild(title);
    block.appendChild(p);
    contentEl.appendChild(block);
  }

  // -------------------- Locations tab --------------------
  function renderLocations() {
    contentEl.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'unit-nav';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = 'Локации';
    top.appendChild(title);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = 'Новая локация';
    addBtn.addEventListener('click', () => {
      state.locations.push(makeDefaultLocation());
      persistState();
      renderLocations();
    });
    top.appendChild(addBtn);

    contentEl.appendChild(top);

    if (!state.locations.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-block placeholder';
      empty.textContent = 'Пока нет локаций. Нажмите «Новая локация».';
      contentEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'loc-list';

    state.locations.forEach((loc, idx) => {
      const card = document.createElement('section');
      card.className = 'loc-card';

      const head = document.createElement('div');
      head.className = 'loc-card__head';
      const hTitle = document.createElement('div');
      hTitle.className = 'loc-card__title';
      hTitle.textContent = `Локация ${idx + 1}`;
      head.appendChild(hTitle);

      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Удалить локацию';
      del.addEventListener('click', () => {
        state.locations.splice(idx, 1);
        // Also detach from units
        state.units.forEach(u => {
          if (u.locationId === loc.id) u.locationId = '';
        });
        persistState();
        renderLocations();
      });
      head.appendChild(del);

      card.appendChild(head);

      // name / coordinate / hazard
      const grid = document.createElement('div');
      grid.className = 'form-grid';

      grid.appendChild(fieldInput('Название локации', loc.name || '', (v) => { loc.name = v; persistState(); }, 'col-6'));
      grid.appendChild(fieldInput('Координаты', loc.coordinate || '', (v) => { loc.coordinate = v; persistState(); }, 'col-3'));
      grid.appendChild(fieldInput('Опасность', loc.hazard || '', (v) => { loc.hazard = v; persistState(); }, 'col-3'));

      card.appendChild(grid);

      // Facilities tiers
      const facTitle = document.createElement('div');
      facTitle.className = 'fac-title';
      facTitle.textContent = 'Постройки';
      card.appendChild(facTitle);

      const tiers = document.createElement('div');
      tiers.className = 'fac-tiers';

      (loc.facilities || []).forEach((tierObj, tIdx) => {
        const tier = document.createElement('div');
        tier.className = 'tier';

        const tTitle = document.createElement('div');
        tTitle.className = 'tier__title';
        tTitle.textContent = `Тир ${tierObj.tier ?? (tIdx + 1)}`;
        tier.appendChild(tTitle);

        (tierObj.slots || []).forEach((slot, sIdx) => {
          const row = document.createElement('div');
          row.className = 'tier__slot';

          const input = document.createElement('input');
          input.className = 'input';
          input.placeholder = '...';
          input.value = slot.name || '';
          input.addEventListener('input', () => {
            slot.name = input.value;
            persistState();
          });
          row.appendChild(input);

          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.checked = !!slot.active;
          chk.title = 'Активно';
          chk.addEventListener('change', () => {
            slot.active = chk.checked;
            persistState();
          });
          row.appendChild(chk);

          tier.appendChild(row);
        });

        tiers.appendChild(tier);
      });

      card.appendChild(tiers);
      list.appendChild(card);
    });

    contentEl.appendChild(list);
  }

  function fieldInput(label, value, onChange, colClass = 'col-12', { type = 'text', min = null } = {}) {
    const wrap = document.createElement('div');
    wrap.className = `field ${colClass}`;
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.className = 'input' + (type === 'number' ? ' number' : '');
    input.type = type;
    if (min !== null) input.min = String(min);
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  // -------------------- Units tab --------------------
  function getCurrentUnit() {
    if (!state.units.length) return null;
    const idx = Math.max(0, Math.min(state.currentUnitIndex, state.units.length - 1));
    return state.units[idx] || null;
  }

  function unitTotalCost(unit) {
    const base = db.unitsById[unit.unitId];
    if (unit.isStash || base?.is_stash) {
      return 0;
    }

    const unitCost = Number(base?.cost || 0) || 0;
    const sumIds = (ids) => (ids || []).reduce((s, id) => s + (Number(db.itemsById[id]?.cost || 0) || 0), 0);
    const equipCost = sumIds(unit.equipment || []);
    const perkCost = sumIds((unit.perkSlots || []).filter(Boolean));
    const upgCost = sumIds((unit.upgradeSlots || []).filter(Boolean));
    return unitCost + equipCost + perkCost + upgCost;
  }

  function renderUnits() {
    // Очищаем контент перед рендерингом, чтобы избежать дублирования панелей
    contentEl.innerHTML = '';
    
    const nav = document.createElement('div');
    nav.className = 'unit-nav';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = 'Персонажи';
    nav.appendChild(title);

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn';
    prevBtn.textContent = '◀';
    prevBtn.disabled = state.units.length <= 1;
    prevBtn.addEventListener('click', () => {
      state.currentUnitIndex = (state.currentUnitIndex - 1 + state.units.length) % state.units.length;
      persistState();
      renderUnits();
    });
    nav.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn';
    nextBtn.textContent = '▶';
    nextBtn.disabled = state.units.length <= 1;
    nextBtn.addEventListener('click', () => {
      state.currentUnitIndex = (state.currentUnitIndex + 1) % state.units.length;
      persistState();
      renderUnits();
    });
    nav.appendChild(nextBtn);

    const counter = document.createElement('div');
    counter.className = 'unit-counter';
    counter.textContent = state.units.length ? `${state.currentUnitIndex + 1} / ${state.units.length}` : '0 / 0';
    nav.appendChild(counter);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.textContent = 'Добавить персонажа';
    addBtn.addEventListener('click', () => openUnitPicker());
    nav.appendChild(addBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = 'Удалить персонажа';
    delBtn.disabled = !state.units.length;
    delBtn.addEventListener('click', () => {
      if (!state.units.length) return;
      const idx = state.currentUnitIndex;
      state.units.splice(idx, 1);
      if (state.currentUnitIndex >= state.units.length) state.currentUnitIndex = Math.max(0, state.units.length - 1);
      persistState();
      renderUnits();
    });
    nav.appendChild(delBtn);

    // location dropdown (for current unit)
    const unit = getCurrentUnit();
    const locWrap = document.createElement('div');
    locWrap.className = 'field';
    locWrap.style.minWidth = '220px';
    const locLabel = document.createElement('label');
    locLabel.textContent = 'Локация';
    const locSelect = document.createElement('select');
    locSelect.className = 'input';
    locSelect.innerHTML = '';
    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = '—';
    locSelect.appendChild(optEmpty);

    state.locations.forEach((loc, i) => {
      const opt = document.createElement('option');
      opt.value = loc.id;
      const display = (loc.name || '').trim();
      opt.textContent = display ? display : `Локация ${i + 1}`;
      locSelect.appendChild(opt);
    });

    locSelect.value = unit?.locationId || '';
    locSelect.disabled = !unit;
    locSelect.addEventListener('change', () => {
      if (!unit) return;
      unit.locationId = locSelect.value;
      persistState();
    });

    locWrap.appendChild(locLabel);
    locWrap.appendChild(locSelect);
    nav.appendChild(locWrap);

    contentEl.appendChild(nav);

    if (!state.units.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-block placeholder';
      empty.textContent = 'Пока нет персонажей. Нажмите «Добавить персонажа».';
      contentEl.appendChild(empty);
      return;
    }

    if (!unit) return;

    const layout = document.createElement('div');
    layout.className = 'units-layout';

    // LEFT: card + core fields
    const left = document.createElement('section');
    left.className = 'panel-block';

    const leftTitle = document.createElement('div');
    leftTitle.className = 'section-title';
    leftTitle.textContent = 'Карточка и параметры';
    left.appendChild(leftTitle);

    ensureUnitManualFields(unit);

    const cardShell = document.createElement('div');
    cardShell.className = 'unit-card-shell';

    const card = document.createElement('div');
    card.className = 'unit-card';
    const img = document.createElement('img');
    img.alt = unit.name || '';
    safeImg(img, unit.img || 'images/missing-unit.png', 'images/missing-unit.png');
    card.appendChild(img);
    cardShell.appendChild(card);

    const specialMods = document.createElement('div');
    specialMods.className = 'unit-card-manual unit-card-manual--special';
    [
      ['str', 'STR'],
      ['per', 'PER'],
      ['end', 'END'],
      ['cha', 'CHA'],
      ['int', 'INT'],
      ['agi', 'AGI'],
      ['luc', 'LUC'],
    ].forEach(([key, label]) => {
      const input = document.createElement('input');
      input.className = 'unit-card-manual__input';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 4;
      input.value = unit.specialMods[key] || '';
      input.title = `Модификатор ${label}`;
      input.setAttribute('aria-label', `Модификатор ${label}`);
      input.addEventListener('input', () => {
        unit.specialMods[key] = input.value;
        persistState();
      });
      specialMods.appendChild(input);
    });
    cardShell.appendChild(specialMods);

    const visibilityMod = document.createElement('input');
    visibilityMod.className = 'unit-card-manual__input unit-card-manual__input--vision';
    visibilityMod.type = 'text';
    visibilityMod.inputMode = 'numeric';
    visibilityMod.maxLength = 4;
    visibilityMod.value = unit.visibilityMod || '';
    visibilityMod.title = 'Модификатор дальности видимости';
    visibilityMod.setAttribute('aria-label', 'Модификатор дальности видимости');
    visibilityMod.addEventListener('input', () => {
      unit.visibilityMod = visibilityMod.value;
      persistState();
    });
    cardShell.appendChild(visibilityMod);

    left.appendChild(cardShell);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.style.marginTop = '.9rem';

    grid.appendChild(fieldInput('Имя персонажа', unit.name || '', (v) => { unit.name = v; persistState(); }, 'col-8'));
    grid.appendChild(fieldInput('Ранг', unit.rank || '', (v) => { unit.rank = v; persistState(); }, 'col-4'));

    // XP stepper
    const xpWrap = document.createElement('div');
    xpWrap.className = 'field col-4';
    const xpLabel = document.createElement('label');
    xpLabel.textContent = 'XP';
    const xpRow = document.createElement('div');
    xpRow.className = 'numstep';
    const xpMinus = document.createElement('button');
    xpMinus.className = 'btn small';
    xpMinus.textContent = '-';
    xpMinus.addEventListener('click', () => {
      unit.xp = clampInt((unit.xp ?? 0) - 1, 0);
      persistState();
      renderUnits();
    });
    const xpInput = document.createElement('input');
    xpInput.className = 'input number smallnum';
    xpInput.type = 'number';
    xpInput.min = '0';
    xpInput.value = String(unit.xp ?? 0);
    xpInput.addEventListener('input', () => {
      unit.xp = clampInt(xpInput.value, 0);
      persistState();
    });
    const xpPlus = document.createElement('button');
    xpPlus.className = 'btn small';
    xpPlus.textContent = '+';
    xpPlus.addEventListener('click', () => {
      unit.xp = clampInt((unit.xp ?? 0) + 1, 0);
      persistState();
      renderUnits();
    });
    xpRow.appendChild(xpMinus);
    xpRow.appendChild(xpInput);
    xpRow.appendChild(xpPlus);
    xpWrap.appendChild(xpLabel);
    xpWrap.appendChild(xpRow);
    grid.appendChild(xpWrap);

    // Total cost (auto)
    const costWrap = document.createElement('div');
    costWrap.className = 'field col-8';
    const cLabel = document.createElement('label');
    cLabel.textContent = 'Общая стоимость';
    const cVal = document.createElement('input');
    cVal.className = 'input number';
    cVal.type = 'number';
    cVal.disabled = true;
    cVal.value = String(unitTotalCost(unit));
    costWrap.appendChild(cLabel);
    costWrap.appendChild(cVal);
    grid.appendChild(costWrap);

    // Status toggles
    const stWrap = document.createElement('div');
    stWrap.className = 'field col-12 unit-status-field';
    const stLabel = document.createElement('label');
    stLabel.textContent = 'Статус';
    const stRow = document.createElement('div');
    stRow.className = 'toggles';

    stRow.appendChild(statusBtn('Пленник', unit.captive, (v) => {
      unit.captive = v;
      if (v) unit.sitOut = false; // optional
      persistState();
      renderUnits();
    }, 'danger'));

    stRow.appendChild(statusBtn('Пропускает ход', unit.sitOut, (v) => { unit.sitOut = v; persistState(); renderUnits(); }, 'secondary'));
    stRow.appendChild(statusBtn('Отсутствует', unit.absent, (v) => { unit.absent = v; persistState(); renderUnits(); }, 'danger'));
    stRow.appendChild(statusBtn('Обучение СБ', unit.paTraining, (v) => { unit.paTraining = v; persistState(); renderUnits(); }, 'danger'));

    stWrap.appendChild(stLabel);
    stWrap.appendChild(stRow);
    grid.appendChild(stWrap);

    grid.appendChild(fieldInput('Награда', unit.bounty || '', (v) => { unit.bounty = v; persistState(); }, 'col-12'));

    grid.appendChild(fieldInput('Зависимость', unit.addicted || '', (v) => { unit.addicted = v; persistState(); }, 'col-12'));

    const inj1 = fieldInput('Травма 1', unit.injuries?.[0] || '', (v) => { unit.injuries[0] = v; persistState(); }, 'col-4');
    const inj2 = fieldInput('Травма 2', unit.injuries?.[1] || '', (v) => { unit.injuries[1] = v; persistState(); }, 'col-4');
    const inj3 = fieldInput('Травма 3', unit.injuries?.[2] || '', (v) => { unit.injuries[2] = v; persistState(); }, 'col-4');
    grid.appendChild(inj1);
    grid.appendChild(inj2);
    grid.appendChild(inj3);

    grid.appendChild(fieldInput('Заметки', unit.notes || '', (v) => { unit.notes = v; persistState(); }, 'col-12'));

    left.appendChild(grid);

    // RIGHT: equipment / upgrades
    const right = document.createElement('section');
    right.className = 'panel-block';

    const subTabs = document.createElement('div');
    subTabs.className = 'unit-subtabs';
    [['Equipment', 'Снаряжение'], ['Upgrades', 'Улучшения']].forEach(([key, label]) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = label;
      b.dataset.subtab = key;
      b.classList.toggle('active', state.unitSubTab === key);
      b.addEventListener('click', () => {
        state.unitSubTab = key;
        persistState();
        renderUnits();
      });
      subTabs.appendChild(b);
    });
    right.appendChild(subTabs);

    if (state.unitSubTab === 'Upgrades') {
      renderUnitUpgrades(right, unit);
    } else {
      renderUnitEquipment(right, unit);
    }

    layout.appendChild(left);
    layout.appendChild(right);
    contentEl.appendChild(layout);
  }

  function statusBtn(label, value, onChange, kind = 'secondary') {
    const btn = document.createElement('button');
    btn.className = 'btn tiny toggle';
    if (kind === 'danger') btn.classList.add('danger');
    if (kind === 'secondary') btn.classList.add('secondary');
    btn.classList.toggle('toggle--on', !!value);
    btn.textContent = label;
    btn.addEventListener('click', () => onChange(!value));
    return btn;
  }

  // --------- unit content: Equipment ---------
  const PERK_XP_THRESHOLDS = [7, 16, 27, 41];

  function renderUnitEquipment(host, unit) {
    const disabled = !!unit.captive;

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.gap = '1rem';
    head.style.flexWrap = 'wrap';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Снаряжение';
    head.appendChild(title);

    const addItemBtn = document.createElement('button');
    addItemBtn.className = 'btn';
    addItemBtn.textContent = 'Добавить предмет из сундука';
    addItemBtn.disabled = disabled || state.stash.items.length === 0 || (unit.equipment?.length ?? 0) >= 8;
    if (unit.equipment?.length >= 8) addItemBtn.title = 'Достигнут лимит 8 предметов (как на форме)';
    addItemBtn.addEventListener('click', () => openStashPicker({
      title: `Сундук -> ${unit.name}`,
      onPick: (itemId) => {
        const idx = state.stash.items.indexOf(itemId);
        if (idx >= 0) state.stash.items.splice(idx, 1);
        unit.equipment.push(itemId);
        persistState();
        renderUnits();
      }
    }));
    head.appendChild(addItemBtn);

    host.appendChild(head);

    // Perk slots
    const perkTitle = document.createElement('div');
    perkTitle.className = 'section-title';
    perkTitle.style.marginTop = '.6rem';
    perkTitle.textContent = 'Слоты перков';
    host.appendChild(perkTitle);

    const perkGrid = document.createElement('div');
    perkGrid.className = 'card-grid';

    for (let i = 0; i < 4; i++) {
      const perkId = unit.perkSlots?.[i] || null;
      const threshold = PERK_XP_THRESHOLDS[i];

      if (!perkId) {
        perkGrid.appendChild(emptySlotTile(`Перк ${i + 1}`, `XP ${threshold}`, disabled ? null : () => {
          openItemLibraryPicker({
            title: `Добавить перк -> ${unit.name} (слот ${i + 1})`,
            filter: (it) => !!(it.cats && it.cats.Perks),
            onPick: (it) => {
              unit.perkSlots[i] = it.id;
              persistState();
              renderUnits();
            }
          });
        }));
      } else {
        const perk = db.itemsById[perkId];
        perkGrid.appendChild(cardTileFromItem(perk, {
          meta: `Перк • XP ${threshold}`,
          actions: disabled ? [] : [
            { label: 'Заменить перк', kind: 'secondary', onClick: () => {
              openItemLibraryPicker({
                title: `Заменить перк -> ${unit.name} (слот ${i + 1})`,
                filter: (it) => !!(it.cats && it.cats.Perks),
                onPick: (it) => {
                  unit.perkSlots[i] = it.id;
                  persistState();
                  renderUnits();
                }
              });
            }},
            { label: 'Удалить перк', kind: 'danger', onClick: () => {
              unit.perkSlots[i] = null;
              persistState();
              renderUnits();
            }},
          ]
        }));
      }
    }
    host.appendChild(perkGrid);

    // Items (up to 8)
    const itemsTitle = document.createElement('div');
    itemsTitle.className = 'section-title';
    itemsTitle.style.marginTop = '1rem';
    itemsTitle.textContent = 'Предметы (максимум 8)';
    host.appendChild(itemsTitle);

    const items = (unit.equipment || []).slice(0, 8);
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'placeholder';
      empty.textContent = 'Нет предметов. Используйте «Добавить предмет из сундука».';
      host.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'card-grid';

    items.forEach((itemId, idx) => {
      const item = db.itemsById[itemId];
      grid.appendChild(cardTileFromItem(item, {
        meta: 'Предмет',
        actions: disabled ? [] : [
          {
            label: 'Вернуть в сундук',
            kind: 'secondary',
            onClick: () => {
              unit.equipment.splice(idx, 1);
              state.stash.items.push(itemId);
              persistState();
              renderUnits();
            }
          }
        ]
      }));
    });

    host.appendChild(grid);
  }

  // --------- unit content: Upgrades ---------
  const UPGRADE_XP_THRESHOLDS = [0, 3, 0, 11, 0, 21, 0, 34]; // match slide (even slots have thresholds)

  function renderUnitUpgrades(host, unit) {
    const disabled = !!unit.captive;

    // Perk slots (same as on upgrades form)
    const perkTitle = document.createElement('div');
    perkTitle.className = 'section-title';
    perkTitle.textContent = 'Слоты перков';
    host.appendChild(perkTitle);

    const perkGrid = document.createElement('div');
    perkGrid.className = 'card-grid';

    for (let i = 0; i < 4; i++) {
      const perkId = unit.perkSlots?.[i] || null;
      const threshold = PERK_XP_THRESHOLDS[i];

      if (!perkId) {
        perkGrid.appendChild(emptySlotTile(`Перк ${i + 1}`, `XP ${threshold}`, disabled ? null : () => {
          openItemLibraryPicker({
            title: `Добавить перк -> ${unit.name} (слот ${i + 1})`,
            filter: (it) => !!(it.cats && it.cats.Perks),
            onPick: (it) => {
              unit.perkSlots[i] = it.id;
              persistState();
              renderUnits();
            }
          });
        }));
      } else {
        const perk = db.itemsById[perkId];
        perkGrid.appendChild(cardTileFromItem(perk, {
          meta: `Перк • XP ${threshold}`,
          actions: disabled ? [] : [
            { label: 'Заменить перк', kind: 'secondary', onClick: () => {
              openItemLibraryPicker({
                title: `Заменить перк -> ${unit.name} (слот ${i + 1})`,
                filter: (it) => !!(it.cats && it.cats.Perks),
                onPick: (it) => {
                  unit.perkSlots[i] = it.id;
                  persistState();
                  renderUnits();
                }
              });
            }},
            { label: 'Удалить перк', kind: 'danger', onClick: () => {
              unit.perkSlots[i] = null;
              persistState();
              renderUnits();
            }},
          ]
        }));
      }
    }
    host.appendChild(perkGrid);

    // Upgrade slots
    const upTitle = document.createElement('div');
    upTitle.className = 'section-title';
    upTitle.style.marginTop = '1rem';
    upTitle.textContent = 'Улучшения (8 слотов)';
    host.appendChild(upTitle);

    const upGrid = document.createElement('div');
    upGrid.className = 'upgrade-grid';

    for (let i = 0; i < 8; i++) {
      const upId = unit.upgradeSlots?.[i] || null;
      const threshold = UPGRADE_XP_THRESHOLDS[i];
      const label = `Улучшение ${i + 1}`;
      const meta = threshold ? `XP ${threshold}` : '';

      if (!upId) {
        upGrid.appendChild(emptySlotTile(label, meta, disabled ? null : () => {
          openItemLibraryPicker({
            title: `Добавить улучшение -> ${unit.name} (слот ${i + 1})`,
            filter: (it) => !!(it.cats && it.cats.Upgrades),
            onPick: (it) => {
              unit.upgradeSlots[i] = it.id;
              persistState();
              renderUnits();
            }
          });
        }));
      } else {
        const up = db.itemsById[upId];
        upGrid.appendChild(cardTileFromItem(up, {
          meta: meta ? `Улучшение • ${meta}` : 'Улучшение',
          actions: disabled ? [] : [
            { label: 'Заменить', kind: 'secondary', onClick: () => {
              openItemLibraryPicker({
                title: `Заменить улучшение -> ${unit.name} (слот ${i + 1})`,
                filter: (it) => !!(it.cats && it.cats.Upgrades),
                onPick: (it) => {
                  unit.upgradeSlots[i] = it.id;
                  persistState();
                  renderUnits();
                }
              });
            }},
            { label: 'Удалить', kind: 'danger', onClick: () => {
              unit.upgradeSlots[i] = null;
              persistState();
              renderUnits();
            }},
          ]
        }));
      }
    }

    host.appendChild(upGrid);

    // Kill board + Expertise
    const statsWrap = document.createElement('div');
    statsWrap.className = 'stats-layout';

    statsWrap.appendChild(statBox('Таблица убийств', [
      { key: 'melee', label: 'Ближний бой' },
      { key: 'pistol', label: 'Пистолет' },
      { key: 'rifle', label: 'Винтовка' },
      { key: 'hw', label: 'Тяжелое' },
      { key: 'ghouls', label: 'Гули' },
      { key: 'superMutants', label: 'Супермутанты' },
      { key: 'raiders', label: 'Рейдеры' },
      { key: 'animals', label: 'Животные' },
      { key: 'humans', label: 'Люди' },
    ], unit.killBoard, disabled));

    statsWrap.appendChild(statBox('Экспертиза', [
      { key: 'search', label: 'Поиск' },
      { key: 'computer', label: 'Компьютеры' },
      { key: 'lockpick', label: 'Взлом' },
      { key: 'repair', label: 'Ремонт' },
      { key: 'crafting', label: 'Крафт' },
      { key: 'doctor', label: 'Доктор' },
      { key: 'battleCry', label: 'Боевой клич' },
      { key: 'trading', label: 'Торговля' },
    ], unit.expertise, disabled));

    host.appendChild(statsWrap);
  }

  function statBox(title, fields, obj, disabled) {
    const box = document.createElement('div');
    box.className = 'stat-box';

    const h = document.createElement('div');
    h.className = 'stat-box__title';
    h.textContent = title;
    box.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'stat-grid';

    fields.forEach(f => {
      const row = document.createElement('label');
      row.className = 'stat-row';

      const name = document.createElement('span');
      name.textContent = f.label;
      row.appendChild(name);

      const input = document.createElement('input');
      input.className = 'input number smallnum';
      input.type = 'number';
      input.min = '0';
      input.disabled = disabled;
      input.value = String(obj?.[f.key] ?? 0);
      input.addEventListener('input', () => {
        obj[f.key] = clampInt(input.value, 0);
        persistState();
      });
      row.appendChild(input);

      grid.appendChild(row);
    });

    box.appendChild(grid);
    return box;
  }

  // -------------------- Inventory tab --------------------
  function renderInventory() {
    // Inventory actions re-render this view directly, so wipe old nodes first.
    contentEl.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = 'Инвентарь и сундук';
    contentEl.appendChild(title);

    const layout = document.createElement('div');
    layout.className = 'inv-layout';

    const left = document.createElement('section');
    left.className = 'panel-block';

    const card = document.createElement('div');
    card.className = 'unit-card stash-card';
    const img = document.createElement('img');
    img.alt = 'Сундук';
    safeImg(img, STASH_IMG, 'images/missing-unit.png');
    card.appendChild(img);
    left.appendChild(card);

    const hint = document.createElement('div');
    hint.className = 'placeholder';
    hint.textContent = 'Добавляйте предметы в сундук вручную или через генератор. Для экипировки откройте вкладку «Персонажи» и выберите добавление предмета из сундука.';
    hint.style.marginTop = '.75rem';
    left.appendChild(hint);

    // Кнопка "Items generator" ниже карты сундука
    const genBtnBelow = document.createElement('button');
    genBtnBelow.className = 'btn';
    genBtnBelow.textContent = 'Генератор предметов';
    genBtnBelow.style.marginTop = '.75rem';
    genBtnBelow.style.width = '100%';
    genBtnBelow.addEventListener('click', openItemsGenerator);
    left.appendChild(genBtnBelow);

    const actions = document.createElement('div');
    actions.className = 'inv-actions';

    const add = document.createElement('button');
    add.className = 'btn';
    add.textContent = 'Добавить предмет в сундук';
    add.addEventListener('click', () => openItemLibraryPicker({
      title: 'Добавить предмет в сундук',
      filter: () => true,
      onPick: (it) => {
        state.stash.items.push(it.id);
        persistState();
        renderInventory();
      }
    }));
    actions.appendChild(add);

    const genBtn = document.createElement('button');
    genBtn.className = 'btn secondary';
    genBtn.textContent = 'Генератор предметов';
    genBtn.addEventListener('click', openItemsGenerator);
    actions.appendChild(genBtn);
    
    // Кнопка для добавления вещей в сундук по выбору пользователя (как для обычного персонажа)
    const addToStashManualBtn = document.createElement('button');
    addToStashManualBtn.className = 'btn';
    addToStashManualBtn.textContent = 'Добавить предметы вручную';
    addToStashManualBtn.addEventListener('click', () => openItemLibraryPicker({
      title: 'Добавить предметы в сундук',
      filter: () => true, // Доступ ко всем возможным картам вещей
      onPick: (it) => {
        state.stash.items.push(it.id);
        persistState();
        renderInventory();
      }
    }));
    actions.appendChild(addToStashManualBtn);

    const clear = document.createElement('button');
    clear.className = 'btn danger';
    clear.textContent = 'Очистить сундук';
    clear.addEventListener('click', () => {
      state.stash.items = [];
      persistState();
      renderInventory();
    });
    actions.appendChild(clear);

    left.appendChild(actions);

    const right = document.createElement('section');
    right.className = 'panel-block';

    const rTitle = document.createElement('div');
    rTitle.className = 'section-title';
    rTitle.textContent = `Предметов в сундуке: ${state.stash.items.length}`;
    right.appendChild(rTitle);

    if (!state.stash.items.length) {
      const empty = document.createElement('div');
      empty.className = 'placeholder';
      empty.textContent = 'Сундук пуст.';
      right.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'card-grid';

      state.stash.items.forEach((itemId, idx) => {
        const item = db.itemsById[itemId];
        grid.appendChild(cardTileFromItem(item, {
          meta: 'Сундук',
          actions: [
            {
              label: 'Удалить',
              kind: 'danger',
              onClick: () => {
                state.stash.items.splice(idx, 1);
                persistState();
                renderInventory();
              }
            }
          ]
        }));
      });

      right.appendChild(grid);
    }

    layout.appendChild(left);
    layout.appendChild(right);
    contentEl.appendChild(layout);
  }

  // -------------------- UI components --------------------
  function emptySlotTile(title, meta, onAdd) {
    const tile = document.createElement('div');
    tile.className = 'card-tile';

    const body = document.createElement('div');
    body.className = 'card-tile__body';

    const t = document.createElement('div');
    t.className = 'card-tile__title';
    t.textContent = title;
    body.appendChild(t);

    if (meta) {
      const m = document.createElement('div');
      m.className = 'card-tile__meta';
      m.textContent = meta;
      body.appendChild(m);
    }

    const actions = document.createElement('div');
    actions.className = 'card-tile__actions';
    if (onAdd) {
      const btn = document.createElement('button');
      btn.className = 'btn tiny';
      btn.textContent = 'Добавить';
      btn.addEventListener('click', onAdd);
      actions.appendChild(btn);
    } else {
      const msg = document.createElement('div');
      msg.className = 'card-tile__meta';
      msg.textContent = 'Недоступно (пленник)';
      actions.appendChild(msg);
    }
    body.appendChild(actions);

    tile.appendChild(body);
    return tile;
  }

  function cardTileFromItem(item, opts = {}) {
    const tile = document.createElement('div');
    tile.className = 'card-tile';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-tile__img';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = item?.name || '';
    safeImg(img, item?.img || 'images/missing-item.png', 'images/missing-item.png');
    imgWrap.appendChild(img);

    const body = document.createElement('div');
    body.className = 'card-tile__body';

    const title = document.createElement('div');
    title.className = 'card-tile__title';
    title.textContent = item?.name || 'Неизвестный предмет';
    body.appendChild(title);

    if (opts.meta) {
      const meta = document.createElement('div');
      meta.className = 'card-tile__meta';
      meta.textContent = opts.meta;
      body.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'card-tile__actions';

    (opts.actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn tiny';
      if (a.kind === 'danger') btn.classList.add('danger');
      if (a.kind === 'secondary') btn.classList.add('secondary');
      btn.textContent = a.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        a.onClick?.();
      });
      actions.appendChild(btn);
    });

    body.appendChild(actions);

    tile.appendChild(imgWrap);
    tile.appendChild(body);
    return tile;
  }

  // -------------------- picker modal --------------------
  const modal = {
    root: $('#modalRoot'),
    title: $('#modalTitle'),
    tools: $('#modalTools'),
    list: $('#modalList'),
    closeBtn: $('#modalClose'),
    mode: null,
    items: [],
    onPick: null,
    filterFn: null,
    state: { search: '', group: null },
  };

  function openModal(title) {
    modal.title.textContent = title || '';
    modal.root.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    modal.root.classList.add('hidden');
    document.body.classList.remove('modal-open');
    modal.mode = null;
    modal.items = [];
    modal.onPick = null;
    modal.filterFn = null;
    modal.state.search = '';
    modal.state.group = null;
    modal.tools.innerHTML = '';
    modal.list.innerHTML = '';
  }

  modal.closeBtn.addEventListener('click', closeModal);
  $('.backdrop', modal.root).addEventListener('click', closeModal);

  const WEAPON_PRIMARY = new Set(['Melee', 'Pistols', 'Rifles', 'Heavy Weapon', 'Throwing Weapon', 'Mines']);
  function itemMatchesGroup(it, groupKey) {
    const primary = String(it.primary || '').trim();
    const cats = it.cats || {};
    const isMod = !!it.is_mod || cats.Mod;
    switch (groupKey) {
      case 'Weapons': return WEAPON_PRIMARY.has(primary) || Object.values(it.weapon || {}).some(Boolean);
      case 'Armor': return primary === 'Armor' || !!cats.Armor;
      case 'Clothes': return primary === 'Clothes' || !!cats.Clothes;
      case 'Gear': return primary === 'Gear' || !!cats.Gear;
      case 'Food': return primary === 'Food' || !!cats.Food;
      case 'Chems': return primary === 'Chems' || !!cats.Chem;
      case 'Alcohol': return primary === 'Alcohol' || !!cats.Alcohol;
      case 'PowerArmor': return primary === 'Power Armor' || !!cats['Power Armor'];
      case 'Mods': return isMod;
      case 'Perks': return primary === 'Perk' || !!cats.Perks;
      case 'Upgrades': return primary === 'Upgrades' || !!cats.Upgrades;
      case 'Other':
        return !itemMatchesGroup(it, 'Weapons') &&
          !itemMatchesGroup(it, 'Armor') &&
          !itemMatchesGroup(it, 'Clothes') &&
          !itemMatchesGroup(it, 'Gear') &&
          !itemMatchesGroup(it, 'Food') &&
          !itemMatchesGroup(it, 'Chems') &&
          !itemMatchesGroup(it, 'Alcohol') &&
          !itemMatchesGroup(it, 'PowerArmor') &&
          !itemMatchesGroup(it, 'Mods') &&
          !itemMatchesGroup(it, 'Perks') &&
          !itemMatchesGroup(it, 'Upgrades');
      default: return true;
    }
  }

  function renderModalTools(groups = null) {
    modal.tools.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'filter-row';

    const search = document.createElement('input');
    search.className = 'input';
    search.placeholder = 'Поиск...';
    search.value = modal.state.search || '';
    search.addEventListener('input', () => {
      modal.state.search = search.value;
      renderModalList(groups);
    });
    row.appendChild(search);

    modal.tools.appendChild(row);

    if (groups && groups.length) {
      const gRow = document.createElement('div');
      gRow.className = 'filter-row';
      groups.forEach(g => {
        const btn = document.createElement('button');
        btn.className = 'filter';
        btn.textContent = g.label;
        const active = (modal.state.group === g.key) || (g.key === null && modal.state.group === null);
        if (active) btn.classList.add('active');
        btn.addEventListener('click', () => {
          modal.state.group = g.key;
          renderModalTools(groups);
          renderModalList(groups);
        });
        gRow.appendChild(btn);
      });
      modal.tools.appendChild(gRow);
    }
  }

  function renderModalList(groups = null) {
    modal.list.innerHTML = '';
    modal.list.classList.add('picker-items');

    const search = normalizeName(modal.state.search);
    const group = modal.state.group;

    const filtered = modal.items.filter(obj => {
      if (modal.filterFn && !modal.filterFn(obj)) return false;
      if (group && modal.mode === 'items') {
        if (!itemMatchesGroup(obj, group)) return false;
      }
      if (search) {
        const hay = normalizeName(obj.name || obj.title || obj.label || '');
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Нет подходящих карт';
      modal.list.appendChild(empty);
      return;
    }

    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

    filtered.forEach(obj => {
      if (modal.mode === 'units') modal.list.appendChild(unitPickerCard(obj));
      else if (modal.mode === 'stash') modal.list.appendChild(stashPickerCard(obj));
      else modal.list.appendChild(itemPickerCard(obj));
    });
  }

  function unitPickerCard(u) {
    const card = document.createElement('div');
    card.className = 'card card-unit card--picker card--unit';
    card.tabIndex = 0;

    const thumb = document.createElement('div');
    thumb.classList.add('card__thumb');
    const img = document.createElement('img');
    img.className = 'thumb thumb-large card__img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = u.name || '';
    safeImg(img, u.img || 'images/missing-unit.png', 'images/missing-unit.png');
    thumb.appendChild(img);
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'card-body card__body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = u.name || 'Персонаж';
    body.appendChild(title);
    card.appendChild(body);

    const activate = () => { modal.onPick?.(u); closeModal(); };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    return card;
  }

  function itemPickerCard(it) {
    const card = document.createElement('div');
    card.className = 'card card-item card--picker';
    card.tabIndex = 0;

    const thumb = document.createElement('div');
    thumb.classList.add('card__thumb');
    const img = document.createElement('img');
    img.className = 'thumb thumb-item card__img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = it.name || '';
    safeImg(img, it.img || 'images/missing-item.png', 'images/missing-item.png');
    thumb.appendChild(img);
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'card-body card__body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it.name || 'Предмет';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = it.primary ? String(it.primary) : '';
    body.appendChild(title);
    body.appendChild(meta);
    card.appendChild(body);

    const activate = () => { modal.onPick?.(it); closeModal(); };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    return card;
  }

  function stashPickerCard(entry) {
    // entry: {itemId, count}
    const it = db.itemsById[entry.itemId];
    const card = document.createElement('div');
    card.className = 'card card-item card--picker';
    card.tabIndex = 0;

    const thumb = document.createElement('div');
    thumb.classList.add('card__thumb');
    const img = document.createElement('img');
    img.className = 'thumb thumb-item card__img';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = it?.name || '';
    safeImg(img, it?.img || 'images/missing-item.png', 'images/missing-item.png');
    thumb.appendChild(img);
    card.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'card-body card__body';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = it?.name || 'Предмет';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `x${entry.count}`;
    body.appendChild(title);
    body.appendChild(meta);
    card.appendChild(body);

    const activate = () => { modal.onPick?.(entry.itemId); closeModal(); };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    return card;
  }

  function openUnitPicker() {
    modal.mode = 'units';
    modal.items = db.units.slice();
    modal.onPick = (u) => {
      const unit = makeDefaultUnit(u.id);
      state.units.push(unit);
      state.currentUnitIndex = state.units.length - 1;
      persistState();
      renderUnits();
    };
    modal.filterFn = null;
    modal.state.search = '';
    modal.state.group = null;

    openModal('Добавить персонажа');
    renderModalTools(null);
    renderModalList(null);
  }

  function openItemLibraryPicker({ title, filter, onPick }) {
    modal.mode = 'items';
    modal.items = db.items.slice();
    modal.onPick = onPick;
    modal.filterFn = filter || null;
    modal.state.search = '';
    modal.state.group = null;

    const groups = [
      { key: null, label: 'Все' },
      { key: 'Weapons', label: 'Оружие' },
      { key: 'Armor', label: 'Броня' },
      { key: 'Clothes', label: 'Одежда' },
      { key: 'Gear', label: 'Снаряжение' },
      { key: 'Food', label: 'Еда' },
      { key: 'Chems', label: 'Химия' },
      { key: 'Alcohol', label: 'Алкоголь' },
      { key: 'PowerArmor', label: 'Силовая броня' },
      { key: 'Mods', label: 'Моды' },
      { key: 'Perks', label: 'Перки' },
      { key: 'Upgrades', label: 'Улучшения' },
      { key: 'Other', label: 'Прочее' },
    ];

    openModal(title || 'Выбор предмета');
    renderModalTools(groups);
    renderModalList(groups);
  }

  function openStashPicker({ title, onPick }) {
    const counts = new Map();
    state.stash.items.forEach(itemId => counts.set(itemId, (counts.get(itemId) || 0) + 1));
    const entries = Array.from(counts.entries()).map(([itemId, count]) => ({ itemId, count }));

    modal.mode = 'stash';
    modal.items = entries;
    modal.onPick = onPick;
    modal.filterFn = null;
    modal.state.search = '';
    modal.state.group = null;

    openModal(title || 'Сундук');
    renderModalTools(null);
    renderModalList(null);
  }

  // -------------------- Items generator (modal) --------------------
  const gen = {
    root: null,
    closeBtn: null,
    results: null,
    btnGenerate: null,
    btnAddToStash: null,
    wRed: null,
    wBlack: null,
    wGreen: null,
    selection: new Map(), // type -> rarity (red|black|green)
    generated: [],
  };

  // Инициализируем ссылки на элементы генератора
  function initGenElements() {
    gen.root = $('#itemsGenRoot');
    gen.closeBtn = $('#itemsGenClose');
    gen.results = $('#genResults');
    gen.btnGenerate = $('#genOneBtn');
    gen.btnAddToStash = $('#addToStashBtn');
    gen.wRed = $('#wRed');
    gen.wBlack = $('#wBlack');
    gen.wGreen = $('#wGreen');
  }

  function readGenWeights() {
    return {
      red: clampInt(gen.wRed?.value || 5, 0),
      black: clampInt(gen.wBlack?.value || 2, 0),
      green: clampInt(gen.wGreen?.value || 1, 0),
    };
  }

  function itemCandidatesForType(type) {
    const items = db.items;
    switch (type) {
      case 'Weapons': return items.filter(it => itemMatchesGroup(it, 'Weapons') && !it.is_mod);
      case 'Armor': return items.filter(it => itemMatchesGroup(it, 'Armor') && !it.is_mod);
      case 'Clothes': return items.filter(it => itemMatchesGroup(it, 'Clothes') && !it.is_mod);
      case 'Alcohol': return items.filter(it => itemMatchesGroup(it, 'Alcohol') && !it.is_mod);
      case 'Gear': return items.filter(it => itemMatchesGroup(it, 'Gear') && !it.is_mod);
      case 'Food': return items.filter(it => itemMatchesGroup(it, 'Food') && !it.is_mod);
      case 'Chems': return items.filter(it => itemMatchesGroup(it, 'Chems') && !it.is_mod);
      case 'PowerArmor': return items.filter(it => itemMatchesGroup(it, 'PowerArmor') && !it.is_mod);
      case 'Mods': return items.filter(it => !!it.is_mod);
      case 'Junk': return items.filter(it => itemMatchesGroup(it, 'Other') && !it.is_mod);
      default: return [];
    }
  }

  function openItemsGenerator() {
    if (!gen.root) {
      initGenElements();
    }
    if (!gen.root) {
      console.error('Не удалось найти элемент генератора');
      return;
    }
    gen.root.classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderGen();
  }

  function closeItemsGenerator({ autoAdd = true } = {}) {
    if (autoAdd && gen.generated.length) {
      state.stash.items.push(...gen.generated);
      gen.generated = [];
      persistState();
    }
    if (gen.root) {
      gen.root.classList.add('hidden');
    }
    document.body.classList.remove('modal-open');
    render();
  }

  function setGenSelection(type, rarity) {
    if (gen.selection.get(type) === rarity) gen.selection.delete(type);
    else gen.selection.set(type, rarity);
    renderGenSelection();
  }

  function renderGenSelection() {
    $$('.ig-btn', gen.root).forEach(btn => {
      const type = btn.dataset.type;
      const rarity = btn.closest('.ig-row')?.dataset.rarity;
      const active = !!type && !!rarity && gen.selection.get(type) === rarity;
      btn.classList.toggle('active', active);
    });
  }

  function renderGenResults() {
    gen.results.innerHTML = '';
    if (!gen.generated.length) {
      const empty = document.createElement('div');
      empty.className = 'placeholder';
      empty.textContent = 'Пока ничего не сгенерировано.';
      gen.results.appendChild(empty);
      return;
    }

    // Ограничиваем до 8 карт максимум (2 ряда по 4)
    const displayItems = gen.generated.slice(-8);
    
    displayItems.forEach((itemId, idx) => {
      const actualIdx = gen.generated.length - displayItems.length + idx;
      const it = db.itemsById[itemId];
      if (!it) return;
      
      const tile = cardTileFromItem(it, {
        meta: 'Сгенерировано',
        actions: [
          { label: 'Удалить', kind: 'danger', onClick: () => {
            gen.generated.splice(actualIdx, 1);
            renderGenResults();
          }}
        ]
      });
      gen.results.appendChild(tile);
    });
  }

  function generateOneItem() {
    const weights = readGenWeights();
    const entries = [];

    for (const [type, rarity] of gen.selection.entries()) {
      const w = weights[rarity];
      if (!w) continue;
      const candidates = itemCandidatesForType(type);
      if (!candidates.length) continue;
      entries.push({ w, value: candidates });
    }

    if (!entries.length) {
      alert('Выберите хотя бы один тип предметов (иконки) и убедитесь, что вес > 0.');
      return;
    }

    const candidates = weightedChoice(entries);
    const item = randomChoice(candidates);
    if (!item) return;
    
    gen.generated.push(item.id);

    // Ограничиваем до 8 карт максимум (2 ряда по 4) - удаляем самые старые
    if (gen.generated.length > 8) {
      gen.generated = gen.generated.slice(-8);
    }

    renderGenResults();
  }

  function addGeneratedToStash() {
    if (!gen.generated.length) return;
    state.stash.items.push(...gen.generated);
    gen.generated = [];
    persistState();
    renderGenResults();
    render();
  }

  function renderGen() {
    if (!gen.root) return;
    
    // bind icon clicks (once)
    $$('.ig-btn', gen.root).forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const rarity = btn.closest('.ig-row')?.dataset.rarity;
        if (!type || !rarity) return;
        setGenSelection(type, rarity);
      });
    });

    if (gen.btnGenerate && !gen.btnGenerate.dataset.bound) {
      gen.btnGenerate.dataset.bound = '1';
      gen.btnGenerate.addEventListener('click', generateOneItem);
    }
    if (gen.btnAddToStash && !gen.btnAddToStash.dataset.bound) {
      gen.btnAddToStash.dataset.bound = '1';
      gen.btnAddToStash.addEventListener('click', addGeneratedToStash);
    }

    renderGenSelection();
    renderGenResults();
  }

  // Привязываем обработчики генератора после инициализации элементов
  function bindGenHandlers() {
    initGenElements();
    
    if (gen.closeBtn) {
      gen.closeBtn.addEventListener('click', () => closeItemsGenerator());
    }
    const backdrop = gen.root ? $('.backdrop', gen.root) : null;
    if (backdrop) {
      backdrop.addEventListener('click', () => closeItemsGenerator());
    }
  }

  function openUnitPicker() {
    modal.mode = 'units';
    modal.items = db.units.slice();
    modal.onPick = (u) => {
      const unit = makeDefaultUnit(u.id);
      state.units.push(unit);
      state.currentUnitIndex = state.units.length - 1;
      persistState();
      renderUnits();
    };
    modal.filterFn = null;
    modal.state.search = '';
    modal.state.group = null;

    openModal('Добавить персонажа');
    renderModalTools(null);
    renderModalList(null);
  }

  function openItemLibraryPicker({ title, filter, onPick }) {
    modal.mode = 'items';
    modal.items = db.items.slice();
    modal.onPick = onPick;
    modal.filterFn = filter || null;
    modal.state.search = '';
    modal.state.group = null;

    const groups = [
      { key: null, label: 'Все' },
      { key: 'Weapons', label: 'Оружие' },
      { key: 'Armor', label: 'Броня' },
      { key: 'Clothes', label: 'Одежда' },
      { key: 'Gear', label: 'Снаряжение' },
      { key: 'Food', label: 'Еда' },
      { key: 'Chems', label: 'Химия' },
      { key: 'Alcohol', label: 'Алкоголь' },
      { key: 'PowerArmor', label: 'Силовая броня' },
      { key: 'Mods', label: 'Моды' },
      { key: 'Perks', label: 'Перки' },
      { key: 'Upgrades', label: 'Улучшения' },
      { key: 'Other', label: 'Прочее' },
    ];

    openModal(title || 'Выбор предмета');
    renderModalTools(groups);
    renderModalList(groups);
  }

  function openItemsGenerator() {
    if (!gen.root) {
      initGenElements();
    }
    if (!gen.root) {
      console.error('Не удалось найти элемент генератора');
      return;
    }
    gen.root.classList.remove('hidden');
    document.body.classList.add('modal-open');
    renderGen();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toAbsoluteUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, window.location.href).href;
    } catch {
      return raw;
    }
  }

  function locationLabelForUnit(unit) {
    const loc = state.locations.find(x => x.id === unit.locationId);
    if (!loc) return '';
    return (loc.name || '').trim() || 'Локация';
  }

  function printFieldHtml(label, value, extraClass = '') {
    return `
      <div class="print-field ${extraClass}">
        <div class="print-field__label">${escapeHtml(label)}</div>
        <div class="print-field__value">${escapeHtml(value || '')}</div>
      </div>
    `;
  }

  function printTileHtml(item, meta = '', extraClass = '') {
    if (!item) return '';
    const cats = item.cats || {};
    const isPortrait = !!(cats['Power Armor'] || cats.Chem || cats.Alcohol);
    const imgSrc = toAbsoluteUrl(item.img || 'images/missing-item.png');
    const fallbackSrc = toAbsoluteUrl('images/missing-item.png');
    return `
      <article class="print-tile ${isPortrait ? 'print-tile--portrait' : ''} ${extraClass}">
        <div class="print-tile__img">
          <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(item.name || '')}" onerror="this.onerror=null;this.src='${escapeHtml(fallbackSrc)}';">
        </div>
        <div class="print-tile__body">
          <div class="print-tile__title">${escapeHtml(item.name || 'Предмет')}</div>
          <div class="print-tile__meta">${escapeHtml(meta)}</div>
        </div>
      </article>
    `;
  }

  function printEmptyTileHtml(title, meta = '', extraClass = '') {
    return `
      <article class="print-tile print-tile--empty ${extraClass}">
        <div class="print-tile__body">
          <div class="print-tile__title">${escapeHtml(title)}</div>
          <div class="print-tile__meta">${escapeHtml(meta)}</div>
        </div>
      </article>
    `;
  }

  function printPerkGridHtml(unit) {
    const tiles = [];
    for (let i = 0; i < 4; i++) {
      const perkId = unit.perkSlots?.[i] || null;
      const threshold = PERK_XP_THRESHOLDS[i];
      if (perkId && db.itemsById[perkId]) {
        tiles.push(printTileHtml(db.itemsById[perkId], `Перк • XP ${threshold}`));
      } else {
        tiles.push(printEmptyTileHtml(`Перк ${i + 1}`, `XP ${threshold}`));
      }
    }
    return `<div class="print-slot-grid">${tiles.join('')}</div>`;
  }

  function printEquipmentGridHtml(unit) {
    const ids = (unit.equipment || []).slice(0, 8);
    if (!ids.length) return '<div class="print-empty-note">Нет предметов.</div>';
    return `
      <div class="print-tile-grid">
        ${ids.map((itemId) => printTileHtml(db.itemsById[itemId], 'Предмет')).join('')}
      </div>
    `;
  }

  function printUpgradeGridHtml(unit) {
    const tiles = [];
    for (let i = 0; i < 8; i++) {
      const upgradeId = unit.upgradeSlots?.[i] || null;
      const threshold = UPGRADE_XP_THRESHOLDS[i];
      const meta = threshold ? `XP ${threshold}` : '';
      if (upgradeId && db.itemsById[upgradeId]) {
        tiles.push(printTileHtml(db.itemsById[upgradeId], meta ? `Улучшение • ${meta}` : 'Улучшение'));
      } else {
        tiles.push(printEmptyTileHtml(`Улучшение ${i + 1}`, meta));
      }
    }
    return `<div class="print-tile-grid">${tiles.join('')}</div>`;
  }

  function printStatsBoxHtml(title, fields, values) {
    return `
      <section class="print-stats-box">
        <div class="print-stats-box__title">${escapeHtml(title)}</div>
        <div class="print-stats-box__rows">
          ${fields.map((field) => `
            <div class="print-stat-row">
              <span>${escapeHtml(field.label)}</span>
              <strong>${escapeHtml(String(values?.[field.key] ?? 0))}</strong>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function buildUnitPrintPageHtml(unit, index, total) {
    ensureUnitManualFields(unit);

    const cardSrc = toAbsoluteUrl(unit.img || 'images/missing-unit.png');
    const cardFallback = toAbsoluteUrl('images/missing-unit.png');
    const specialBoxes = SPECIAL_MOD_KEYS.map((key) => `
      <div class="print-special-box">${escapeHtml(unit.specialMods?.[key] || '')}</div>
    `).join('');

    const detailsHtml = `
      <div class="print-details-grid">
        ${printFieldHtml('Награда', unit.bounty || '', 'span-2')}
        ${printFieldHtml('Зависимость', unit.addicted || '', 'span-2')}
        ${printFieldHtml('Травма 1', unit.injuries?.[0] || '')}
        ${printFieldHtml('Травма 2', unit.injuries?.[1] || '')}
        ${printFieldHtml('Травма 3', unit.injuries?.[2] || '')}
        ${printFieldHtml('Заметки', unit.notes || '', 'span-4 print-field--notes')}
      </div>
    `;

    const isUpgradesView = state.unitSubTab === 'Upgrades';
    const rightMainHtml = isUpgradesView
      ? `
        <div class="print-section">
          <div class="print-section__title">Слоты перков</div>
          ${printPerkGridHtml(unit)}
        </div>
        <div class="print-section">
          <div class="print-section__title">Улучшения</div>
          ${printUpgradeGridHtml(unit)}
        </div>
        <div class="print-stats-wrap">
          ${printStatsBoxHtml('Таблица убийств', [
            { key: 'melee', label: 'Ближний бой' },
            { key: 'pistol', label: 'Пистолет' },
            { key: 'rifle', label: 'Винтовка' },
            { key: 'hw', label: 'Тяжелое' },
            { key: 'ghouls', label: 'Гули' },
            { key: 'superMutants', label: 'Супермутанты' },
            { key: 'raiders', label: 'Рейдеры' },
            { key: 'animals', label: 'Животные' },
            { key: 'humans', label: 'Люди' },
          ], unit.killBoard)}
          ${printStatsBoxHtml('Экспертиза', [
            { key: 'search', label: 'Поиск' },
            { key: 'computer', label: 'Компьютеры' },
            { key: 'lockpick', label: 'Взлом' },
            { key: 'repair', label: 'Ремонт' },
            { key: 'crafting', label: 'Крафт' },
            { key: 'doctor', label: 'Доктор' },
            { key: 'battleCry', label: 'Боевой клич' },
            { key: 'trading', label: 'Торговля' },
          ], unit.expertise)}
        </div>
      `
      : `
        <div class="print-section">
          <div class="print-section__title">Слоты перков</div>
          ${printPerkGridHtml(unit)}
        </div>
        <div class="print-section">
          <div class="print-section__title">Предметы (максимум 8)</div>
          ${printEquipmentGridHtml(unit)}
        </div>
      `;

    return `
      <section class="print-unit-page">
        <div class="print-sheet-header">
          <div class="print-sheet-header__meta">
            <div>${escapeHtml(state.meta.factionName || 'Без названия фракции')}</div>
            <div>${escapeHtml(state.meta.crewName || 'Без названия банды')}</div>
          </div>
          <div class="print-sheet-header__page">${index + 1} / ${total}</div>
        </div>

        <div class="print-unit-layout">
          <section class="print-panel print-panel--left">
            <div class="print-panel__title">Карточка и параметры</div>

            <div class="print-card-shell">
              <div class="print-card">
                <img src="${escapeHtml(cardSrc)}" alt="${escapeHtml(unit.name || '')}" onerror="this.onerror=null;this.src='${escapeHtml(cardFallback)}';">
              </div>
              <div class="print-special-column">${specialBoxes}</div>
              <div class="print-vision-box">${escapeHtml(unit.visibilityMod || '')}</div>
            </div>

            <div class="print-core-fields">
              ${printFieldHtml('Имя персонажа', unit.name || '', 'span-2')}
              ${printFieldHtml('Локация', locationLabelForUnit(unit) || '—')}
              ${printFieldHtml('Ранг', unit.rank || '')}
              ${printFieldHtml('XP', String(unit.xp ?? 0))}
              ${printFieldHtml('Общая стоимость', String(unitTotalCost(unit)), 'span-2')}
            </div>
          </section>

          <section class="print-panel print-panel--right">
            <div class="print-panel__title">${isUpgradesView ? 'Улучшения' : 'Снаряжение'}</div>
            ${rightMainHtml}
            ${detailsHtml}
          </section>
        </div>
      </section>
    `;
  }

  function buildCampaignPrintHtml(units) {
    const pages = units.map((unit, index) => buildUnitPrintPageHtml(unit, index, units.length)).join('');
    const title = escapeHtml(`Кампания FWW • ${state.meta.crewName || state.meta.factionName || 'Персонажи'}`);

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @page { size: A4 landscape; margin: 5mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, sans-serif; }
    body { font-size: 8.5pt; }
    .print-unit-page { min-height: 100%; page-break-after: always; }
    .print-unit-page:last-child { page-break-after: auto; }
    .print-sheet-header { display: flex; justify-content: space-between; align-items: flex-end; margin: 0 0 2mm; font-size: 7.5pt; color: #444; }
    .print-sheet-header__meta { display: flex; gap: 4mm; flex-wrap: wrap; }
    .print-sheet-header__page { font-weight: 700; }
    .print-unit-layout { display: grid; grid-template-columns: 98mm 1fr; gap: 3mm; align-items: start; }
    .print-panel { border: .35mm solid #111; border-radius: 4mm; padding: 2.5mm; background: #fff; overflow: hidden; }
    .print-panel__title { font-size: 10.5pt; font-weight: 700; margin: 0 0 1.7mm; }
    .print-card-shell { position: relative; width: 92mm; margin: 0 auto 2.2mm; }
    .print-card { width: 92mm; border: .35mm solid #111; border-radius: 4mm; overflow: hidden; background: #fff; }
    .print-card img { width: 100%; display: block; height: auto; }
    .print-special-column { position: absolute; top: 25.2mm; right: -9.1mm; display: grid; gap: 1mm; }
    .print-special-box, .print-vision-box { border: .35mm solid #111; border-radius: 1.5mm; background: #fff; display: flex; align-items: center; justify-content: center; font-size: 8pt; font-weight: 700; }
    .print-special-box { width: 7.8mm; height: 7.2mm; }
    .print-vision-box { position: absolute; right: 3.8mm; bottom: 3.4mm; width: 12mm; height: 7.2mm; }
    .print-core-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2mm; }
    .print-field.span-2 { grid-column: span 2; }
    .print-field.span-3 { grid-column: span 3; }
    .print-field.span-4 { grid-column: span 4; }
    .print-field__label { font-size: 6.7pt; margin-bottom: .6mm; color: #333; }
    .print-field__value { min-height: 6.8mm; border: .3mm solid #111; border-radius: 2.4mm; padding: 1mm 1.5mm; display: flex; align-items: center; overflow: hidden; }
    .print-panel--right { display: flex; flex-direction: column; gap: 1.8mm; }
    .print-section { display: flex; flex-direction: column; gap: 1.6mm; }
    .print-section__title { font-size: 9pt; font-weight: 700; }
    .print-slot-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.6mm; }
    .print-tile-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1.6mm; }
    .print-tile { border: .3mm solid #111; border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; background: #fff; min-height: 22mm; }
    .print-tile--empty { justify-content: center; }
    .print-tile__img { aspect-ratio: 3 / 2; border-bottom: .25mm solid #ccc; display: flex; align-items: center; justify-content: center; padding: 1mm; }
    .print-tile--portrait .print-tile__img { aspect-ratio: 63 / 88; }
    .print-tile__img img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
    .print-tile__body { padding: 1mm 1.1mm 1.2mm; display: flex; flex-direction: column; gap: .45mm; }
    .print-tile__title { font-size: 6.2pt; font-weight: 700; line-height: 1.15; }
    .print-tile__meta { font-size: 5.8pt; color: #444; line-height: 1.15; }
    .print-empty-note { border: .3mm dashed #888; border-radius: 3mm; padding: 4mm; font-size: 8pt; color: #555; }
    .print-details-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1.7mm; }
    .print-field--notes .print-field__value { min-height: 9mm; align-items: flex-start; }
    .print-stats-wrap { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.7mm; }
    .print-stats-box { border: .3mm solid #111; border-radius: 3mm; padding: 1.4mm 1.7mm; }
    .print-stats-box__title { font-size: 8pt; font-weight: 700; margin-bottom: 1mm; }
    .print-stats-box__rows { display: flex; flex-direction: column; gap: .4mm; }
    .print-stat-row { display: flex; justify-content: space-between; gap: 2mm; font-size: 6.6pt; border-bottom: .2mm dashed #ddd; padding-bottom: .25mm; }
    .print-stat-row:last-child { border-bottom: 0; padding-bottom: 0; }
  </style>
</head>
<body>
  ${pages}
  <script>
    window.addEventListener('load', function () {
      var images = Array.prototype.slice.call(document.images || []);
      Promise.all(images.map(function (img) {
        return img.complete ? Promise.resolve() : new Promise(function (resolve) {
          img.onload = img.onerror = resolve;
        });
      })).then(function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 200);
      });
    });
  </script>
</body>
</html>`;
  }

  function exportCampaignPdf() {
    const units = state.units.filter(unit => !unit.isStash);
    if (!units.length) {
      alert('Нет персонажей для экспорта в PDF.');
      return;
    }

    const printWindow = window.open('', '_blank', 'noopener');
    if (!printWindow) {
      alert('Браузер заблокировал окно печати. Разрешите всплывающие окна и повторите.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildCampaignPrintHtml(units));
    printWindow.document.close();
  }

  // -------------------- bindings --------------------
  function bindMeta() {
    const metaFactionName = $('#metaFactionName');
    const metaCrewName = $('#metaCrewName');
    const metaCaps = $('#metaCaps');
    const metaTier = $('#metaTier');
    const metaRep = $('#metaRep');
    const metaNote = $('#metaNote');
    const metaPlayerName = $('#metaPlayerName');
    const metaScout = $('#metaScout');
    const metaAp = $('#metaAp');
    const metaXp = $('#metaXp');

    if (metaFactionName) metaFactionName.addEventListener('input', (e) => { state.meta.factionName = e.target.value; persistState(); });
    if (metaCrewName) metaCrewName.addEventListener('input', (e) => { state.meta.crewName = e.target.value; persistState(); });
    if (metaCaps) metaCaps.addEventListener('input', (e) => { state.meta.caps = clampInt(e.target.value, 0); persistState(); });
    if (metaTier) metaTier.addEventListener('input', (e) => { state.meta.tier = clampInt(e.target.value, 0); persistState(); });
    if (metaRep) metaRep.addEventListener('change', (e) => { state.meta.rep = e.target.value; persistState(); });
    if (metaNote) metaNote.addEventListener('input', (e) => { state.meta.note = e.target.value; persistState(); });
    if (metaPlayerName) metaPlayerName.addEventListener('input', (e) => { state.meta.playerName = e.target.value; persistState(); });

    if (metaScout) metaScout.addEventListener('input', (e) => { state.meta.scout = clampInt(e.target.value, 0); persistState(); });
    if (metaAp) metaAp.addEventListener('input', (e) => { state.meta.ap = clampInt(e.target.value, 0); persistState(); });
    if (metaXp) metaXp.addEventListener('input', (e) => { state.meta.xp = clampInt(e.target.value, 0); persistState(); });

    $$('[data-step]').forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          const step = btn.dataset.step;
          const delta = Number(btn.dataset.delta || 0);
          if (!step || !delta) return;

          if (step === 'scout') state.meta.scout = clampInt((state.meta.scout ?? 0) + delta, 0);
          if (step === 'ap') state.meta.ap = clampInt((state.meta.ap ?? 0) + delta, 0);
          if (step === 'xp') state.meta.xp = clampInt((state.meta.xp ?? 0) + delta, 0);

          persistState();
          renderMeta();
        });
      }
    });
  }

  function bindTabs() {
    $$('.campaign-tabs .tab').forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          if (tab) setActiveTab(tab);
        });
      }
    });
  }

  function bindFooter() {
    const newCrewBtn = $('#newCrewBtn');
    const savePdfBtn = $('#savePdfBtn');
    const saveTxtBtn = $('#saveTxtBtn');
    const loadCrewBtn = $('#loadCrewBtn');
    const loadInput = $('#loadInput');

    if (newCrewBtn) {
      newCrewBtn.addEventListener('click', () => {
        state = deepClone(DEFAULT_STATE);
        persistState();
        render();
      });
    }

    if (savePdfBtn) {
      savePdfBtn.addEventListener('click', exportCampaignPdf);
    }

    if (saveTxtBtn) {
      saveTxtBtn.addEventListener('click', () => {
        const stamp = new Date().toISOString().slice(0, 10);
        downloadText(`fww_campaign_${stamp}.txt`, JSON.stringify(state, null, 2));
      });
    }

    if (loadCrewBtn && loadInput) {
      loadCrewBtn.addEventListener('click', () => loadInput.click());

      loadInput.addEventListener('change', async () => {
        const file = loadInput.files && loadInput.files[0];
        if (!file) return;
        const text = await file.text();
        const parsed = safeJsonParse(text);
        if (!parsed) {
          alert('Не удалось прочитать файл. Ожидается JSON.');
          loadInput.value = '';
          return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        restoreState();
        render();
        loadInput.value = '';
      });
    }
  }

  function bindGeneratorButtons() {
    const openGeneratorTopBtn = $('#openGeneratorTopBtn');
    if (openGeneratorTopBtn) {
      openGeneratorTopBtn.addEventListener('click', openItemsGenerator);
    }
  }

  // -------------------- init --------------------
  async function init() {
    try {
      await loadDb();
    } catch (e) {
      console.error('Ошибка загрузки БД:', e);
      if (contentEl) {
        contentEl.innerHTML = '<div class="panel-block">Ошибка загрузки db/units.json или db/items.json. Проверьте консоль браузера для деталей.</div>';
      }
      return;
    }

    restoreState();

    try {
      bindMeta();
      bindTabs();
      bindFooter();
      bindGeneratorButtons();
      bindGenHandlers(); // Инициализируем элементы генератора

      setActiveTab(state.tab || 'Units');
    } catch (e) {
      console.error('Ошибка инициализации:', e);
      if (contentEl) {
        contentEl.innerHTML = '<div class="panel-block">Ошибка инициализации интерфейса. Проверьте консоль браузера.</div>';
      }
    }
  }

  // Запускаем инициализацию после загрузки DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
