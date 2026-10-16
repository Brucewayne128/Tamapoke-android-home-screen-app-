// TamaPoke Android — portage JavaScript du firmware TamaPoke v1.17 (ESP32-S3)
// d'origine : https://github.com/socquique/TamaPoke (code MIT, Quique Tortosa)
//
// Le portage suit le firmware fonction par fonction (pet.cpp, TamaPoke.ino,
// i18n.cpp, audio.cpp) : mêmes règles, mêmes chiffres, même écran rond
// 466x466. Ce qui change : l'affichage (canvas au lieu de l'AMOLED QSPI), le
// tactile (Pointer Events), le son (WebAudio au lieu de l'ES8311), l'horloge
// (heure du téléphone au lieu du RTC) et la sauvegarde (stockage Android au
// lieu de la NVS).
'use strict';

const D = window.TP_DATA;
// Extensions de ce fork (soif, podomètre, rencontres sauvages). À false, le
// jeu se comporte exactement comme le firmware d'origine (test différentiel).
let TP_EXT = true;
const FW_VERSION = '1.17';
const APP_VERSION = '1.17-android.2';

// ===================================================================== utils
const T0 = performance.now();
function millis() { return Math.floor(performance.now() - T0) + 1; }  // jamais 0 (0 = « inactif »)
function random(a, b) {  // random(max) ou random(min, max) d'Arduino
  if (b === undefined) return a > 0 ? Math.floor(Math.random() * a) : 0;
  return a + Math.floor(Math.random() * (b - a));
}
function timeLeft(deadline) {
  if (!deadline) return 0;
  const left = deadline - millis();
  return left > 0 ? left : 0;
}
const idiv = (a, b) => Math.trunc(a / b);
const C565 = (r, g, b) => (((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
function lerp565(a, b, i, n) {
  if (n <= 0) return a;
  const ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31;
  const br = (b >> 11) & 31, bg = (b >> 5) & 63, bb = b & 31;
  return ((ar + idiv((br - ar) * i, n)) << 11) | ((ag + idiv((bg - ag) * i, n)) << 5) |
         (ab + idiv((bb - ab) * i, n));
}
const cssCache = new Map();
function css(c) {
  let s = cssCache.get(c);
  if (!s) {
    const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
    s = `rgb(${(r << 3) | (r >> 2)},${(g << 2) | (g >> 4)},${(b << 3) | (b >> 2)})`;
    cssCache.set(c, s);
  }
  return s;
}
function rgb565to888(c) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}
// snprintf minimal : %s %d %u %lu, largeur et zéros (%03d, %02d)
function sprintf(fmt, ...args) {
  let i = 0;
  return fmt.replace(/%(0?)(\d*)l?([sdu%])/g, (m, zero, width, conv) => {
    if (conv === '%') return '%';
    let v = args[i++];
    v = conv === 's' ? String(v) : String(Math.trunc(v));
    if (width) v = v.padStart(+width, zero ? '0' : ' ');
    return v;
  });
}

// ================================================================== stockage
// équivalent de Preferences (NVS) : un objet JSON persisté. Sur Android, le
// pont natif TPStore écrit dans SharedPreferences ; sinon localStorage.
const STORE_KEY = 'tamapoke';
const Store = {
  get() {
    try {
      if (window.TPStore) return window.TPStore.getItem(STORE_KEY);
      return localStorage.getItem(STORE_KEY);
    } catch (e) { return null; }
  },
  set(v) {
    try {
      if (window.TPStore) window.TPStore.setItem(STORE_KEY, v);
      else localStorage.setItem(STORE_KEY, v);
    } catch (e) { /* stockage indisponible : on continue sans */ }
  },
};
class Preferences {
  constructor() {
    let o = null;
    try { o = JSON.parse(Store.get() || 'null'); } catch (e) { o = null; }
    this.m = (o && typeof o === 'object') ? o : {};
    this.dirty = false;
  }
  isKey(k) { return Object.prototype.hasOwnProperty.call(this.m, k); }
  get(k, def) { return this.isKey(k) ? this.m[k] : def; }
  put(k, v) { this.m[k] = v; this.dirty = true; }
  clear() { this.m = {}; this.dirty = true; this.flush(); }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    Store.set(JSON.stringify(this.m));
  }
}
const prefs = new Preferences();

// ===================================================================== i18n
const LANG_ES = 0, LANG_EN = 1, LANG_FR = 2, LANG_DE = 3, LANG_IT = 4, LANG_PT = 5,
      LANG_JA = 6, LANG_KO = 7, LANG_COUNT = 8;
const LANG_CODES = ['ES', 'EN', 'FR', 'DE', 'IT', 'PT', 'JA', 'KO'];
const LANG_IS_CJK = (l) => l === LANG_JA || l === LANG_KO;
D.STR_IDS.forEach((name, i) => { window[name] = i; });  // S_EVOLVING... comme l'enum StrId
let gLang = LANG_EN;
const T = (id) => D.STR[LANG_CODES[gLang]][id];
const medalName = (i) => D.MED_NAME[LANG_CODES[gLang]][i];
const medalLabel = (i) => D.MED_LBL[LANG_CODES[gLang]][i];
const medalDesc = (i) => D.MED_DSC[LANG_CODES[gLang]][i];
function loadLang() {
  let v = prefs.get('lang', -1);
  if (v < 0 || v >= LANG_COUNT) {
    // première ouverture : langue du téléphone si le jeu la connaît (le
    // firmware démarre en anglais, faute de savoir où il est)
    const nav = (navigator.language || 'en').slice(0, 2).toUpperCase();
    v = LANG_CODES.indexOf(nav);
    if (v < 0) v = LANG_EN;
    prefs.put('lang', v);
  }
  gLang = v;
}
function setLang(l) {
  if (l < 0 || l >= LANG_COUNT) return;
  gLang = l;
  prefs.put('lang', l);
  prefs.flush();
  if (typeof updateNav === 'function') updateNav();
}

// ====================================================================== dex
const DEX_COUNT = 151, DEX_EEVEE = 133;
const R_EVO = 0, R_COMUN = 1, R_RARO = 2, R_LEGENDARIO = 3;
const DEX_TBL = D.DEX;
const CLASSIC_DEX = D.CLASSIC_DEX;
function dexName(dex) {
  if (dex < 1 || dex > DEX_COUNT) return DEX_TBL[0].name;
  const n = gLang === LANG_FR ? D.DEX_NAME_FR[dex]
          : gLang === LANG_DE ? D.DEX_NAME_DE[dex]
          : gLang === LANG_JA ? D.DEX_NAME_JA[dex]
          : gLang === LANG_KO ? D.DEX_NAME_KO[dex] : null;
  return n || DEX_TBL[dex].name;
}

// ==================================================================== audio
const SFX_TAP = 0, SFX_EAT = 1, SFX_PLAY = 2, SFX_HEART = 3, SFX_HATCH = 4,
      SFX_EVOLVE = 5, SFX_MEDAL = 6, SFX_DENY = 7, SFX_BYE = 8, SFX_LEVEL = 9,
      SFX_DRINK = 10, SFX_WILD = 11, SFX_HIT = 12, SFX_WIN = 13;
const SFX = [
  [[880, 35]],
  [[660, 45], [0, 12], [660, 45]],
  [[784, 45], [988, 60]],
  [[1047, 55], [1319, 90]],
  [[523, 80], [659, 80], [784, 110], [1047, 170]],
  [[523, 80], [659, 80], [784, 80], [1047, 90], [1319, 230]],
  [[784, 70], [0, 25], [784, 70], [0, 25], [1047, 200]],
  [[300, 110], [200, 170]],
  [[784, 150], [659, 150], [523, 280]],
  [[784, 70], [1047, 130]],
  // ajouts du fork
  [[523, 40], [0, 15], [659, 40], [0, 15], [784, 55]],                 // boire
  [[988, 60], [0, 20], [988, 60], [0, 20], [1319, 140]],               // rencontre !
  [[220, 40], [165, 60]],                                              // coup reçu
  [[659, 70], [784, 70], [988, 70], [1319, 200]],                      // victoire
];
const audio = {
  ctx: null, on: true, sleeping: false, cursor: 0,
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
  },
};
function audioBegin() {
  audio.on = prefs.get('snd', true);
  sfxPlay(SFX_HATCH);  // jingle de démarrage (comme sur la carte)
}
function sfxPlay(id) {
  if (!audio.on || audio.sleeping) return;
  audio.ensure();
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running') return;
  // file d'attente comme la tâche audio : un effet suit le précédent
  let t = Math.max(ctx.currentTime + 0.01, audio.cursor);
  if (t - ctx.currentTime > 2) return;  // file pleine : on jette (xQueueSend, 0)
  for (const [f, ms] of SFX[id]) {
    const d = ms / 1000;
    if (f) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      const amp = 0.12;  // 5000/32768 sur la carte, un peu adouci pour un haut-parleur de téléphone
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);          // attaque 64 éch. @16 kHz
      g.gain.setValueAtTime(amp, Math.max(t + 0.004, t + d - 0.006));
      g.gain.linearRampToValueAtTime(0, t + d);                // chute 96 éch.
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + d + 0.01);
    }
    t += d;
  }
  audio.cursor = t;
}
function audioSetEnabled(on) { audio.on = on; prefs.put('snd', on); prefs.flush(); }
function audioEnabled() { return audio.on; }
function audioSetSleeping(s) { audio.sleeping = s; }

// ====================================================================== pet
const PET_TICK_MS = 60000;
const MINUTES_PER_LEVEL = 60;
const EAT_ANIM_MS = 2500, HEART_MS = 1500, EVOLVE_ANIM_MS = 5200, CEREMONY_MS = 10000;
const FAREWELL_AGE_MIN = 3 * 24 * 60;
const RUNAWAY_TICKS = 60;
const CER_NONE = 0, CER_FAREWELL = 1, CER_RUNAWAY = 2, CER_RELEASE = 3;
const MOOD_HAPPY = 0, MOOD_SAD = 1, MOOD_EATING = 2, MOOD_SLEEPING = 3;
const MED_LV10 = 1, MED_LV25 = 2, MED_LV50 = 4, MED_BERRY = 8, MED_STREAK7 = 16,
      MED_BOND = 32, MED_FINAL = 64, MED_FIT = 128;
const MED_COUNT = 8;

const clamp100 = (v) => (v < 0 ? 0 : (v > 100 ? 100 : v));
// progression hors ligne : barres plancher à 15 (il revient affamé, pas mort)
function dropTo(v, d, fl) {
  if (v <= fl) return v;
  return (v - fl > d) ? v - d : fl;
}
const min = Math.min;

class Pet {
  constructor() {
    this.fullness = 80; this.joy = 80; this.energy = 80; this.hygiene = 100;
    this.poops = 0; this.weight = 0;
    this.geneAtk = 100; this.geneDef = 100; this.geneSpe = 100;
    this.trAtk = 0; this.trDef = 0; this.trSpe = 0;
    this.berryKnown = false; this.shiny = false;
    this.ageMinutes = 0; this.speciesId = -1; this.prevSpeciesId = -1;
    this.careMistakes = 0; this.sleeping = false; this.lastSeenEpoch = 0;
    this.ceremony = CER_NONE; this.lastEnd = CER_NONE;
    this.dexReg = new Array(19).fill(0); this.dexShinyReg = new Array(19).fill(0);
    this.streak = 0; this.bestStreak = 0; this.lastCareDay = 0; this.bond = 0;
    this.nick = ''; this.medals = 0; this.totalMedals = 0; this.newMedal = 0;
    this.lastMilestone = 0; this.gameHi = 0; this.strHi = 0;
    // --- fork : soif + podomètre + rencontres
    this.water = 80;          // 0..100, comme les 4 autres besoins
    this.drinkUntil = 0;
    this.stepsTotal = 0;      // pas cumulés depuis l'installation
    this.stepsToday = 0; this.stepsDay = 0; this.stepsBest = 0;
    this.stepsToEnc = 600;    // pas restants avant la prochaine rencontre
    this.encSpan = 600;       // longueur de la jauge en cours (affichage)
    this.pendingEnc = 0;      // rencontres en attente (max 3)
    this.accSpe = 0; this.accWgt = 0;  // reliquats de pas pour l'entraînement
    this.reservedEgg = 0; this.reservedShiny = false;  // œuf gardé après une capture
    this.battlesWon = 0; this.battlesLost = 0;
    this.dexCaught = new Array(19).fill(0);  // capturés en combat (sous-ensemble du Pokédex)
    // privé dans le C++
    this.lastTick = 0; this.eatUntil = 0; this.heartUntil = 0; this.evolveUntil = 0;
    this.eggTarget = 1; this.eggShiny = false; this.eggTaps = 0; this.mistakeCooldown = 0;
    this.ticksSinceSave = 0; this.pendingSave = false; this.evoDeclinedLv = 0;
    this.farDeclinedAge = 0; this.starterPick = false; this.neglectTicks = 0;
    this.goodTicks = 0; this.ceremonyUntil = 0; this.bondToday = 0;
    this.medalUntil = 0; this.milestoneUntil = 0;
  }

  begin() {
    if (!prefs.get('init', false)) {
      prefs.put('init', true);
      this.newEgg();
    } else {
      this.load();
    }
    this.lastTick = millis();
  }

  newEgg() {
    this.ceremony = CER_NONE;
    this.neglectTicks = 0;
    this.weight = 0;
    this.speciesId = -1;
    this.prevSpeciesId = -1;
    this.eggTarget = this.pickEggSpecies();
    this.starterPick = (this.registeredCount() === 0);
    let reservedShiny = false;
    if (TP_EXT && this.reservedEgg > 0 && !this.starterPick) {
      this.eggTarget = this.reservedEgg;  // l'œuf du Pokémon capturé
      reservedShiny = this.reservedShiny;
      this.reservedEgg = 0;
      this.reservedShiny = false;
    }
    let shinyBase = (this.lastEnd === CER_FAREWELL ? 24 : 48) - this.careBonus();
    if (shinyBase < 8) shinyBase = 8;
    this.eggShiny = (random(shinyBase) === 0) || reservedShiny;
    this.eggTaps = 0;
    if (TP_EXT) this.water = 80;
    this.fullness = 80; this.joy = 80; this.energy = 80; this.hygiene = 100;
    this.poops = 0;
    this.ageMinutes = 0;
    this.careMistakes = 0;
    this.mistakeCooldown = 0;
    this.sleeping = false;
    this.save();
  }

  setClock(nowEpoch) {
    this.lastSeenEpoch = nowEpoch;
    if (nowEpoch) this.save();
  }

  // applique le temps écoulé pendant que l'appli était fermée (comme le RTC)
  syncClock(nowEpoch) {
    const seen = prefs.get('seen', 0);
    this.lastSeenEpoch = nowEpoch;
    if (nowEpoch === 0) return 0;
    let mins = (seen && nowEpoch > seen) ? Math.floor((nowEpoch - seen) / 60) : 0;
    if (mins < 2 || this.ceremony !== CER_NONE || this.starterPick) {
      this.save();
      return 0;
    }
    if (mins > 14 * 24 * 60) mins = 14 * 24 * 60;  // plafond : 2 semaines
    for (let i = 0; i < mins; i++) {
      this.ageMinutes++;
      if (this.isEgg()) {
        if (this.ageMinutes >= 3) this.hatch();
        continue;
      }
      if (this.sleeping) {
        this.energy = clamp100(this.energy + 6);
        if (this.ageMinutes % 2 === 0) {
          this.fullness = dropTo(this.fullness, 1, 30);
          this.joy = dropTo(this.joy, 1, 35);
        }
        if (this.ageMinutes % 3 === 0) this.hygiene = dropTo(this.hygiene, 1, 45);
        if (TP_EXT && this.ageMinutes % 2 === 0) this.water = dropTo(this.water, 1, 30);
        continue;
      }
      if (TP_EXT) this.water = dropTo(this.water, 1, 15);
      this.fullness = dropTo(this.fullness, 2, 15);
      this.energy = dropTo(this.energy, 1, 15);
      this.hygiene = dropTo(this.hygiene, 1, 15);
      this.joy = dropTo(this.joy, 1, 15);
    }
    if (!this.isEgg()) {
      if (!this.sleeping) {
        const p = this.poops + Math.floor(mins / 240);
        this.poops = p > 3 ? 3 : p;
      }
    }
    console.log(`offline: ${mins} min appliquées (nv.${this.level()})`);
    this.save();
    return mins;
  }

  update(nowMs) {
    if (this.ceremony !== CER_NONE && !timeLeft(this.ceremonyUntil)) {
      this.newEgg();
      return;
    }
    while (nowMs - this.lastTick >= PET_TICK_MS) {
      this.lastTick += PET_TICK_MS;
      this.tick();
    }
  }

  tick() {
    if (this.ceremony !== CER_NONE) return;
    if (this.starterPick) return;
    this.ageMinutes++;

    if (this.isEgg()) {
      if (this.ageMinutes >= 3) this.hatch();
      return;
    }

    if (this.sleeping) {
      this.energy = clamp100(this.energy + 6);
      if (this.weight > 0 && this.ageMinutes % 3 === 0) this.weight--;
      if (this.ageMinutes % 2 === 0) {
        this.fullness = dropTo(this.fullness, 1, 30);
        this.joy = dropTo(this.joy, 1, 35);
      }
      if (this.ageMinutes % 3 === 0) this.hygiene = dropTo(this.hygiene, 1, 45);
      if (TP_EXT && this.ageMinutes % 2 === 0) this.water = dropTo(this.water, 1, 30);
      this.checkMedals();
      if (++this.ticksSinceSave >= 5) this.pendingSave = true;
      return;
    }

    if (this.ageMinutes % MINUTES_PER_LEVEL === 0) sfxPlay(SFX_LEVEL);

    this.fullness = clamp100(this.fullness - 2);
    this.energy = clamp100(this.energy - 1);
    if (TP_EXT) this.water = clamp100(this.water - 1);
    if (this.fullness > 40 && this.poops < 3 && random(100) < 15) this.poops++;

    this.hygiene = clamp100(this.hygiene - 1 - 4 * this.poops);
    if (this.weight > 50) this.energy = clamp100(this.energy - 1);
    if (this.weight > 0 && this.ageMinutes % 3 === 0) this.weight--;

    if (this.lowestStat() >= 40) {
      if (++this.goodTicks >= 720) {
        this.goodTicks = 0;
        if (this.trDef < 100) this.trDef++;
      }
    } else {
      this.goodTicks = 0;
    }

    let dJoy = -1;
    if (this.fullness < 30) dJoy -= 2;
    if (this.hygiene < 30) dJoy -= 2;
    if (TP_EXT && this.water < 30) dJoy -= 2;
    this.joy = clamp100(this.joy + dJoy);

    if (this.mistakeCooldown > 0) this.mistakeCooldown--;
    if (this.lowestStat() <= 10 && this.mistakeCooldown === 0) {
      this.careMistakes = Math.min(255, this.careMistakes + 1);
      this.mistakeCooldown = 60;
      if (this.bond > 1) this.bond--;
    }

    this.checkMedals();

    if (this.fullness === 0 && this.joy === 0 && this.energy === 0 && this.hygiene === 0 &&
        (!TP_EXT || this.water === 0)) {
      if (this.neglectTicks < RUNAWAY_TICKS) this.neglectTicks++;
    } else {
      this.neglectTicks = 0;
    }

    if (++this.ticksSinceSave >= 5) this.pendingSave = true;
  }

  flushSave() { if (this.pendingSave) this.save(); }
  savePending() { return this.pendingSave; }

  lineHasUnregistered(base) {
    let cur = base;
    for (let guard = 0; cur >= 1 && cur <= 151 && guard < 6; guard++) {
      if (!this.isRegistered(cur)) return true;
      if (cur === DEX_EEVEE) {
        for (let b = 134; b <= 136; b++) if (!this.isRegistered(b)) return true;
        return false;
      }
      cur = DEX_TBL[cur].evolvesTo;
    }
    return false;
  }

  eggRarity() {
    return (this.eggTarget >= 1 && this.eggTarget <= 151) ? DEX_TBL[this.eggTarget].rarity : R_COMUN;
  }

  pickEggSpecies() {
    if (this.registeredCount() === 0) return CLASSIC_DEX[random(CLASSIC_DEX.length)];
    let tier = R_COMUN;
    if (this.lastEnd !== CER_RUNAWAY) {
      const blessed = (this.lastEnd === CER_FAREWELL);
      const rare = (blessed ? 45 : 27) + this.careBonus();
      const leg = (this.registeredCount() >= 25) ? (blessed ? 10 : 3) + idiv(this.careBonus(), 3) : 0;
      const r = random(100);
      if (r < leg) tier = R_LEGENDARIO;
      else if (r < leg + rare) tier = R_RARO;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let t = tier; t >= R_COMUN; t--) {
        const cand = [];
        for (let d = 1; d <= 151 && cand.length < 80; d++) {
          if (DEX_TBL[d].rarity !== t) continue;
          if (pass === 0 && !this.lineHasUnregistered(d)) continue;
          cand.push(d);
        }
        if (cand.length > 0) return cand[random(cand.length)];
      }
    }
    return CLASSIC_DEX[random(CLASSIC_DEX.length)];
  }

  registerSpecies(dex) {
    if (dex < 1 || dex > 151) return;
    this.dexReg[(dex - 1) >> 3] |= (1 << ((dex - 1) & 7));
    if (this.shiny) this.dexShinyReg[(dex - 1) >> 3] |= (1 << ((dex - 1) & 7));
  }

  careBonus() {
    const s = this.streak > 30 ? 30 : this.streak;
    return idiv(s, 3) + idiv(this.bond, 25);
  }

  today() { return this.lastSeenEpoch ? Math.floor(this.lastSeenEpoch / 86400) : 0; }

  registerCare() {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    const d = this.today();
    if (d === 0 || d === this.lastCareDay) return;
    if (this.lastCareDay === 0 || d === this.lastCareDay + 1) {
      this.streak++;
    } else {
      this.streak = 1;
      this.lastMilestone = 0;
    }
    this.lastCareDay = d;
    this.bondToday = 0;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    this.bond = clamp100(this.bond + 4);
    const ms = (this.streak >= 100) ? 100 : (this.streak >= 30) ? 30
             : (this.streak >= 7) ? 7 : (this.streak >= 3) ? 3 : 0;
    if (ms > this.lastMilestone) {
      this.lastMilestone = ms;
      this.milestoneUntil = millis() + 4500;
    }
    this.checkMedals();
    this.save();
  }

  addBond(amt) {
    if (this.bondToday >= 20) return;
    this.bond = clamp100(this.bond + amt);
    this.bondToday += amt;
  }

  checkMedals() {
    if (this.isEgg()) return;
    const before = this.medals;
    const lv = this.level();
    if (lv >= 10) this.medals |= MED_LV10;
    if (lv >= 25) this.medals |= MED_LV25;
    if (lv >= 50) this.medals |= MED_LV50;
    if (this.berryKnown) this.medals |= MED_BERRY;
    if (this.streak >= 7) this.medals |= MED_STREAK7;
    if (this.bond >= 100) this.medals |= MED_BOND;
    if (DEX_TBL[this.speciesId].evolvesTo === 0) this.medals |= MED_FINAL;
    if (this.weight === 0 && lv >= 5 && this.careMistakes === 0) this.medals |= MED_FIT;
    const gained = this.medals & ~before;
    if (gained) {
      for (let m = gained; m; m &= (m - 1)) this.totalMedals++;
      this.newMedal = gained;
      this.medalUntil = millis() + 4000;
      if (!this.sleeping) sfxPlay(SFX_MEDAL);
      this.save();
    }
  }

  rename(name) {
    this.nick = String(name).slice(0, 11);
    this.save();
  }

  atkStat() { return this.isEgg() ? 0 : calcStat(DEX_TBL[this.speciesId].bAtk, this.geneAtk, this.level(), this.trAtk); }
  defStat() { return this.isEgg() ? 0 : calcStat(DEX_TBL[this.speciesId].bDef, this.geneDef, this.level(), this.trDef); }
  speStat() { return this.isEgg() ? 0 : calcStat(DEX_TBL[this.speciesId].bSpe, this.geneSpe, this.level(), this.trSpe); }

  registeredCount() {
    let n = 0;
    for (let i = 1; i <= 151; i++) if (this.isRegistered(i)) n++;
    return n;
  }

  canFarewellNow() {
    return !this.isEgg() && !this.sleeping && this.ceremony === CER_NONE &&
           DEX_TBL[this.speciesId].evolvesTo === 0 && this.ageMinutes >= FAREWELL_AGE_MIN;
  }
  canRunawayNow() {
    return !this.isEgg() && !this.sleeping && this.ceremony === CER_NONE &&
           this.neglectTicks >= RUNAWAY_TICKS;
  }

  startFarewell() {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    this.lastEnd = CER_FAREWELL;
    this.ceremony = CER_FAREWELL;
    this.ceremonyUntil = millis() + CEREMONY_MS;
    this.heartUntil = this.ceremonyUntil;
    sfxPlay(SFX_BYE);
    this.save();
  }
  startRunaway() {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    this.lastEnd = CER_RUNAWAY;
    this.ceremony = CER_RUNAWAY;
    this.ceremonyUntil = millis() + CEREMONY_MS;
    sfxPlay(SFX_BYE);
    this.save();
  }
  release() {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    this.lastEnd = CER_RELEASE;
    this.ceremony = CER_RELEASE;
    this.ceremonyUntil = millis() + CEREMONY_MS;
    this.heartUntil = this.ceremonyUntil;
    sfxPlay(SFX_BYE);
    this.save();
  }

  hatch() {
    this.speciesId = this.eggTarget;
    this.shiny = this.eggShiny;
    this.geneAtk = 90 + random(21);
    this.geneDef = 90 + random(21);
    this.geneSpe = 90 + random(21);
    this.trAtk = this.trDef = this.trSpe = 0;
    this.berryKnown = false;
    this.bond = 0;
    this.bondToday = 0;
    this.medals = 0;
    this.newMedal = 0;
    this.nick = '';
    this.registerSpecies(this.speciesId);
    this.checkMedals();
    sfxPlay(SFX_HATCH);
    this.save();
  }

  canEvolveNow() {
    if (this.isEgg() || this.sleeping || this.ceremony !== CER_NONE) return false;
    const d = DEX_TBL[this.speciesId];
    if (d.evolvesTo === 0) return false;
    return this.level() >= d.evolveLevel + this.careMistakes && this.lowestStat() >= 40;
  }

  evolve() {
    if (!this.canEvolveNow()) return;
    const d = DEX_TBL[this.speciesId];
    this.prevSpeciesId = this.speciesId;
    let next = d.evolvesTo;
    if (this.speciesId === DEX_EEVEE) {
      const opts = [];
      for (let b = 134; b <= 136; b++) if (!this.isRegistered(b)) opts.push(b);
      next = opts.length > 0 ? opts[random(opts.length)] : 134 + random(3);
    }
    this.speciesId = next;
    this.registerSpecies(this.speciesId);
    sfxPlay(SFX_EVOLVE);
    this.evolveUntil = millis() + EVOLVE_ANIM_MS;
    this.save();
  }

  feed() { this.feedBerry(0); }

  feedBerry(color) {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    if (this.lovesBerry(color)) {
      this.fullness = clamp100(this.fullness + 35);
      this.joy = clamp100(this.joy + 10);
      this.heartUntil = millis() + HEART_MS;
      this.berryKnown = true;
      this.addBond(2);
    } else {
      this.fullness = clamp100(this.fullness + 25);
    }
    if (TP_EXT) this.water = clamp100(this.water + 5);
    this.eatUntil = millis() + EAT_ANIM_MS;
    this.registerCare();
    this.save();
  }

  // ------------------------------------------------------------ fork : boire
  drink() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.water = clamp100(this.water + 35);
    this.drinkUntil = millis() + EAT_ANIM_MS;
    this.registerCare();
    this.save();
  }
  drinking() { return timeLeft(this.drinkUntil) > 0; }

  // ------------------------------------------------------- fork : podomètre
  addSteps(n) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    const d = this.today();
    if (d && d !== this.stepsDay) { this.stepsDay = d; this.stepsToday = 0; }
    this.stepsTotal += n;
    this.stepsToday += n;
    if (this.stepsToday > this.stepsBest) this.stepsBest = this.stepsToday;
    let gained = 0;
    let left = n;
    while (left > 0) {
      if (this.pendingEnc >= 3) { this.stepsToEnc = 0; break; }  // jauge pleine : elle attend
      const k = Math.min(left, this.stepsToEnc);
      this.stepsToEnc -= k;
      left -= k;
      if (this.stepsToEnc <= 0) {
        this.pendingEnc++;
        gained++;
        this.stepsToEnc = this.pendingEnc >= 3 ? 0 : 400 + random(800);  // ~800 pas en moyenne
        if (this.stepsToEnc) this.encSpan = this.stepsToEnc;
      }
    }
    // marcher entraîne : +1 VIT tous les 1000 pas, -1 de poids tous les 300
    if (!this.isEgg()) {
      this.accSpe += n;
      this.accWgt += n;
      while (this.accSpe >= 1000) { this.accSpe -= 1000; if (this.trSpe < 100) this.trSpe++; }
      while (this.accWgt >= 300) { this.accWgt -= 300; if (this.weight > 0) this.weight--; }
    }
    this.save();
    return gained;
  }
  // jauge pleine quand des places se libèrent : relance un compte à rebours
  rearmEncounter() {
    if (this.pendingEnc < 3 && this.stepsToEnc <= 0) { this.stepsToEnc = 400 + random(800); this.encSpan = this.stepsToEnc; }
  }
  canBattle() {
    return !this.isEgg() && !this.sleeping && this.ceremony === CER_NONE && this.pendingEnc > 0;
  }
  hpMax() { return this.isEgg() ? 0 : battleHp(DEX_TBL[this.speciesId].bHp, this.level()) + Math.floor(this.bond / 10); }
  isCaught(dex) {
    return dex >= 1 && dex <= 151 && !!(this.dexCaught[(dex - 1) >> 3] & (1 << ((dex - 1) & 7)));
  }
  // choisit le Pokémon sauvage : surtout des formes de base communes, parfois
  // des rares ou des évolués, très rarement un légendaire (Pokédex >= 25)
  pickWild() {
    const lv = this.level();
    let tier;
    const r = random(100);
    const legOk = this.registeredCount() >= 25;
    if (legOk && r < 1) tier = R_LEGENDARIO;
    else if (r < 61) tier = R_COMUN;
    else if (r < 86) tier = R_RARO;
    else tier = R_EVO;
    let cand = [];
    // les formes évoluées n'apparaissent qu'une fois ton compagnon assez fort
    for (let d = 1; d <= 151; d++) {
      if (DEX_TBL[d].rarity !== tier) continue;
      if (tier === R_EVO && evoLevelOf(d) > lv) continue;
      cand.push(d);
    }
    if (!cand.length) {
      for (let d = 1; d <= 151; d++) if (DEX_TBL[d].rarity === R_COMUN) cand.push(d);
      tier = R_COMUN;
    }
    const dex = cand[random(cand.length)];
    let wl = Math.max(1, lv - 3 + random(4));  // un peu plus faible que toi en moyenne
    if (tier === R_LEGENDARIO) wl += 3;
    if (wl > 100) wl = 100;
    const d = DEX_TBL[dex];
    const g = () => 85 + random(16);
    return {
      dex, lv: wl, shiny: random(64) === 0,
      atk: calcStat(d.bAtk, g(), wl, 0), def: calcStat(d.bDef, g(), wl, 0), spe: calcStat(d.bSpe, g(), wl, 0),
      hp: battleHp(d.bHp, wl),
    };
  }
  // fin de combat : la rencontre est consommée dans tous les cas
  battleResult(result, wild) {  // result : 1 victoire, 0 défaite, -1 fuite
    if (this.pendingEnc > 0) this.pendingEnc--;
    this.rearmEncounter();
    if (result >= 0) {
      this.energy = dropTo(this.energy, 15, 5);
      this.fullness = dropTo(this.fullness, 5, 5);
      this.water = dropTo(this.water, 8, 5);
    }
    if (result === 1) {
      this.joy = clamp100(this.joy + 10);
      if (this.trAtk < 100) this.trAtk++;
      if (this.trDef < 100) this.trDef++;
      this.battlesWon++;
      // capturé : il rejoint le Pokédex (et le Pokédex shiny s'il brille)
      const dex = wild.dex;
      this.dexReg[(dex - 1) >> 3] |= (1 << ((dex - 1) & 7));
      this.dexCaught[(dex - 1) >> 3] |= (1 << ((dex - 1) & 7));
      if (wild.shiny) this.dexShinyReg[(dex - 1) >> 3] |= (1 << ((dex - 1) & 7));
      this.addBond(2);
      this.heartUntil = millis() + HEART_MS;
    } else if (result === 0) {
      this.joy = clamp100(this.joy - 8);
      this.battlesLost++;
    }
    if (result >= 0) this.registerCare();
    this.save();
  }
  reserveEgg(wild) {
    this.reservedEgg = baseFormOf(wild.dex);
    this.reservedShiny = !!wild.shiny;
    this.save();
  }

  feedCandy() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.fullness = clamp100(this.fullness + 10);
    this.joy = clamp100(this.joy + 12);
    this.weight = clamp100(this.weight + 12);
    this.eatUntil = millis() + EAT_ANIM_MS;
    this.registerCare();
    this.save();
  }

  lovesBerry(color) { return !this.isEgg() && (this.speciesId % 3) === color; }

  playResult(score) {
    if (this.ceremony !== CER_NONE || this.isEgg()) return;
    const v = this.trSpe + idiv(score, 5);
    this.trSpe = v > 100 ? 100 : v;
    this.joy = clamp100(this.joy + 5 + (score > 15 ? 30 : score * 2));
    this.energy = dropTo(this.energy, 10 + idiv(score, 2), 5);
    this.fullness = dropTo(this.fullness, 5, 5);
    if (TP_EXT) this.water = dropTo(this.water, 5, 5);
    const burn = this.weight - score * 2;
    this.weight = burn > 0 ? burn : 0;
    if (score >= 5) this.heartUntil = millis() + HEART_MS;
    if (score > this.gameHi) this.gameHi = score;
    this.addBond(2);
    this.registerCare();
    this.save();
  }

  trainStrength(hits) {
    if (this.ceremony !== CER_NONE || this.isEgg()) return 0;
    let gain = idiv(hits, 4) & 0xFF;
    if (gain > 18) gain = 18;
    const antes = this.trAtk;
    const v = this.trAtk + gain;
    this.trAtk = v > 100 ? 100 : v;
    gain = this.trAtk - antes;
    this.energy = dropTo(this.energy, 12, 5);
    this.fullness = dropTo(this.fullness, 5, 5);
    if (TP_EXT) this.water = dropTo(this.water, 5, 5);
    const burn = this.weight - idiv(hits, 3);
    this.weight = burn > 0 ? burn : 0;
    this.joy = clamp100(this.joy + 6);
    if (hits >= 20) this.heartUntil = millis() + HEART_MS;
    if (hits > this.strHi) this.strHi = hits;
    this.addBond(2);
    this.registerCare();
    this.save();
    return gain;
  }

  play() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.joy = clamp100(this.joy + 25);
    this.energy = clamp100(this.energy - 10);
    this.fullness = clamp100(this.fullness - 5);
    this.heartUntil = millis() + HEART_MS;
    this.addBond(2);
    this.registerCare();
    this.save();
  }

  toggleLight() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg()) return;
    this.sleeping = !this.sleeping;
    this.save();
  }

  clean() {
    if (this.ceremony !== CER_NONE) return;
    this.poops = 0;
    this.hygiene = 100;
    this.addBond(1);
    this.registerCare();
    this.save();
  }

  caress() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.joy = clamp100(this.joy + 5);
    this.heartUntil = millis() + HEART_MS;
    this.addBond(1);
    this.registerCare();
  }

  eggTap() {
    if (!this.isEgg()) return;
    if (++this.eggTaps >= 3) this.hatch();
    else this.save();
  }

  isEgg() { return this.speciesId < 0; }
  eggCracks() { return this.eggTaps; }
  eating() { return timeLeft(this.eatUntil) > 0; }
  showHeart() { return timeLeft(this.heartUntil) > 0; }
  evolving() { return timeLeft(this.evolveUntil) > 0; }
  evolveT() { return 1 - timeLeft(this.evolveUntil) / EVOLVE_ANIM_MS; }
  wantEvolveButton() { return this.canEvolveNow() && this.level() > this.evoDeclinedLv; }
  wantFarewellButton() { return this.canFarewellNow() && this.ageMinutes >= this.farDeclinedAge; }
  declineEvolve() { this.evoDeclinedLv = this.level(); }
  declineFarewell() { this.farDeclinedAge = this.ageMinutes + 1440; }
  awaitingStarter() { return this.starterPick; }
  chooseStarter(dex) { this.eggTarget = dex; this.starterPick = false; this.save(); }
  factoryReset() { prefs.clear(); }
  dbgRunawayReady() {
    this.fullness = this.joy = this.energy = this.hygiene = 0;
    this.neglectTicks = RUNAWAY_TICKS;
  }
  level() {
    const lv = 1 + Math.floor(this.ageMinutes / MINUTES_PER_LEVEL);
    return lv > 999 ? 999 : lv;
  }
  isRegistered(dex) {
    return dex >= 1 && dex <= 151 && !!(this.dexReg[(dex - 1) >> 3] & (1 << ((dex - 1) & 7)));
  }
  isShinyRegistered(dex) {
    return dex >= 1 && dex <= 151 && !!(this.dexShinyReg[(dex - 1) >> 3] & (1 << ((dex - 1) & 7)));
  }
  lowestStat() {
    const m = min(min(this.fullness, this.joy), min(this.energy, this.hygiene));
    return TP_EXT ? min(m, this.water) : m;
  }
  mood() {
    if (this.sleeping) return MOOD_SLEEPING;
    if (this.eating() || (TP_EXT && this.drinking())) return MOOD_EATING;
    if (this.lowestStat() < 25) return MOOD_SAD;
    return MOOD_HAPPY;
  }
  ceremonyT() {
    if (this.ceremony === CER_NONE) return 0;
    return 1 - timeLeft(this.ceremonyUntil) / CEREMONY_MS;
  }
  hasMedal(m) { return !!(this.medals & m); }
  showMedal() { return timeLeft(this.medalUntil) > 0; }
  showMilestone() { return timeLeft(this.milestoneUntil) > 0; }
  savedEpoch() { return prefs.get('seen', 0); }

  save() {
    this.ticksSinceSave = 0;
    this.pendingSave = false;
    const P = (k, v) => prefs.put(k, v);
    P('full', this.fullness); P('joy', this.joy); P('ene', this.energy); P('hyg', this.hygiene);
    P('poop', this.poops); P('wgt', this.weight);
    P('gatk', this.geneAtk); P('gdef', this.geneDef); P('gspe', this.geneSpe);
    P('tatk', this.trAtk); P('tdef', this.trDef); P('tspe', this.trSpe);
    P('bk', this.berryKnown); P('shy', this.shiny); P('eshy', this.eggShiny);
    P('stpk', this.starterPick);
    P('dexsh', this.dexShinyReg.slice());
    P('age', this.ageMinutes);
    P('dexn', this.speciesId); P('eggT2', this.eggTarget);
    P('crack', this.eggTaps); P('mist', this.careMistakes);
    P('sleep', this.sleeping); P('lend', this.lastEnd);
    if (this.lastSeenEpoch) P('seen', this.lastSeenEpoch);
    P('dexreg', this.dexReg.slice());
    P('strk', this.streak); P('bstrk', this.bestStreak); P('cday', this.lastCareDay);
    P('bond', this.bond); P('medal', this.medals); P('tmedal', this.totalMedals);
    P('mstone', this.lastMilestone); P('ghi', this.gameHi); P('shi', this.strHi);
    P('nick', this.nick);
    // ces trois-là n'étaient pas persistés sur la carte (un redémarrage les
    // remettait à zéro) ; ici l'appli est fermée bien plus souvent
    P('evodl', this.evoDeclinedLv); P('fardl', this.farDeclinedAge); P('bondt', this.bondToday);
    P('wat', this.water); P('stT', this.stepsTotal); P('stD', this.stepsToday); P('stDay', this.stepsDay);
    P('stBest', this.stepsBest); P('stEnc', this.stepsToEnc); P('stSpan', this.encSpan); P('stPend', this.pendingEnc);
    P('stAs', this.accSpe); P('stAw', this.accWgt); P('rEgg', this.reservedEgg); P('rShy', this.reservedShiny);
    P('bWon', this.battlesWon); P('bLost', this.battlesLost); P('dexc', this.dexCaught.slice());
    prefs.flush();
  }

  load() {
    const G = (k, d) => prefs.get(k, d);
    this.fullness = G('full', 80); this.joy = G('joy', 80); this.energy = G('ene', 80);
    this.hygiene = G('hyg', 100); this.poops = G('poop', 0); this.weight = G('wgt', 0);
    this.geneAtk = G('gatk', 0); this.geneDef = G('gdef', 0); this.geneSpe = G('gspe', 0);
    if (this.geneAtk === 0) {
      this.geneAtk = 90 + random(21); this.geneDef = 90 + random(21); this.geneSpe = 90 + random(21);
    }
    this.trAtk = G('tatk', 0); this.trDef = G('tdef', 0); this.trSpe = G('tspe', 0);
    this.berryKnown = G('bk', false); this.shiny = G('shy', false);
    this.eggShiny = G('eshy', false); this.starterPick = G('stpk', false);
    const sh = G('dexsh', null); if (Array.isArray(sh) && sh.length === 19) this.dexShinyReg = sh.slice();
    this.ageMinutes = G('age', 0);
    this.speciesId = G('dexn', -1);
    this.eggTarget = G('eggT2', 4);
    this.eggTaps = G('crack', 0); this.careMistakes = G('mist', 0);
    this.sleeping = G('sleep', false); this.lastEnd = G('lend', CER_NONE);
    const rg = G('dexreg', null); if (Array.isArray(rg) && rg.length === 19) this.dexReg = rg.slice();
    this.streak = G('strk', 0); this.bestStreak = G('bstrk', 0); this.lastCareDay = G('cday', 0);
    this.bond = G('bond', 0); this.medals = G('medal', 0); this.totalMedals = G('tmedal', 0);
    this.lastMilestone = G('mstone', 0); this.gameHi = G('ghi', 0); this.strHi = G('shi', 0);
    this.nick = G('nick', '');
    this.evoDeclinedLv = G('evodl', 0); this.farDeclinedAge = G('fardl', 0); this.bondToday = G('bondt', 0);
    this.water = G('wat', 80); this.stepsTotal = G('stT', 0); this.stepsToday = G('stD', 0);
    this.stepsDay = G('stDay', 0); this.stepsBest = G('stBest', 0); this.stepsToEnc = G('stEnc', 600); this.encSpan = G('stSpan', 600);
    this.pendingEnc = G('stPend', 0); this.accSpe = G('stAs', 0); this.accWgt = G('stAw', 0);
    this.reservedEgg = G('rEgg', 0); this.reservedShiny = G('rShy', false);
    this.battlesWon = G('bWon', 0); this.battlesLost = G('bLost', 0);
    const dc = G('dexc', null); if (Array.isArray(dc) && dc.length === 19) this.dexCaught = dc.slice();
    if (this.speciesId >= 1) this.registerSpecies(this.speciesId);
  }
}
function calcStat(base, gene, lvl, tr) { return idiv(base * gene, 100) + lvl + tr; }

// ---- fork : combat
function battleHp(bHp, lv) { return 30 + Math.floor(bHp * 0.6) + lv * 2; }
// dégâts : ~20 à forces égales (3 à 6 coups par combat), +50 % sur un coup au bon moment
function battleDamage(atk, def, crit) {
  let d = Math.floor(atk * 22 / (def + 5) * (85 + random(16)) / 100);
  if (crit) d = Math.floor(d * 1.5);
  return Math.max(2, d);
}
// forme précédente de chaque espèce (Évoli : 134-136 -> 133)
const PREV_OF = (() => {
  const p = new Array(152).fill(0);
  for (let d = 1; d <= 151; d++) { const n = D.DEX[d].evolvesTo; if (n) p[n] = d; }
  for (let b = 134; b <= 136; b++) p[b] = 133;
  return p;
})();
function baseFormOf(dex) {
  let d = dex;
  for (let g = 0; g < 4 && PREV_OF[d]; g++) d = PREV_OF[d];
  return d;
}
// niveau auquel on peut croiser une forme évoluée (celui de sa forme précédente)
function evoLevelOf(dex) {
  const p = PREV_OF[dex];
  return p ? D.DEX[p].evolveLevel || 30 : 1;
}

// ---- fork : textes ajoutés (8 langues). Les langues latines passent en CP437
// comme les chaînes du firmware, pour la police bitmap.
const CP437 = { 'é': 0x82, 'è': 0x8A, 'ê': 0x88, 'ë': 0x89, 'à': 0x85, 'â': 0x83, 'ä': 0x84, 'ç': 0x87,
  'ù': 0x97, 'û': 0x96, 'ü': 0x81, 'ô': 0x93, 'ö': 0x94, 'î': 0x8C, 'ï': 0x8B, 'ñ': 0xA4, 'á': 0xA0,
  'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'É': 0x90, 'Ç': 0x80, 'Ä': 0x8E, 'Ö': 0x99, 'Ü': 0x9A, 'Ñ': 0xA5, '¡': 0xAD,
  '¿': 0xA8, 'ã': 0x61, 'õ': 0x6F, 'ì': 0x8D, 'ò': 0x95, 'ß': 0xE1 };
function toCp437(s) {
  let o = '';
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) o += ch;
    else if (CP437[ch]) o += String.fromCharCode(CP437[ch]);
    else o += ch.normalize('NFD')[0];  // majuscule accentuée absente de CP437 : lettre nue
  }
  return o;
}
//        ES, EN, FR, DE, IT, PT, JA, KO
const XSTR_SRC = {
  X_BAR_WATER: ['BEB', 'H2O', 'EAU', 'TRK', 'ACQ', 'AGU', 'みず', '수분'],
  X_THIRSTY: ['¡Tiene sed!', "It's thirsty!", 'Il a soif!', 'Hat Durst!', 'Ha sete!', 'Está com sede!', 'のどかわいた！', '목말라요!'],
  X_DRINKING: ['¡Glu glu!', 'Gulp gulp!', 'Glou glou!', 'Gluck gluck!', 'Glu glu!', 'Glub glub!', 'ごくごく！', '꿀꺽꿀꺽!'],
  X_PED_TITLE: ['PODÓMETRO', 'PEDOMETER', 'PODOMÈTRE', 'SCHRITTE', 'PEDOMETRO', 'PEDÔMETRO', 'まんぽけい', '만보기'],
  X_STEPS_TODAY: ['pasos hoy', 'steps today', "pas aujourd'hui", 'Schritte heute', 'passi oggi', 'passos hoje', 'きょうの ほすう', '오늘 걸음'],
  X_STEPS_TOTAL: ['Total: %u  Récord: %u', 'Total: %u  Best: %u', 'Total: %u  Record: %u', 'Gesamt: %u  Rek.: %u', 'Totale: %u  Rec.: %u', 'Total: %u  Recorde: %u', 'ごうけい %u  さいこう %u', '총 %u  최고 %u'],
  X_NEXT_ENC: ['Encuentro en %u pasos', 'Encounter in %u steps', 'Rencontre dans %u pas', 'Begegnung in %u Schr.', 'Incontro tra %u passi', 'Encontro em %u passos', 'あと %u ほで であい', '%u걸음 후 만남'],
  X_ENC_FULL: ['¡Hay Pokémon esperando!', 'Wild Pokémon waiting!', 'Des POKEMON attendent!', 'Pokémon warten!', 'Pokémon in attesa!', 'Pokémon esperando!', 'ポケモンが まってる！', '포켓몬이 기다려요!'],
  X_ENC_COUNT: ['Encuentros: %u/3', 'Encounters: %u/3', 'Rencontres: %u/3', 'Begegnungen: %u/3', 'Incontri: %u/3', 'Encontros: %u/3', 'であい %u/3', '만남 %u/3'],
  X_WILD_BTN: ['¡Un POKEMON salvaje!', 'A wild POKEMON!', 'Un POKEMON sauvage!', 'Ein wildes POKEMON!', 'Un POKEMON selvatico!', 'Um POKEMON selvagem!', 'やせいの ポケモンだ！', '야생 포켓몬이다!'],
  X_WILD_NAME: ['¡%s salvaje!', 'Wild %s!', '%s sauvage!', 'Wildes %s!', '%s selvatico!', '%s selvagem!', 'やせいの %s！', '야생 %s!'],
  X_FLEE: ['HUIR', 'RUN', 'FUIR', 'FLUCHT', 'FUGA', 'FUGIR', 'にげる', '도망'],
  X_FLED: ['¡Escapaste!', 'Got away safely!', 'Vous avez fui!', 'Entkommen!', 'Sei fuggito!', 'Você fugiu!', 'うまく にげた！', '도망쳤다!'],
  X_ATTACKS: ['¡%s ataca!', '%s attacks!', '%s attaque!', '%s greift an!', '%s attacca!', '%s ataca!', '%s の こうげき！', '%s의 공격!'],
  X_CRIT: ['¡Golpe perfecto!', 'Perfect hit!', 'Coup parfait!', 'Volltreffer!', 'Colpo perfetto!', 'Golpe perfeito!', 'かいしんの いちげき！', '회심의 일격!'],
  X_TAP_HINT: ['¡Toca en el círculo!', 'Tap when it shrinks!', 'Tape au bon moment!', 'Tippe im Takt!', 'Tocca al momento giusto!', 'Toque na hora certa!', 'タイミングよく タッチ！', '타이밍 맞춰 터치!'],
  X_WIN: ['¡VICTORIA!', 'VICTORY!', 'VICTOIRE!', 'SIEG!', 'VITTORIA!', 'VITÓRIA!', 'しょうり！', '승리!'],
  X_LOSE: ['DERROTA...', 'DEFEAT...', 'DÉFAITE...', 'NIEDERLAGE...', 'SCONFITTA...', 'DERROTA...', 'まけた...', '패배...'],
  X_CAUGHT: ['¡%s capturado!', '%s caught!', '%s capturé!', '%s gefangen!', '%s catturato!', '%s capturado!', '%s を つかまえた！', '%s 포획!'],
  X_KEEP_EGG: ['¿Guardar su huevo?', 'Keep its egg?', 'Garder son oeuf?', 'Ei behalten?', 'Tenere il suo uovo?', 'Guardar o ovo?', 'タマゴを もらう？', '알을 받을까요?'],
  X_NEXT_EGG: ['Próximo huevo: %s', 'Next egg: %s', 'Prochain oeuf: %s', 'Nächstes Ei: %s', 'Prossimo uovo: %s', 'Próximo ovo: %s', 'つぎの タマゴ: %s', '다음 알: %s'],
  X_TOO_TIRED: ['Muy cansado...', 'Too tired...', 'Trop fatigué...', 'Zu müde...', 'Troppo stanco...', 'Muito cansado...', 'つかれてる...', '너무 지쳤어요...'],
  X_NO_SENSOR: ['Sin podómetro', 'No step sensor', 'Pas de podomètre', 'Kein Schrittzähler', 'Nessun contapassi', 'Sem pedômetro', 'ほすうけい なし', '만보기 없음'],
  X_ALLOW: ['Toca: activar pasos', 'Tap: allow steps', 'Touche: autoriser', 'Tippen: erlauben', 'Tocca: consenti', 'Toque: permitir', 'タッチで きょか', '터치: 허용'],
  X_WALK_HINT: ['¡Camina para encontrar Pokémon!', 'Walk to meet wild Pokémon!', 'Marche pour trouver des POKEMON', 'Lauf, um Pokémon zu finden!', 'Cammina per trovare Pokémon!', 'Ande para achar Pokémon!', 'あるいて ポケモンを さがそう', '걸어서 포켓몬을 찾자!'],
  X_WINS: ['Victorias: %u', 'Wins: %u', 'Victoires: %u', 'Siege: %u', 'Vittorie: %u', 'Vitórias: %u', 'しょうり %u', '승리 %u'],
};
const XSTR = {};
for (const k of Object.keys(XSTR_SRC)) {
  XSTR[k] = XSTR_SRC[k].map((v, i) => (i >= 6 ? v : toCp437(v)));
}
const TX = (k) => XSTR[k][gLang];

