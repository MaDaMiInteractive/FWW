/* Standalone Items Generator (no stash) */

(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function clampInt(value, min = 0, max = Number.POSITIVE_INFINITY) {
    const n = Number.parseInt(String(value), 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function weightedChoice(entries) {
    const total = entries.reduce((s, e) => s + Math.max(0, Number(e.w) || 0), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of entries) {
      r -= Math.max(0, Number(e.w) || 0);
      if (r <= 0) return e.value;
    }
    return entries[entries.length - 1]?.value ?? null;
  }

  function safeImg(imgEl, src, fallback) {
    imgEl.src = src;
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = fallback;
    };
  }

  const db = { items: [], itemsById: {}, itemsMap: {} };

  async function loadDb() {
    db.itemsMap = await fetch('images/items_map.json').then(r => r.json()).catch(() => ({}));
    const items = await fetch('db/items.json').then(r => r.json());
    db.items = (items || []).map(it => ({
      ...it,
      img: db.itemsMap[it.id] || `images/items/${it.id}.png`,
      name: (it.name || '').trim(),
    }));
    db.itemsById = {};
    db.items.forEach(it => { db.itemsById[it.id] = it; });
  }

  const WEAPON_PRIMARY = new Set(['Melee', 'Pistols', 'Rifles', 'Heavy Weapon', 'Throwing Weapon', 'Mines']);
  function itemMatchesGroup(it, groupKey) {
    if (!it) return false;
    const primary = String(it.primary || '').trim();
    const cats = it.cats || {};
    const isMod = !!it.is_mod || cats.Mod;
    switch (groupKey) {
      case 'Weapons':
        return WEAPON_PRIMARY.has(primary) || Object.values(it.weapon || {}).some(Boolean);
      case 'Armor':
        return primary === 'Armor' || !!cats.Armor;
      case 'Clothes':
        return primary === 'Clothes' || !!cats.Clothes;
      case 'Gear':
        return primary === 'Gear' || !!cats.Gear;
      case 'Food':
        return primary === 'Food' || !!cats.Food;
      case 'Chems':
        return primary === 'Chems' || !!cats.Chem;
      case 'Alcohol':
        return primary === 'Alcohol' || !!cats.Alcohol;
      case 'PowerArmor':
        return primary === 'Power Armor' || !!cats['Power Armor'];
      case 'Mods':
        return isMod;
      case 'Other':
        return !itemMatchesGroup(it, 'Weapons') &&
          !itemMatchesGroup(it, 'Armor') &&
          !itemMatchesGroup(it, 'Clothes') &&
          !itemMatchesGroup(it, 'Gear') &&
          !itemMatchesGroup(it, 'Food') &&
          !itemMatchesGroup(it, 'Chems') &&
          !itemMatchesGroup(it, 'Alcohol') &&
          !itemMatchesGroup(it, 'PowerArmor') &&
          !itemMatchesGroup(it, 'Mods');
      default:
        return true;
    }
  }

  function getCandidatesByType(type) {
    switch (type) {
      case 'Weapons': return db.items.filter(it => itemMatchesGroup(it, 'Weapons') && !it.is_mod);
      case 'Armor': return db.items.filter(it => itemMatchesGroup(it, 'Armor') && !it.is_mod);
      case 'Clothes': return db.items.filter(it => itemMatchesGroup(it, 'Clothes') && !it.is_mod);
      case 'Alcohol': return db.items.filter(it => itemMatchesGroup(it, 'Alcohol') && !it.is_mod);
      case 'Gear': return db.items.filter(it => itemMatchesGroup(it, 'Gear') && !it.is_mod);
      case 'Food': return db.items.filter(it => itemMatchesGroup(it, 'Food') && !it.is_mod);
      case 'Chems': return db.items.filter(it => itemMatchesGroup(it, 'Chems') && !it.is_mod);
      case 'PowerArmor': return db.items.filter(it => itemMatchesGroup(it, 'PowerArmor') && !it.is_mod);
      case 'Mods': return db.items.filter(it => !!it.is_mod);
      case 'Junk': return db.items.filter(it => itemMatchesGroup(it, 'Other') && !it.is_mod);
      default: return [];
    }
  }

  const genState = {
    selection: new Map(), // type -> rarity (red|black|green)
    generated: [],
  };

  function readWeights() {
    return {
      red: clampInt($('#wRed').value, 0),
      black: clampInt($('#wBlack').value, 0),
      green: clampInt($('#wGreen').value, 0),
    };
  }

  function setTypeSelection(type, rarity) {
    if (!type) return;
    if (genState.selection.get(type) === rarity) {
      genState.selection.delete(type);
    } else {
      genState.selection.set(type, rarity);
    }
    renderSelection();
  }

  function renderSelection() {
    $$('.ig-btn').forEach(btn => {
      const type = btn.dataset.type;
      const rarity = btn.closest('.ig-row')?.dataset.rarity;
      const active = !!type && !!rarity && genState.selection.get(type) === rarity;
      btn.classList.toggle('active', active);
    });
  }

  function renderResults() {
    const host = $('#genResults');
    host.innerHTML = '';
    if (!genState.generated.length) {
      const empty = document.createElement('div');
      empty.className = 'placeholder';
      empty.textContent = 'Пока ничего не сгенерировано.';
      host.appendChild(empty);
      return;
    }

    genState.generated.forEach((itemId, idx) => {
      const it = db.itemsById[itemId];
      host.appendChild(cardTile(it, idx));
    });
  }

  function cardTile(it, idx) {
    const tile = document.createElement('div');
    tile.className = 'card-tile';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-tile__img';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = it?.name || '';
    safeImg(img, it?.img || 'images/missing-item.png', 'images/missing-item.png');
    imgWrap.appendChild(img);

    const body = document.createElement('div');
    body.className = 'card-tile__body';

    const title = document.createElement('div');
    title.className = 'card-tile__title';
    title.textContent = it?.name || 'Unknown item';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'card-tile__meta';
    meta.textContent = 'Generated';
    body.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'card-tile__actions';

    const del = document.createElement('button');
    del.className = 'btn tiny danger';
    del.textContent = 'Del Item';
    del.addEventListener('click', () => {
      genState.generated.splice(idx, 1);
      renderResults();
    });
    actions.appendChild(del);

    body.appendChild(actions);

    tile.appendChild(imgWrap);
    tile.appendChild(body);
    return tile;
  }

  function generateOne() {
    const weights = readWeights();
    const entries = [];
    for (const [type, rarity] of genState.selection.entries()) {
      const w = weights[rarity];
      if (!w) continue;
      const candidates = getCandidatesByType(type);
      if (!candidates.length) continue;
      entries.push({ w, value: candidates });
    }
    if (!entries.length) {
      alert('Выберите хотя бы один тип предметов (иконки) и убедитесь, что вес > 0.');
      return;
    }
    const candidates = weightedChoice(entries);
    const item = randomChoice(candidates);
    genState.generated.push(item.id);
    if (genState.generated.length > 8) genState.generated = genState.generated.slice(genState.generated.length - 8);
    renderResults();
  }

  function initUi() {
    // bind icons
    $$('.ig-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const rarity = btn.closest('.ig-row')?.dataset.rarity;
        if (!type || !rarity) return;
        setTypeSelection(type, rarity);
      });
    });

    $('#genOneBtn').addEventListener('click', generateOne);
    $('#clearBtn').addEventListener('click', () => { genState.generated = []; renderResults(); });

    renderSelection();
    renderResults();
  }

  async function init() {
    try {
      await loadDb();
    } catch (e) {
      console.error(e);
      alert('Ошибка загрузки db/items.json');
      return;
    }
    initUi();
  }

  init();
})();
