// TamaPoke Android — interface (portage de TamaPoke.ino) : sprites, rendu, tactile.
// La logique du jeu (pet.cpp, i18n, audio) est dans core.js.
'use strict';

// ================================================================== sprites
const PMD_IDLE = 0, PMD_WALKL = 1, PMD_WALKR = 2, PMD_SLEEP = 3, PMD_EAT = 4, PMD_HURT = 5,
      PMD_ATTACK = 6, PMD_POSE = 7, PMD_HOP = 8, PMD_NOD = 9, PMD_BREATH = 10, PMD_SIT = 11,
      PMD_NACTS = 12;

function loadBinary(path) {
  return new Promise((resolve) => {
    const viaBridge = () => {
      try {
        if (window.TPStore && window.TPStore.readAsset) {
          const b64 = window.TPStore.readAsset('www/' + path);
          if (b64) {
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            resolve(u8);
            return;
          }
        }
      } catch (e) { /* rien */ }
      resolve(null);
    };
    try {
      const x = new XMLHttpRequest();
      x.open('GET', path, true);
      x.responseType = 'arraybuffer';
      x.onload = () => {
        if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength) {
          resolve(new Uint8Array(x.response));
        } else viaBridge();
      };
      x.onerror = viaBridge;
      x.send();
    } catch (e) { viaBridge(); }
  });
}

// une image indexée (w x h, 0xFF = transparent) -> canvas RGBA
function indexedToCanvas(data, off, w, h, pal565, sil) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(w, h);
  const px = img.data;
  const k = rgb565to888(INK_K);
  for (let i = 0; i < w * h; i++) {
    const idx = data[off + i];
    if (idx === 0xFF) continue;
    const c = sil ? k : (pal565[idx] !== undefined ? rgb565to888(pal565[idx]) : [255, 0, 255]);
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  return cv;
}

// TPK2 analysé (même validation que PmdMon::load)
function parseTPK2(blob) {
  if (!blob || blob.length < 7) return null;
  if (String.fromCharCode(blob[0], blob[1], blob[2], blob[3]) !== 'TPK2') return null;
  const nActs = blob[4];
  const palCount = blob[5] | (blob[6] << 8);
  if (palCount > 256 || 7 + palCount * 2 > blob.length) return null;
  const pal = [];
  for (let i = 0; i < palCount; i++) pal.push(blob[7 + i * 2] | (blob[8 + i * 2] << 8));
  const acts = [];
  for (let i = 0; i < PMD_NACTS; i++) acts.push({ w: 0, h: 0, frames: 0, base: 0, ms: [], off: 0, cv: [], sil: [] });
  let p = 7 + palCount * 2;
  const end = blob.length;
  for (let i = 0; i < nActs && p + 4 <= end; i++) {
    const id = blob[p], w = blob[p + 1], h = blob[p + 2], nf = blob[p + 3];
    p += 4;
    if (id >= PMD_NACTS || nf > 24) return null;
    const bytes = nf * 2 + w * h * nf;
    if (w === 0 || h === 0 || nf === 0 || p + bytes > end) return null;
    const a = acts[id];
    a.w = w; a.h = h; a.frames = nf;
    for (let k = 0; k < nf; k++) {
      let ms = blob[p] | (blob[p + 1] << 8);
      if (ms === 0) ms = 100;
      a.ms.push(ms);
      p += 2;
    }
    a.off = p;
    p += w * h * nf;
    let base = 1;
    for (let f = 0; f < nf; f++) {
      const fo = a.off + f * w * h;
      for (let r = h - 1; r >= 0; r--) {
        let any = false;
        for (let c = 0; c < w && !any; c++) if (blob[fo + r * w + c] !== 0xFF) any = true;
        if (any) { if (r + 1 > base) base = r + 1; break; }
      }
    }
    a.base = base;
  }
  return { blob, pal, acts };
}

const pmdCache = new Map();   // chemin -> données analysées (ou null)
const pmdPending = new Map(); // chemin -> Promise
function fetchPmd(path) {
  if (pmdCache.has(path)) return Promise.resolve(pmdCache.get(path));
  if (pmdPending.has(path)) return pmdPending.get(path);
  const pr = loadBinary(path).then((b) => {
    const parsed = parseTPK2(b);
    pmdCache.set(path, parsed);
    pmdPending.delete(path);
    // garde les ~24 derniers en mémoire
    if (pmdCache.size > 24) pmdCache.delete(pmdCache.keys().next().value);
    return parsed;
  });
  pmdPending.set(path, pr);
  return pr;
}
const pad3 = (n) => String(n).padStart(3, '0');

class PmdMon {
  constructor() { this.loaded = false; this.loading = false; this.data = null; this.key = null; }
  get acts() { return this.data ? this.data.acts : EMPTY_ACTS; }
  get pal() { return this.data ? this.data.pal : []; }
  has(a) { return this.loaded && a < PMD_NACTS && this.data.acts[a].frames > 0; }
  load(dexNum, shiny = false) {
    this.unload();
    const key = `${dexNum}:${shiny ? 1 : 0}`;
    this.key = key;
    const shPath = `mons/ps${pad3(dexNum)}.bin`, nPath = `mons/p${pad3(dexNum)}.bin`;
    const apply = (d) => {
      if (this.key !== key) return;
      this.loading = false;
      if (d) { this.data = d; this.loaded = true; }
    };
    const first = shiny ? shPath : nPath;
    if (pmdCache.has(first) && pmdCache.get(first)) { apply(pmdCache.get(first)); return true; }
    this.loading = true;
    fetchPmd(first).then((d) => {
      if (!d && shiny) return fetchPmd(nPath);  // pas de shiny : le normal
      return d;
    }).then(apply);
    return true;
  }
  unload() { this.loaded = false; this.loading = false; this.data = null; this.key = null; }
}
const EMPTY_ACTS = Array.from({ length: PMD_NACTS }, () => ({ w: 0, h: 0, frames: 0, base: 0, ms: [], off: 0, cv: [], sil: [] }));

function pmdFrameCanvas(m, a, fi, sil) {
  const arr = sil ? a.sil : a.cv;
  if (!arr[fi]) arr[fi] = indexedToCanvas(m.data.blob, a.off + fi * a.w * a.h, a.w, a.h, m.data.pal, sil);
  return arr[fi];
}

// miniatures de la galerie (thumbs.bin)
const thumbs = {
  loaded: false, data: null, count: 0, size: 0, cache: new Map(),
  load() {
    return loadBinary('mons/thumbs.bin').then((d) => {
      if (!d || d.length < 10 || String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'TPTH') return;
      this.count = d[4] | (d[5] << 8);
      if (6 + 4 * this.count > d.length) return;
      this.data = d; this.size = d.length; this.loaded = true;
      galleryDirty = true;
    });
  },
  get(dex) {
    if (!this.loaded || dex < 1 || dex > this.count) return null;
    const d = this.data, o = 6 + 4 * (dex - 1);
    const off = (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
    if (off > this.size - 3) return null;
    const need = 3 + d[off + 2] * 2 + d[off] * d[off + 1];
    if (need > this.size || off > this.size - need) return null;
    return { dex, off };
  },
  canvas(t, sil) {
    const key = t.dex * 2 + (sil ? 1 : 0);
    let cv = this.cache.get(key);
    if (!cv) {
      const d = this.data, off = t.off;
      const w = d[off], h = d[off + 1], n = d[off + 2];
      const pal = [];
      for (let i = 0; i < n; i++) pal.push(d[off + 3 + i * 2] | (d[off + 4 + i * 2] << 8));
      cv = indexedToCanvas(d, off + 3 + n * 2, w, h, pal, sil);
      this.cache.set(key, cv);
    }
    return cv;
  },
};

// ====================================================================== gfx
// Émule l'API Arduino_GFX sur un canvas : on dessine en coordonnées 466x466
// et le canvas est à la résolution réelle de l'écran (net à toute taille).
const LCD = 466;
const RGB565_BLACK = 0x0000;
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
let K = 1;  // pixels physiques par pixel « carte »

const gfx = {
  textColor: 0xFFFF, textSize: 1, cx: 0, cy: 0,
  begin() {
    const size = canvas.clientWidth || 466;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round(size * dpr));
    canvas.width = px; canvas.height = px;
    K = px / LCD;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, px, px);
    ctx.beginPath();
    ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
    ctx.clip();  // l'écran est rond : le clip vit en pixels physiques
    ctx.imageSmoothingEnabled = false;
  },
  // rectangles calés sur la grille physique : pas de joints entre bandes
  fillRect(x, y, w, h, c) {
    if (w <= 0 || h <= 0) return;
    const X0 = Math.round(x * K), Y0 = Math.round(y * K);
    const X1 = Math.round((x + w) * K), Y1 = Math.round((y + h) * K);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(c);
    ctx.fillRect(X0, Y0, Math.max(1, X1 - X0), Math.max(1, Y1 - Y0));
  },
  fillScreen(c) { this.fillRect(0, 0, LCD, LCD, c); },
  _t() { ctx.setTransform(K, 0, 0, K, 0, 0); },
  fillCircle(x, y, r, c) {
    if (r < 0) return;
    this._t();
    ctx.fillStyle = css(c);
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, r + 0.5, 0, Math.PI * 2);
    ctx.fill();
  },
  drawCircle(x, y, r, c) {
    if (r < 0) return;
    this._t();
    ctx.strokeStyle = css(c);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
  },
  _rr(x, y, w, h, r) {
    const m = Math.min(w, h) / 2;
    if (r > m) r = m;
    if (r < 0) r = 0;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },
  fillRoundRect(x, y, w, h, r, c) {
    if (w <= 0 || h <= 0) return;
    this._t();
    ctx.fillStyle = css(c);
    this._rr(x, y, w, h, r);
    ctx.fill();
  },
  drawRoundRect(x, y, w, h, r, c) {
    if (w <= 0 || h <= 0) return;
    this._t();
    ctx.strokeStyle = css(c);
    ctx.lineWidth = 1;
    this._rr(x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.stroke();
  },
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    this._t();
    ctx.fillStyle = css(c);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.lineTo(x2 + 0.5, y2 + 0.5);
    ctx.closePath();
    ctx.fill();
  },
  drawLine(x0, y0, x1, y1, c) {
    this._t();
    ctx.strokeStyle = css(c);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.stroke();
  },
  // image (sprite) posée sur la grille physique, sans lissage
  image(cv, x, y, w, h) {
    const X0 = Math.round(x * K), Y0 = Math.round(y * K);
    const X1 = Math.round((x + w) * K), Y1 = Math.round((y + h) * K);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cv, X0, Y0, X1 - X0, Y1 - Y0);
  },
  setTextColor(c) { this.textColor = c; },
  setTextSize(s) { this.textSize = s; },
  setCursor(x, y) { this.cx = x; this.cy = y; },
  getCursorX() { return this.cx; },
  getCursorY() { return this.cy; },
  print(s) {
    s = String(s);
    if (gCjkFont) { this._printCjk(s); return; }
    const ts = this.textSize;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) & 0xFF;
      if (c === 10) { this.cx = 0; this.cy += ts * 8; continue; }
      if (c === 13) continue;
      if (this.cx + ts * 6 - 1 > LCD - 1) { this.cx = 0; this.cy += ts * 8; }  // wrap
      this.image(glyph(c, this.textColor), this.cx, this.cy, 5 * ts, 8 * ts);
      this.cx += ts * 6;
    }
  },
  _cjkFont() { return `${16 * this.textSize}px "Noto Sans CJK JP","Noto Sans JP","Noto Sans KR",sans-serif`; },
  _printCjk(s) {
    this._t();
    ctx.font = this._cjkFont();
    ctx.textBaseline = 'top';
    ctx.fillStyle = css(this.textColor);
    ctx.fillText(s, this.cx, this.cy);
    this.cx += ctx.measureText(s).width;
  },
  textWidthCjk(s) {
    ctx.font = this._cjkFont();
    return Math.round(ctx.measureText(s).width);
  },
};

// glyphes de la police classique 5x7 (CP437), mis en cache par couleur
const glyphCache = new Map();
function glyph(c, color) {
  const key = c * 65536 + color;
  let cv = glyphCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = 5; cv.height = 8;
  const g = cv.getContext('2d');
  const img = g.createImageData(5, 8);
  const [r, gg, b] = rgb565to888(color);
  for (let i = 0; i < 5; i++) {
    let line = D.FONT[c * 5 + i];
    for (let j = 0; j < 8; j++, line >>= 1) {
      if (line & 1) {
        const p = (j * 5 + i) * 4;
        img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  glyphCache.set(key, cv);
  return cv;
}

// cartes de pixels de species.h ('.' = transparent)
const mapCache = new Map();
function mapCanvas(name, sil) {
  const key = name + (sil ? '#s' : '');
  let cv = mapCache.get(key);
  if (cv) return cv;
  const rows = D.SPR[name];
  const n = rows.length;
  cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const g = cv.getContext('2d');
  const img = g.createImageData(n, n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const ch = rows[r][c];
      if (ch === '.' || ch === undefined) continue;
      const col = sil ? INK_K : (D.SPR_PAL[ch] || 0);
      const [R, G, B] = rgb565to888(col);
      const p = (r * n + c) * 4;
      img.data[p] = R; img.data[p + 1] = G; img.data[p + 2] = B; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mapCache.set(key, cv);
  return cv;
}

// ---- icônes ajoutées par le fork (même palette que species.h)
D.SPR.SPR_ICON_DRINK = [
  '................',
  '................',
  '...kkkkkkkkkk...',
  '...kw.......k...',
  '...kw.......k...',
  '...kbbbbbbbbk...',
  '...kwbbbbbbBk...',
  '....kbbbbbBk....',
  '....kwbbbbBk....',
  '....kbbbbbBk....',
  '....kwbbbbBk....',
  '....kbbbbbBk....',
  '.....kbbbBk.....',
  '.....kkkkkk.....',
  '................',
  '................',
];
D.SPR.SPR_ICON_STEP = [
  '................',
  '..kk............',
  '.kwwk...........',
  '.kwwwk..........',
  '.kwwwk.....kk...',
  '.kwwwk....kwwk..',
  '..kwk.....kwwwk.',
  '...k......kwwwk.',
  '..kk......kwwwk.',
  '.kwwk......kwk..',
  '..kk........k...',
  '...........kk...',
  '..........kwwk..',
  '...........kk...',
  '................',
  '................',
];

// ============================================================ UI (TamaPoke.ino)
const UI_BG_DAY = 0xF77C, UI_BG_NIGHT = 0x10C5, UI_INK = 0x2946, UI_INK_NIGHT = 0xDEFE,
      UI_TRACK = 0xDE97, UI_BAR_OK = 0x5DCD, UI_BAR_WARN = 0xED07, UI_BAR_BAD = 0xEA87,
      UI_WHITE = 0xFFFF;
const INK_K = 0x18C4;
const SPRITE_H = 32;
const CX = 233, CY = 233, PET_CY = 202, PET_GROUND = 304, HORIZON = 232;

const pet = new Pet();
const pmd = new PmdMon();
const evoPmd = new PmdMon();
const galleryPmd = new PmdMon();
let monFor = -2, monShinyFor = false;

const beh = { mode: 0, act: PMD_IDLE, t0: 0, until: 0, x: 233, targetX: 233 };

let galleryOpen = false, galleryDirty = false, galleryPage = 0, galleryDetail = 0;
let screenOff = false, cardOpen = false, kbOpen = false;
let nameBuf = '';
let cardPage = 0;
let clockOpen = false, clockH = 12, clockM = 0;
let bathUntil = 0, bathPending = false;
const bubbles = Array.from({ length: 14 }, () => ({ x: 0, y: 0, r: 0, ph: 0 }));
let feedMenuUntil = 0;

let gameOpen = false, gameOverUntil = 0;
let ballX = 0, ballY = 0, ballVX = 0, ballVY = 0, gamePetX = 233;
let lastGameStep = 0, gameScore = 0, gameMisses = 0;
let hitX = 0, hitY = 0, hitTime = 0, gameNewHi = false;

let sackOpen = false, sackUntil = 0, sackOverUntil = 0, sackHits = 0, sackShake = 0,
    sackGain = 0, sackNewHi = false;

// fork : 5 boutons sur l'arc (le firmware en a 4 : manger, jouer, lumière, bain)
const buttons = [
  { id: 'food', cx: 109, cy: 388, icon: 'SPR_ICON_FOOD' },
  { id: 'drink', cx: 171, cy: 402, icon: 'SPR_ICON_DRINK' },
  { id: 'play', cx: 233, cy: 407, icon: 'SPR_ICON_PLAY' },
  { id: 'light', cx: 295, cy: 402, icon: 'SPR_ICON_LIGHT' },
  { id: 'clean', cx: 357, cy: 388, icon: 'SPR_ICON_CLEAN' },
];
const BTN_HALF = 26, BTN_HIT = 36;
const CRACK1 = [[15, 8], [16, 9], [15, 10]];
const CRACK2 = [[11, 13], [12, 14], [11, 15], [20, 12], [19, 13], [20, 14]];
const STARS = [[120, 140], [330, 120], [370, 210], [95, 230], [280, 90], [160, 95]];

let wasPressed = false;
const STARTER_DEX = [1, 4, 7];
const STARTER_ROW_Y = 110, STARTER_ROW_H = 70, STARTER_ROW_GAP = 8;
const EVO_BTN_W = 256, EVO_BTN_H = 64, EVO_BTN_X = CX - EVO_BTN_W / 2, EVO_BTN_Y = 172;
const FAR_BTN_W = 408, FAR_BTN_H = 58, FAR_BTN_X = CX - FAR_BTN_W / 2, FAR_BTN_Y = 176;

let lastRender = 0, lastFrame = 0, frameDt = 100;
let dimStage = 0;  // pas d'atténuation AMOLED sur téléphone : Android gère l'écran
let swallowGesture = false;
let confirmUntil = 0;
let choiceKind = 0, choiceUntil = 0;
let tX0 = 0, tY0 = 0, tXl = 0, tYl = 0, tStart = 0, holdFired = false;

// ---- horloge : heure locale du téléphone (le firmware travaille en heure locale)
let clockOffset = 0;  // décalage choisi dans « Régler l'heure » (0 = heure du téléphone)
function rtcEpoch() {
  const now = Date.now() / 1000;
  const tz = new Date().getTimezoneOffset() * 60;
  return Math.floor(now - tz + clockOffset);
}
function rtcSetEpoch(e) {
  const now = Date.now() / 1000;
  const tz = new Date().getTimezoneOffset() * 60;
  clockOffset = Math.round(e - (now - tz));
  if (Math.abs(clockOffset) < 90) clockOffset = 0;  // remis sur l'heure du téléphone
  prefs.put('clkoff', clockOffset);
  prefs.flush();
}

function setup() {
  loadLang();
  clockOffset = prefs.get('clkoff', 0);
  gfx.begin();
  applyLangFont();
  pet.begin();
  thumbs.load();
  pet.syncClock(rtcEpoch());
  audioBegin();
  updateNav();
}

function ensureMon() {
  if (pet.speciesId === monFor && monShinyFor === pet.shiny) return;
  monFor = pet.speciesId;
  monShinyFor = pet.shiny;
  pmd.unload();
  beh.x = beh.targetX = 233;
  beh.mode = 0;
  beh.until = 0;
  if (pet.speciesId >= 1 && pet.speciesId <= DEX_COUNT) pmd.load(pet.speciesId, pet.shiny);
}

let wasEvoReady = false, wasRunReady = false, lastClock = 0;
function loop() {
  const now = millis();
  pet.update(now);
  audioSetSleeping(pet.sleeping);

  const evoReady = pet.wantEvolveButton();
  if (evoReady && !wasEvoReady) sfxPlay(SFX_MEDAL);
  wasEvoReady = evoReady;
  const runReady = pet.canRunawayNow();
  if (runReady && !wasRunReady) sfxPlay(SFX_DENY);
  wasRunReady = runReady;

  pollHold();
  ensureMon();
  if (TP_EXT && now - lastStepPoll > 2000) { lastStepPoll = now; pollSteps(); }

  // sur téléphone l'écriture est instantanée : on vide le guardado périodique tout de suite
  if (pet.savePending()) pet.flushSave();

  if (now - lastClock > 30000) {
    lastClock = now;
    const e = rtcEpoch();
    if (e) pet.lastSeenEpoch = e;
  }

  if (!screenOff && now - lastRender >= 33) {
    frameDt = Math.min(300, now - (lastRender || now - 100));
    lastRender = now;
    render();
  }
}

// ------------------------------------------------------------ console debug
// mêmes commandes que la console série du firmware : tpDebug('HATCH'), etc.
window.tpDebug = function (line) {
  line = String(line).trim();
  const out = [];
  if (line === 'HATCH') { pet.eggTap(); pet.eggTap(); pet.eggTap(); }
  else if (line.startsWith('SPEC ')) {
    const n = parseInt(line.slice(5), 10);
    if (n >= 1 && n <= DEX_COUNT) { pet.prevSpeciesId = pet.speciesId; pet.speciesId = n; }
  } else if (line.startsWith('LVL ')) pet.ageMinutes = parseInt(line.slice(4), 10) * MINUTES_PER_LEVEL;
  else if (line.startsWith('TIME ')) { const e = parseInt(line.slice(5), 10); rtcSetEpoch(e); pet.setClock(e); }
  else if (line === 'GAL') { galleryOpen = !galleryOpen; galleryDetail = 0; galleryDirty = true; if (!galleryOpen) galleryPmd.unload(); }
  else if (line === 'EGGS') { for (let i = 0; i < 20; i++) { const d = pet.pickEggSpecies(); out.push(`${d}:${DEX_TBL[d].name}(r${DEX_TBL[d].rarity})`); } }
  else if (line === 'SHINY') pet.shiny = !pet.shiny;
  else if (line.startsWith('NICK ')) pet.rename(line.slice(5));
  else if (line === 'CAREDAY') { pet.setClock(pet.lastSeenEpoch + 86400); pet.caress(); }
  else if (line === 'BYE') pet.startFarewell();
  else if (line === 'RUN') pet.startRunaway();
  else if (line === 'BEEP') sfxPlay(SFX_HATCH);
  else if (line === 'ABANDON') pet.dbgRunawayReady();
  else if (line === 'WIPE') { pet.factoryReset(); location.reload(); }
  else if (line === 'TICK') pet.tick();
  else if (line.startsWith('STEPS ')) { if (pet.addSteps(parseInt(line.slice(6), 10))) sfxPlay(SFX_WILD); }
  else if (line === 'WILD') { pet.pendingEnc = Math.min(3, pet.pendingEnc + 1); pet.save(); }
  else if (line === 'STATS') {
    out.push(`spec=${pet.speciesId} nv=${pet.level()} com=${pet.fullness} fel=${pet.joy} ene=${pet.energy} lim=${pet.hygiene} desc=${pet.careMistakes}`);
    out.push(`peso=${pet.weight} fue=${pet.atkStat()} def=${pet.defStat()} vel=${pet.speStat()} genes=${pet.geneAtk}/${pet.geneDef}/${pet.geneSpe} tr=${pet.trAtk}/${pet.trDef}/${pet.trSpe} baya=${pet.berryKnown}`);
    out.push(`shiny=${pet.shiny} streak=${pet.streak}/${pet.bestStreak} bond=${pet.bond} medals=0x${pet.medals.toString(16)}(${pet.totalMedals}) nick=${pet.nick}`);
  }
  out.push('DONE');
  return out.join('\n');
};

// ================================================================== tactile
function inPetZone(x, y) { return x > 110 && x < 356 && y > 95 && y < 310; }

let pressed = false;
function toBoard(ev) {
  const r = canvas.getBoundingClientRect();
  return [Math.round((ev.clientX - r.left) / r.width * LCD), Math.round((ev.clientY - r.top) / r.height * LCD)];
}
function onPointerDown(ev) {
  ev.preventDefault();
  audio.ensure();
  if (pressed) return;  // un seul doigt, comme le CST9217 en mode 1 point
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* rien */ }
  const [x, y] = toBoard(ev);
  pressed = true;
  if (sackOpen) {  // saco : chaque toucher compte tout de suite
    if (y < 72) sackOpen = false;
    else sackTap();
    tStart = 0;  // pas de geste à résoudre au relâcher
    wasPressed = true;
    return;
  }
  tX0 = tXl = x;
  tY0 = tYl = y;
  tStart = millis();
  holdFired = false;
  swallowGesture = (dimStage > 0) || screenOff;
  screenOff = false;
  wasPressed = true;
}
function onPointerMove(ev) {
  if (!pressed) return;
  const [x, y] = toBoard(ev);
  tXl = x; tYl = y;
}
function onPointerUp(ev) {
  if (!pressed) return;
  pressed = false;
  if (!wasPressed) return;
  wasPressed = false;
  if (!tStart) return;  // appui consommé (sac d'entraînement)
  if (ev.type === 'pointercancel') { tStart = 0; return; }
  const [x, y] = toBoard(ev);
  tXl = x; tYl = y;
  const dx = tXl - tX0, dy = tYl - tY0;
  const dt = millis() - tStart;
  tStart = 0;
  if (!holdFired && !swallowGesture) {
    if (Math.abs(dx) > 80 && Math.abs(dy) < 70 && dt < 800) onSwipe(dx > 0 ? 1 : -1);
    else if (Math.abs(dy) > 80 && Math.abs(dx) < 70 && dt < 800) onSwipeV(dy > 0 ? 1 : -1);
    else if (dt < 1500 && Math.abs(dx) < 40 && Math.abs(dy) < 40) onTap(tX0, tY0);
  }
}
// appui long sans bouger sur la créature -> « Relâcher ? »
function pollHold() {
  if (!pressed || sackOpen || !tStart) return;
  if (!holdFired && !swallowGesture && !galleryOpen && !cardOpen && !kbOpen && !clockOpen && !pedOpen && !battleOpen &&
      millis() - tStart > 3000 && Math.abs(tXl - tX0) < 30 && Math.abs(tYl - tY0) < 30 &&
      inPetZone(tX0, tY0) && !pet.isEgg() && !confirmUntil && !pet.ceremony && !gameOpen) {
    confirmUntil = millis() + 10000;
    holdFired = true;
  }
}

function onSwipeV(dir) {
  if (pet.awaitingStarter()) return;
  if (battleOpen) return;
  if (pedOpen) { pedOpen = false; return; }
  if (gameOpen || galleryOpen || kbOpen || sackOpen || pet.ceremony) return;
  if (clockOpen) { clockOpen = false; return; }
  if (cardOpen) {
    if (dir < 0) cardOpen = false;
    return;
  }
  if (dir > 0) {
    if (!confirmUntil && !feedMenuUntil) openClock();
  } else if (!pet.isEgg() && !confirmUntil && !feedMenuUntil) {
    cardOpen = true;
    cardPage = 0;
  }
}

function onSwipe(dir) {
  if (pet.awaitingStarter()) return;
  if (battleOpen) return;
  if (pedOpen) { pedOpen = false; return; }
  if (gameOpen || kbOpen || clockOpen) return;
  if (cardOpen) {
    const p = cardPage + (dir > 0 ? -1 : 1);
    cardPage = p < 0 ? 0 : (p > 3 ? 3 : p);
    return;
  }
  if (!galleryOpen) {
    if (!pet.ceremony && !confirmUntil) {
      galleryOpen = true;
      galleryPage = 0;
      galleryDetail = 0;
      galleryDirty = true;
    }
    return;
  }
  if (galleryDetail) {
    galleryDetail = 0;
    galleryPmd.unload();
    galleryDirty = true;
    return;
  }
  let np = galleryPage - dir;
  if (np < 0) {
    galleryOpen = false;
    galleryPmd.unload();
    return;
  }
  if (np > 9) np = 9;
  if (np !== galleryPage) {
    galleryPage = np;
    galleryDirty = true;
  }
}

function onTap(x, y) {
  if (pet.awaitingStarter()) {
    for (let i = 0; i < 3; i++) {
      const ry = STARTER_ROW_Y + i * (STARTER_ROW_H + STARTER_ROW_GAP);
      if (x >= 70 && x <= 396 && y >= ry && y <= ry + STARTER_ROW_H) {
        pet.chooseStarter(STARTER_DEX[i]);
        sfxPlay(SFX_TAP);
        break;
      }
    }
    return;
  }
  if (galleryOpen) { galleryTap(x, y); return; }
  if (battleOpen) { battleTap(x, y); return; }
  if (pedOpen) { pedTap(x, y); return; }
  if (kbOpen) { keyboardTap(x, y); return; }
  if (clockOpen) { clockTap(x, y); return; }
  if (pet.ceremony) return;
  if (cardOpen) {
    if (cardPage === 0 && y < 84) openKeyboard();
    else if (cardPage === 1 && y >= 300 && y <= 340 && x >= 96 && x <= 370) {
      cardOpen = false;
      startSack();
    } else {
      cardOpen = false;
    }
    return;
  }
  if (gameOpen) { gameTap(x, y); return; }
  if (choiceKind) {
    const b1 = (x >= 93 && x <= 373 && y >= 206 && y <= 258);
    const b2 = (x >= 93 && x <= 373 && y >= 268 && y <= 320);
    if (choiceKind === 1) {
      if (b1) { const old = pet.speciesId; pet.evolve(); evoPmd.load(old, pet.shiny); }
      else if (b2) pet.declineEvolve();
    } else if (choiceKind === 2) {
      if (b1) pet.startFarewell();
      else if (b2) pet.declineFarewell();
    }
    choiceKind = 0;
    return;
  }
  if (confirmUntil) {
    if (timeLeft(confirmUntil) && x >= 118 && x <= 218 && y >= 252 && y <= 304) pet.release();
    confirmUntil = 0;
    return;
  }
  if (feedMenuUntil) {
    if (timeLeft(feedMenuUntil) && y >= 288 && y <= 352 && x >= 101 && x <= 365) {
      const item = Math.min(3, idiv(x - 101, 66));
      if (item === 3) pet.feedCandy();
      else pet.feedBerry(item);
      sfxPlay(SFX_EAT);
    }
    feedMenuUntil = 0;
    return;
  }
  if (pet.isEgg()) {
    pet.eggTap();
    sfxPlay(SFX_TAP);
    return;
  }
  if (pet.wantEvolveButton() && x >= EVO_BTN_X && x <= EVO_BTN_X + EVO_BTN_W &&
      y >= EVO_BTN_Y && y <= EVO_BTN_Y + EVO_BTN_H) {
    choiceKind = 1; choiceUntil = millis() + 12000;
    return;
  }
  if (x >= FAR_BTN_X && x <= FAR_BTN_X + FAR_BTN_W && y >= FAR_BTN_Y && y <= FAR_BTN_Y + FAR_BTN_H) {
    if (pet.canRunawayNow()) { pet.startRunaway(); return; }
    if (pet.wantFarewellButton()) { choiceKind = 2; choiceUntil = millis() + 12000; return; }
  }
  // fork : rencontre sauvage en attente (pastille sous le statut)
  if (TP_EXT && wildBtnShown() && x >= WILD_BTN_X && x <= WILD_BTN_X + WILD_BTN_W &&
      y >= WILD_BTN_Y && y <= WILD_BTN_Y + WILD_BTN_H) {
    openBattle();
    return;
  }
  // fork : pastille des pas en haut -> podomètre
  if (TP_EXT && y < 46 && x > 140 && x < 326) { openPed(); return; }
  for (let i = 0; i < buttons.length; i++) {
    const dx = x - buttons[i].cx, dy = y - buttons[i].cy;
    if (dx * dx + dy * dy <= 30 * 30) {  // 30 et non 36 : 5 boutons plus serrés
      sfxPlay(SFX_TAP);
      const id = buttons[i].id;
      if (id === 'food') {
        if (!pet.sleeping) feedMenuUntil = millis() + 6000;
      } else if (id === 'drink') {
        if (!pet.sleeping && !pet.isEgg()) { pet.drink(); sfxPlay(SFX_DRINK); }
      } else if (id === 'play') startGame();
      else if (id === 'light') pet.toggleLight();
      else startBath();
      return;
    }
  }
  if (inPetZone(x, y)) {
    pet.caress();
    if (!pet.sleeping) sfxPlay(SFX_HEART);
  }
}

// ==================================================================== rendu
let gNight = false;
const inkColor = () => (gNight ? UI_INK_NIGHT : UI_INK);

function sceneHour() {
  const e = pet.lastSeenEpoch;
  return e ? Math.floor(e / 3600) % 24 : 13;
}

const BIOME_SOIL = [
  C565(0x7e, 0xc0, 0x7f), C565(0xdc, 0xca, 0x94), C565(0x4f, 0x8a, 0x55),
  C565(0x8a, 0x55, 0x44), C565(0xa8, 0x90, 0x6a), C565(0xe6, 0xee, 0xf5),
];

function drawClouds(now, col) {
  for (let k = 0; k < 2; k++) {
    const cx = ((Math.floor(now / 50) + k * 250) % 560) - 40;
    const cy = 70 + k * 34;
    gfx.fillCircle(cx, cy, 16, col);
    gfx.fillCircle(cx + 18, cy + 3, 13, col);
    gfx.fillCircle(cx - 15, cy + 4, 12, col);
  }
}

function skyColors(h, night) {
  if (night) return [C565(0x0c, 0x12, 0x24), C565(0x1e, 0x26, 0x46)];
  if (h < 8) return [C565(0xd1, 0x6a, 0x86), C565(0xf3, 0xb8, 0x7c)];
  if (h < 18) return [C565(0x8f, 0xc8, 0xea), C565(0xdc, 0xee, 0xe6)];
  return [C565(0xc7, 0x5a, 0x4a), C565(0xf0, 0xae, 0x64)];
}

function drawScene(biome, now, night) {
  const h = sceneHour();
  const [top, bot] = skyColors(h, night);
  for (let y = 0; y < HORIZON; y += 8) gfx.fillRect(0, y, 466, 8, lerp565(top, bot, y, HORIZON));

  if (night) {
    gfx.fillCircle(360, 78, 24, C565(0xe8, 0xee, 0xf5));
    gfx.fillCircle(370, 72, 22, lerp565(top, bot, 78, HORIZON));
    for (const st of STARS) gfx.fillRect(st[0], st[1], 4, 4, UI_WHITE);
  } else if (h < 18) {
    gfx.fillCircle(360, 84, 26, h < 8 ? C565(0xff, 0xd9, 0x8a) : C565(0xff, 0xe7, 0x9f));
    drawClouds(now, C565(0xff, 0xff, 0xff));
  } else {
    gfx.fillCircle(233, HORIZON - 6, 34, C565(0xff, 0xf1, 0xc8));
  }

  let soil = BIOME_SOIL[biome < 6 ? biome : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  if (biome === 1) {
    const sea = night ? C565(0x1c, 0x34, 0x52) : C565(0x4f, 0x96, 0xc4);
    gfx.fillRect(0, HORIZON - 26, 466, 26, sea);
    for (let i = 0; i < 3; i++) {
      const wy = HORIZON - 22 + i * 7;
      const fc = night ? C565(0x3a, 0x58, 0x78) : C565(0xbf, 0xe6, 0xf5);
      gfx.fillRect(60 + ((Math.floor(now / 60) + i * 30) % 60), wy, 26, 2, fc);
      gfx.fillRect(300 - ((Math.floor(now / 60) + i * 20) % 60), wy, 26, 2, fc);
    }
  }

  gfx.fillRect(0, HORIZON, 466, 466 - HORIZON, soil);
  const hill = lerp565(soil, night ? C565(0x0c, 0x12, 0x24) : C565(0xff, 0xff, 0xff), 3, 16);
  gfx.fillRoundRect(-60, HORIZON - 14, 586, 60, 30, hill);

  const dk = lerp565(soil, C565(0x10, 0x18, 0x20), night ? 11 : 7, 16);
  if (biome === 2) {
    for (const tx of [60, 150, 360, 416]) {
      gfx.fillTriangle(tx, HORIZON - 46, tx - 16, HORIZON, tx + 16, HORIZON, dk);
      gfx.fillTriangle(tx, HORIZON - 60, tx - 12, HORIZON - 28, tx + 12, HORIZON - 28, dk);
    }
  } else if (biome === 3) {
    gfx.fillTriangle(70, HORIZON, 40, HORIZON + 30, 100, HORIZON + 30, dk);
    gfx.fillTriangle(400, HORIZON + 4, 372, HORIZON + 30, 430, HORIZON + 30, dk);
    if (!night) for (let e = 0; e < 4; e++) gfx.fillRect(120 + e * 70, HORIZON + 8 + (e % 2) * 6, 4, 4, C565(0xff, 0x9b, 0x3a));
  } else if (biome === 4) {
    gfx.fillTriangle(140, HORIZON - 50, 60, HORIZON, 220, HORIZON, dk);
    gfx.fillTriangle(330, HORIZON - 38, 250, HORIZON, 410, HORIZON, dk);
  } else if (biome === 5 && !night) {
    for (let f = 0; f < 10; f++) {
      const fx = (f * 53 + Math.floor(now / 40)) % 466;
      const fy = (f * 90 + Math.floor(now / 18)) % HORIZON;
      gfx.fillRect(fx, fy, 3, 3, UI_WHITE);
    }
  } else if (biome === 0) {
    for (const gx of [80, 175, 300, 395])
      for (let b = -1; b <= 1; b++) gfx.fillRect(gx + b * 5, HORIZON + 6, 2, 8 + (b === 0 ? 4 : 0), dk);
  }
}

function renderStarterSelect() {
  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  const t = T(S_CHOOSE_STARTER);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(t, 2), 68);
  printT(t);
  for (let i = 0; i < 3; i++) {
    const d = STARTER_DEX[i];
    const de = DEX_TBL[d];
    const ry = STARTER_ROW_Y + i * (STARTER_ROW_H + STARTER_ROW_GAP);
    gfx.fillRoundRect(70, ry, 326, STARTER_ROW_H, 14, lerp565(de.accent, UI_WHITE, 6, 8));
    gfx.drawRoundRect(70, ry, 326, STARTER_ROW_H, 14, de.accent);
    const th = thumbs.get(d);
    if (th) drawThumb(th, 76, ry - 5, 3, false);
    gfx.setTextColor(UI_INK);
    setSize(3);
    setCur(178, ry + 24);
    printT(dexName(d));
  }
}

// ---- texte (même logique que le firmware : police classique ou CJK)
let gCjkFont = false;
let gTextSize = 1;
function setSize(n) {
  gTextSize = gCjkFont ? (n >= 2 ? Math.floor(n / 2) : 1) : n;
  gfx.setTextSize(gTextSize);
}
function setCur(x, y) { gfx.setCursor(x, y); }
function applyLangFont() { gCjkFont = LANG_IS_CJK(gLang); }
function textW(s, size) {
  if (!gCjkFont) return s.length * 6 * size;
  return gfx.textWidthCjk(s);
}
const centerX = (s, size) => CX - idiv(textW(s, size), 2);
function printT(s) {
  s = String(s);
  if (gCjkFont) {
    const x = gfx.getCursorX(), y = gfx.getCursorY();
    gfx.print(s);
    gfx.setCursor(x + 1, y);  // pseudo-gras, comme sur la carte
  }
  gfx.print(s);
}

function render() {
  if (pet.awaitingStarter()) { renderStarterSelect(); return; }
  if (galleryOpen) { renderGallery(); return; }
  if (gameOpen) { renderGame(); return; }
  if (sackOpen) { renderSack(); return; }
  if (battleOpen) { renderBattle(); return; }
  if (pedOpen) { renderPed(); return; }
  if (kbOpen) { renderKeyboard(); return; }
  if (clockOpen) { renderClock(); return; }
  if (cardOpen) { renderCard(); return; }
  const h = sceneHour();
  gNight = pet.sleeping || h < 6 || h >= 20;
  drawScene(pet.isEgg() ? 0 : DEX_TBL[pet.speciesId].biome, millis(), gNight);

  if (pet.ceremony) {
    const d = DEX_TBL[pet.speciesId];
    const msg = pet.ceremony === CER_FAREWELL ? T(S_FAREWELL)
              : pet.ceremony === CER_RUNAWAY ? T(S_RUNAWAY) : T(S_GOODBYE);
    drawHeader(dexName(pet.speciesId), d.accent, msg);
    drawCeremony();
    return;
  }

  if (pet.isEgg()) {
    drawHeader(T(S_EGG_HDR), inkColor(), eggMsg());
    const s = 5, x = CX - 16 * s, y = PET_CY - 16 * s;
    drawMap('SPR_EGG', SPRITE_H, x, y, s, false);
    if (pet.eggCracks() >= 1) for (const c of CRACK1) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    if (pet.eggCracks() >= 2) for (const c of CRACK2) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    if (pet.eggRarity() >= R_RARO) {
      const rar = pet.eggRarity() === R_LEGENDARIO ? T(S_EGG_LEGEND) : T(S_EGG_RARE);
      gfx.setTextColor(pet.eggRarity() === R_LEGENDARIO ? UI_BAR_WARN : 0x4C98);
      setSize(2);
      setCur(centerX(rar, 2), 316);
      printT(rar);
    }
    const reg = sprintf(T(S_POKEDEX_FMT), pet.registeredCount());
    gfx.fillRect(0, 312, 466, 154, gNight ? UI_BG_NIGHT : UI_BG_DAY);
    gfx.setTextColor(inkColor());
    setSize(2);
    setCur(centerX(reg, 2), 348);
    printT(reg);
  } else {
    const d = DEX_TBL[pet.speciesId];
    const base = pet.nick ? pet.nick : dexName(pet.speciesId);
    const name = sprintf(T(S_NAME_FMT), pet.shiny ? '*' : '', base, pet.level());
    drawHeader(name, gNight ? UI_INK_NIGHT : d.accent, statusMsg());
    drawStreakBadge();
    drawPet();
    drawBath();
    drawPoops();
    gfx.fillRect(0, 312, 466, 154, gNight ? UI_BG_NIGHT : UI_BG_DAY);
    drawBars();
    drawButtons();
    drawCelebration();
    if (pet.wantEvolveButton()) drawEvolveButton();
    else if (pet.canRunawayNow()) drawRunawayButton();
    else if (pet.wantFarewellButton()) drawFarewellButton();
    else if (TP_EXT && wildBtnShown()) drawWildButton();
  }

  if (pet.sleeping) {
    gfx.setTextColor(UI_INK_NIGHT);
    setSize(3);
    setCur(320, 130);
    printT('Zz');
  }

  if (feedMenuUntil) {
    if (!timeLeft(feedMenuUntil)) feedMenuUntil = 0;
    else {
      gfx.fillRoundRect(101, 288, 264, 64, 14, UI_WHITE);
      gfx.drawRoundRect(101, 288, 264, 64, 14, inkColor());
      drawMap('SPR_ICON_FOOD', 16, 110, 296, 3, false);
      drawMap('SPR_ICON_BERRY_B', 16, 176, 296, 3, false);
      drawMap('SPR_ICON_BERRY_G', 16, 242, 296, 3, false);
      drawMap('SPR_ICON_CANDY', 16, 308, 296, 3, false);
    }
  }

  if (confirmUntil) {
    if (!timeLeft(confirmUntil)) confirmUntil = 0;
    else {
      gfx.fillRoundRect(94, 168, 278, 152, 16, UI_WHITE);
      gfx.drawRoundRect(94, 168, 278, 152, 16, UI_INK);
      const q = sprintf(T(S_RELEASE_FMT), dexName(pet.speciesId));
      gfx.setTextColor(UI_INK);
      setSize(2);
      setCur(centerX(q, 2), 196);
      printT(q);
      gfx.fillRoundRect(118, 252, 100, 52, 12, UI_BAR_OK);
      gfx.setTextColor(UI_WHITE);
      setCur(118 + idiv(100 - textW(T(S_YES), 2), 2), 270);
      printT(T(S_YES));
      gfx.fillRoundRect(248, 252, 100, 52, 12, UI_BAR_BAD);
      setCur(248 + idiv(100 - textW(T(S_NO), 2), 2), 270);
      printT(T(S_NO));
    }
  }

  if (choiceKind) {
    if (!timeLeft(choiceUntil)) choiceKind = 0;
    else drawChoiceDialog();
  }
}

// ---------------------------------------------- mini-jeu : jongler la balle
function startGame() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony) return;
  gameOpen = true;
  gameOverUntil = 0;
  gameScore = 0;
  gameMisses = 0;
  gameNewHi = false;
  hitTime = 0;
  gamePetX = 233;
  lastGameStep = millis();
  respawnBall();
}
function respawnBall() {
  ballX = 150 + random(166);
  ballY = 96;
  let sp = 1.6 + gameScore * 0.05;
  if (sp > 4.0) sp = 4.0;
  ballVX = random(2) ? sp : -sp;
  ballVY = 0;
}
function gameTap(x, y) {
  if (gameOverUntil) return;
  if (y < 72) { gameOpen = false; return; }
  const dx = ballX - x, dy = ballY - y;
  if (dx * dx + dy * dy < 74 * 74) {
    gameScore++;
    sfxPlay(SFX_PLAY);
    const lift = 6.6 + (gameScore > 16 ? 3.5 : gameScore * 0.22);
    ballVY = -lift;
    ballVX += dx * 0.12;
    if (ballVX > 6.5) ballVX = 6.5;
    if (ballVX < -6.5) ballVX = -6.5;
    hitX = ballX;
    hitY = ballY;
    hitTime = millis();
  }
}
function stepGame() {
  const now = millis();
  let k = lastGameStep ? (now - lastGameStep) / 85.0 : 1.0;
  if (k > 3.0) k = 3.0;
  lastGameStep = now;
  let grav = 0.40 + gameScore * 0.013;
  if (grav > 0.80) grav = 0.80;
  ballVY += grav * k;
  ballX += ballVX * k;
  ballY += ballVY * k;
  const dx = ballX - CX, dy = ballY - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 205) {
    const nx = dx / d, ny = dy / d;
    const dot = ballVX * nx + ballVY * ny;
    if (dot > 0) {
      ballVX = (ballVX - 2 * dot * nx) * 0.85;
      ballVY = (ballVY - 2 * dot * ny) * 0.85;
    }
    ballX = CX + nx * 205;
    ballY = CY + ny * 205;
  }
  if (ballY > 384) {
    if (++gameMisses >= 3) {
      gameNewHi = (gameScore > pet.gameHi);
      pet.playResult(gameScore);
      sfxPlay(gameNewHi && gameScore > 0 ? SFX_MEDAL : SFX_LEVEL);
      gameOverUntil = millis() + 4000;
    } else {
      respawnBall();
    }
  }
  let chase = (ballX - gamePetX) * 0.12;
  if (chase > 7) chase = 7;
  if (chase < -7) chase = -7;
  gamePetX += chase * k;
}

// ----------------------------------------------- sac d'entraînement (force)
function startSack() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony) return;
  sackOpen = true;
  sackUntil = millis() + 10000;
  sackOverUntil = 0;
  sackHits = 0;
  sackShake = 0;
  sackNewHi = false;
}
function sackTap() {
  if (!timeLeft(sackUntil)) return;
  sackHits++;
  sackShake = 16;
}

function renderSack() {
  const now = millis();
  drawGameScene();
  const night = sceneHour() < 6 || sceneHour() >= 20;
  const ink = night ? UI_INK_NIGHT : UI_INK;

  if (sackOverUntil) {
    if (!timeLeft(sackOverUntil)) { sackOpen = false; return; }
    const b = sprintf(T(S_HITS_FMT), sackHits);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(b, 4), 150);
    printT(b);
    const g = sprintf(T(S_STR_GAIN_FMT), sackGain);
    gfx.setTextColor(UI_BAR_BAD);
    setSize(3);
    setCur(centerX(g, 3), 210);
    printT(g);
    setSize(2);
    if (sackNewHi && sackHits > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S_NEW_RECORD), 2), 256);
      printT(T(S_NEW_RECORD));
    } else {
      const r = sprintf(T(S_RECORD_FMT), pet.strHi);
      gfx.setTextColor(ink);
      setCur(centerX(r, 2), 256);
      printT(r);
    }
    return;
  }

  if (!timeLeft(sackUntil)) {
    sackNewHi = (sackHits > pet.strHi);
    sackGain = pet.trainStrength(sackHits);
    sfxPlay(sackNewHi ? SFX_MEDAL : SFX_PLAY);
    sackOverUntil = now + 3500;
    return;
  }

  sackShake *= Math.pow(0.84, frameDt / 85);  // 0.84 par image de 85 ms sur la carte
  const off = Math.trunc(sackShake * Math.sin(now * 0.05));
  const sx = CX + off, top = 86;
  gfx.fillRect(CX - 3, 56, 6, top - 56, ink);
  gfx.fillRect(sx - 4, top - 30, 8, 34, ink);
  gfx.fillRoundRect(sx - 42, top, 84, 150, 26, C565(0xb5, 0x3a, 0x3a));
  gfx.fillRoundRect(sx - 42, top, 84, 22, 18, C565(0x7e, 0x28, 0x28));
  gfx.drawRoundRect(sx - 42, top, 84, 150, 26, ink);
  gfx.fillRect(sx - 42, top + 70, 84, 4, C565(0x7e, 0x28, 0x28));

  const buf = String(sackHits);
  gfx.setTextColor(ink);
  setSize(6);
  setCur(centerX(buf, 6), 268);
  printT(buf);

  setSize(2);
  setCur(centerX(T(S_HIT_FAST), 2), 322);
  printT(T(S_HIT_FAST));

  const left = sackUntil - now;
  const bw = 280, fw = Math.floor(bw * left / 10000);
  gfx.fillRoundRect(CX - bw / 2, 350, bw, 16, 5, UI_TRACK);
  if (fw > 2) gfx.fillRoundRect(CX - bw / 2, 350, fw, 16, 5, UI_BAR_OK);
}

function drawGameScene() {
  const hh = sceneHour();
  const night = hh < 6 || hh >= 20;
  const [top, bot] = skyColors(hh, night);
  const hor = 376;
  for (let y = 0; y < hor; y += 8) gfx.fillRect(0, y, 466, 8, lerp565(top, bot, y, hor));
  if (night) for (const st of STARS) gfx.fillRect(st[0], st[1], 4, 4, UI_WHITE);
  const bio = pet.isEgg() ? 0 : DEX_TBL[pet.speciesId].biome;
  let soil = BIOME_SOIL[bio < 6 ? bio : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  gfx.fillRect(0, hor, 466, 466 - hor, soil);
}

function renderGame() {
  const night = sceneHour() < 6 || sceneHour() >= 20;
  const ink = night ? UI_INK_NIGHT : UI_INK;

  if (gameOverUntil) {
    drawGameScene();
    if (!timeLeft(gameOverUntil)) { gameOpen = false; return; }
    const buf = sprintf(T(S_SCORE_FMT), gameScore);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(buf, 4), 160);
    printT(buf);
    setSize(2);
    if (gameNewHi && gameScore > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S_NEW_RECORD), 2), 214);
      printT(T(S_NEW_RECORD));
    } else {
      const rec = sprintf(T(S_RECORD_FMT), pet.gameHi);
      gfx.setTextColor(ink);
      setCur(centerX(rec, 2), 214);
      printT(rec);
    }
    const msg = gameScore >= 10 ? T(S_GREAT_JOY) : T(S_PLUS_JOY);
    gfx.setTextColor(ink);
    setCur(centerX(msg, 2), 250);
    printT(msg);
    return;
  }

  drawGameScene();
  stepGame();

  const buf = String(gameScore);
  gfx.setTextColor(ink);
  setSize(4);
  setCur(centerX(buf, 4), 30);
  printT(buf);
  const rec = sprintf(T(S_REC_FMT), pet.gameHi);
  setSize(2);
  setCur(centerX(rec, 2), 76);
  printT(rec);
  for (let i = 0; i < 3; i++) {
    if (i < 3 - gameMisses) gfx.fillCircle(180 + i * 28, 104, 6, UI_BAR_BAD);
    else gfx.drawCircle(180 + i * 28, 104, 6, UI_TRACK);
  }

  if (pmd.loaded) {
    let act = (ballX > gamePetX + 4) ? PMD_WALKR : (ballX < gamePetX - 4) ? PMD_WALKL : PMD_IDLE;
    if (!pmd.has(act)) act = PMD_IDLE;
    drawPmdAct(act, Math.trunc(gamePetX), 394, millis(), true, false, 3);
  }

  const ht = millis() - hitTime;
  if (hitTime && ht < 260) {
    const rad = 22 + Math.floor(ht / 6);
    gfx.drawCircle(Math.trunc(hitX), Math.trunc(hitY), rad, C565(0xff, 0xe7, 0x9f));
    gfx.drawCircle(Math.trunc(hitX), Math.trunc(hitY), rad - 2, C565(0xff, 0xd9, 0x8a));
  }

  drawMap('SPR_ICON_PLAY', 16, Math.trunc(ballX) - 24, Math.trunc(ballY) - 24, 3, false);
}

// ------------------------------------------------------------- fiche (4 pages)
function statBarX() {
  const ids = [S_STAT_ATK, S_STAT_DEF, S_STAT_SPE, S_STAT_WGT, S_VIN];
  let ancho = 0;
  for (const id of ids) { const w = textW(T(id), 2); if (w > ancho) ancho = w; }
  const x = 96 + ancho + 12;
  return x < 150 ? 150 : x;
}
function drawCardStat(y, label, val, maxBar, color) {
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(96, y);
  printT(label);
  setCur(330, y);
  printT(String(val));
  const bx = statBarX();
  const bw = 310 - bx;
  let fw = idiv(val * bw, maxBar);
  if (fw > bw) fw = bw;
  gfx.fillRoundRect(bx, y + 2, bw, 11, 3, UI_TRACK);
  if (fw > 2) gfx.fillRoundRect(bx, y + 2, fw, 11, 3, color);
}

// ---- réglage de l'heure (glisser vers le bas)
function openClock() {
  const e = pet.lastSeenEpoch ? pet.lastSeenEpoch : rtcEpoch();
  clockH = Math.floor(e / 3600) % 24;
  clockM = Math.floor(e / 60) % 60;
  clockOpen = true;
}
function applyClock() {
  const base = pet.lastSeenEpoch ? pet.lastSeenEpoch : rtcEpoch();
  const e = Math.floor(base / 86400) * 86400 + clockH * 3600 + clockM * 60;
  rtcSetEpoch(e);
  pet.setClock(e);
  clockOpen = false;
}
function drawClockBtn(x, y, l) {
  gfx.fillRoundRect(x, y, 58, 58, 12, UI_WHITE);
  gfx.drawRoundRect(x, y, 58, 58, 12, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(4);
  setCur(x + 17, y + 15);
  printT(l);
}
const LANG_PILL_Y = 296, LANG_PILL_H = 30, LANG_PILL_X = 336, LANG_PILL_W = 96;

function renderClock() {
  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(T(S_SET_TIME), 3), 44);
  printT(T(S_SET_TIME));

  const t = sprintf('%02d:%02d', clockH, clockM);
  setSize(7);
  setCur(CX - 105, 108);
  printT(t);

  drawClockBtn(104, 190, '-');
  drawClockBtn(170, 190, '+');
  drawClockBtn(252, 190, '-');
  drawClockBtn(318, 190, '+');
  setSize(2);
  gfx.setTextColor(UI_TRACK);
  setCur(120, 256);
  printT(T(S_HOUR));
  setCur(276, 256);
  printT(T(S_MIN));

  const snd = audioEnabled();
  const sl = snd ? T(S_SND_ON) : T(S_SND_OFF);
  gfx.fillRoundRect(34, LANG_PILL_Y, 96, LANG_PILL_H, 8, snd ? UI_BAR_OK : UI_WHITE);
  gfx.drawRoundRect(34, LANG_PILL_Y, 96, LANG_PILL_H, 8, UI_INK);
  gfx.setTextColor(snd ? UI_BG_DAY : UI_INK);
  setSize(2);
  setCur(34 + idiv(96 - textW(sl, 2), 2), LANG_PILL_Y + 8);
  printT(sl);

  gfx.fillRoundRect(LANG_PILL_X, LANG_PILL_Y, LANG_PILL_W, LANG_PILL_H, 8, UI_WHITE);
  gfx.drawRoundRect(LANG_PILL_X, LANG_PILL_Y, LANG_PILL_W, LANG_PILL_H, 8, UI_INK);
  const lp = `${LANG_CODES[gLang]} >`;
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(LANG_PILL_X + idiv(LANG_PILL_W - textW(lp, 2), 2), LANG_PILL_Y + 8);
  printT(lp);

  gfx.fillRoundRect(133, 340, 200, 48, 14, UI_BAR_OK);
  gfx.setTextColor(UI_BG_DAY);
  setSize(3);
  setCur(CX - 18, 352);
  printT('OK');

  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(T(S_CLOCK_CANCEL), 2), 410);
  printT(T(S_CLOCK_CANCEL));

  const ver = `TamaPoke v${FW_VERSION}`;
  setSize(1);
  setCur(centerX(ver, 1), 436);
  printT(ver);
}

function clockTap(x, y) {
  if (y >= 190 && y <= 248) {
    if (x >= 104 && x < 162) clockH = (clockH + 23) % 24;
    else if (x >= 170 && x < 228) clockH = (clockH + 1) % 24;
    else if (x >= 252 && x < 310) clockM = (clockM + 59) % 60;
    else if (x >= 318 && x < 376) clockM = (clockM + 1) % 60;
    return;
  }
  if (y >= LANG_PILL_Y && y <= LANG_PILL_Y + LANG_PILL_H) {
    if (x >= 34 && x < 130) {
      audioSetEnabled(!audioEnabled());
      if (audioEnabled()) sfxPlay(SFX_TAP);
      return;
    }
    if (x >= LANG_PILL_X && x < LANG_PILL_X + LANG_PILL_W) {
      setLang((gLang + 1) % LANG_COUNT);
      applyLangFont();
      sfxPlay(SFX_TAP);
      return;
    }
  }
  if (y >= 340 && y <= 388 && x >= 133 && x <= 333) applyClock();
}

function drawStreakBadge() {
  if (TP_EXT) { drawTopBadges(); return; }
  if (pet.streak < 1) return;
  const x = 26, y = 16;
  gfx.fillTriangle(x + 8, y, x + 1, y + 17, x + 15, y + 17, UI_BAR_BAD);
  gfx.fillTriangle(x + 8, y + 7, x + 4, y + 17, x + 12, y + 17, UI_BAR_WARN);
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(x + 22, y + 2);
  printT(String(pet.streak));
}

function drawCelebration() {
  let l1 = null, l2 = null;
  if (pet.showMedal()) {
    for (let i = 0; i < MED_COUNT; i++) if (pet.newMedal & (1 << i)) { l2 = medalName(i); break; }
    l1 = T(S_MEDAL_BANNER);
  } else if (pet.showMilestone()) {
    l1 = T(S_GREAT);
    l2 = sprintf(T(S_STREAK_DAYS_FMT), pet.streak);
  }
  if (!l1) return;
  gfx.fillRoundRect(73, 150, 320, 96, 16, UI_BAR_WARN);
  gfx.drawRoundRect(73, 150, 320, 96, 16, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(l1, 3), 176);
  printT(l1);
  setSize(2);
  setCur(centerX(l2, 2), 212);
  printT(l2);
}

function renderCardProfile() {
  const d = DEX_TBL[pet.speciesId];
  const nm = pet.nick ? pet.nick : dexName(pet.speciesId);
  const head = sprintf(T(S_NAME_FMT), pet.shiny ? '*' : '', nm, pet.level());
  gfx.setTextColor(d.accent);
  setSize(3);
  const hts = (textW(head, 3) <= 198) ? 3 : 2;
  setSize(hts);
  setCur(centerX(head, hts), hts === 3 ? 34 : 40);
  printT(head);
  if (pet.nick) {
    const par = `(${dexName(pet.speciesId)})`;
    gfx.setTextColor(UI_TRACK);
    setSize(2);
    setCur(centerX(par, 2), 64);
    printT(par);
  }

  if (pmd.loaded) drawPmdAct(PMD_IDLE, CX, 206, millis(), true, false, 4);

  const sx = 138, sy = 224;
  gfx.fillTriangle(sx + 8, sy, sx + 1, sy + 18, sx + 15, sy + 18, UI_BAR_BAD);
  gfx.fillTriangle(sx + 8, sy + 7, sx + 4, sy + 18, sx + 12, sy + 18, UI_BAR_WARN);
  const rl = sprintf(T(S_STREAK_FMT), pet.streak, pet.bestStreak);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(sx + 24, sy + 2);
  printT(rl);

  drawCardStat(258, T(S_VIN), pet.bond, 100, C565(0xd4, 0x52, 0x7e));

  const berry = !pet.berryKnown ? T(S_BERRY_UNK)
              : pet.lovesBerry(0) ? T(S_BERRY_RED)
              : pet.lovesBerry(1) ? T(S_BERRY_BLUE) : T(S_BERRY_GREEN);
  const info = sprintf(T(S_INFO_FMT), berry, Math.floor(pet.ageMinutes / 1440));
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(info, 2), 296);
  printT(info);

  gfx.setTextColor(UI_TRACK);
  setCur(centerX(T(S_RENAME_HINT), 2), 332);
  printT(T(S_RENAME_HINT));
}

function renderCardStats() {
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(T(S_BATTLE), 3), 48);
  printT(T(S_BATTLE));
  drawCardStat(118, T(S_STAT_ATK), pet.atkStat(), 260, UI_BAR_BAD);
  drawCardStat(160, T(S_STAT_DEF), pet.defStat(), 260, 0x4C98);
  drawCardStat(202, T(S_STAT_SPE), pet.speStat(), 260, UI_BAR_WARN);
  drawCardStat(244, T(S_STAT_WGT), pet.weight, 100, 0xB3C8);
  gfx.fillRoundRect(96, 300, 274, 40, 12, UI_BAR_BAD);
  gfx.setTextColor(UI_BG_DAY);
  setSize(2);
  setCur(centerX(T(S_TRAIN_STR), 2), 311);
  printT(T(S_TRAIN_STR));
}

function renderCardMedals() {
  let got = 0;
  for (let i = 0; i < MED_COUNT; i++) if (pet.hasMedal(1 << i)) got++;
  const head = sprintf(T(S_MEDALS_FMT), got, MED_COUNT);
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(head, 3), 48);
  printT(head);
  for (let i = 0; i < MED_COUNT; i++) {
    const x = 28 + (i % 2) * 206, y = 104 + Math.floor(i / 2) * 54;
    const g = pet.hasMedal(1 << i);
    gfx.fillRoundRect(x, y, 196, 44, 10, g ? UI_BAR_OK : UI_TRACK);
    if (g) {
      gfx.fillCircle(x + 22, y + 22, 11, UI_BG_DAY);
      gfx.setTextColor(UI_BAR_OK);
      setSize(2);
      setCur(x + 16, y + 13);
      printT('v');
    }
    gfx.setTextColor(g ? UI_BG_DAY : 0x8410);
    setSize(2);
    setCur(x + 44, y + 14);
    printT(medalDesc(i));
  }
}

function renderCardProgress() {
  const d = DEX_TBL[pet.speciesId];
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(T(S_PROGRESS), 3), 44);
  printT(T(S_PROGRESS));

  const lv = sprintf(T(S_LVL_FMT), pet.level());
  setSize(5);
  setCur(centerX(lv, 5), 86);
  printT(lv);

  const into = pet.ageMinutes % MINUTES_PER_LEVEL;
  const bx = 93, bw = 280, by = 158, bh = 22;
  gfx.fillRoundRect(bx, by, bw, bh, 6, UI_TRACK);
  const fw = idiv((bw - 4) * into, MINUTES_PER_LEVEL);
  if (fw > 0) gfx.fillRoundRect(bx + 2, by + 2, fw, bh - 4, 5, UI_BAR_OK);
  const nx = sprintf(T(S_NEXT_LVL_FMT), MINUTES_PER_LEVEL - into, pet.level() + 1);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(nx, 2), by + 32);
  printT(nx);

  gfx.setTextColor(UI_TRACK);
  setCur(centerX(T(S_EVO_LABEL), 2), 230);
  printT(T(S_EVO_LABEL));
  let evo, evoCol = UI_INK;
  if (d.evolvesTo === 0) {
    evo = T(S_FINAL_FORM);
  } else {
    const needed = d.evolveLevel + pet.careMistakes;
    if (pet.level() >= needed) {
      if (pet.lowestStat() >= 40) { evo = T(S_EVO_READY); evoCol = UI_BAR_OK; }
      else { evo = T(S_EVO_BLOCKED); evoCol = UI_BAR_BAD; }
    } else {
      evo = sprintf(T(S_EVO_IN_FMT), needed - pet.level());
    }
  }
  gfx.setTextColor(evoCol);
  setCur(centerX(evo, 2), 256);
  printT(evo);

  const ms = sprintf(T(S_MISTAKES_FMT), pet.careMistakes);
  gfx.setTextColor(pet.careMistakes > 0 ? UI_BAR_BAD : UI_INK);
  setCur(centerX(ms, 2), 312);
  printT(ms);
}

function renderCard() {
  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  if (cardPage === 0) renderCardProfile();
  else if (cardPage === 1) renderCardStats();
  else if (cardPage === 2) renderCardMedals();
  else renderCardProgress();
  for (let i = 0; i < 4; i++) {
    if (i === cardPage) gfx.fillCircle(194 + i * 26, 374, 5, UI_INK);
    else gfx.drawCircle(194 + i * 26, 374, 4, UI_INK);
  }
  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(T(S_BACK), 2), 398);
  printT(T(S_BACK));
}

// ---- clavier pour renommer
const KB_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const KB_COLS = 6, KB_X = 40, KB_Y = 150, KB_W = 64, KB_H = 52;
function openKeyboard() {
  kbOpen = true;
  nameBuf = pet.nick.slice(0, 11);
}
function renderKeyboard() {
  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(T(S_NAME), 2), 56);
  printT(T(S_NAME));
  gfx.fillRoundRect(83, 84, 300, 40, 8, UI_WHITE);
  gfx.drawRoundRect(83, 84, 300, 40, 8, UI_INK);
  // le clavier est en alphabet latin : toujours la police classique
  const cjk = gCjkFont; gCjkFont = false;
  setSize(3);
  setCur(95, 94);
  printT(nameBuf.length ? nameBuf : '_');
  for (let i = 0; i < 30; i++) {
    const x = KB_X + (i % KB_COLS) * KB_W, y = KB_Y + Math.floor(i / KB_COLS) * KB_H;
    const special = i >= 28;
    gfx.fillRoundRect(x, y, KB_W - 6, KB_H - 6, 6, special ? UI_BAR_WARN : UI_WHITE);
    gfx.drawRoundRect(x, y, KB_W - 6, KB_H - 6, 6, UI_INK);
    gfx.setTextColor(UI_INK);
    setSize(2);
    if (i < 28) {
      setCur(x + KB_W / 2 - 9, y + KB_H / 2 - 10);
      printT(KB_KEYS[i]);
    } else {
      setCur(x + KB_W / 2 - 15, y + KB_H / 2 - 10);
      printT(i === 28 ? '<-' : 'OK');
    }
  }
  gCjkFont = cjk;
}
function keyboardTap(x, y) {
  if (x < KB_X || y < KB_Y) return;
  const col = idiv(x - KB_X, KB_W), row = idiv(y - KB_Y, KB_H);
  if (col >= KB_COLS || row >= 5) return;
  const i = row * KB_COLS + col;
  if (i >= 30) return;
  if (i === 28) nameBuf = nameBuf.slice(0, -1);
  else if (i === 29) { pet.rename(nameBuf); kbOpen = false; }
  else if (nameBuf.length < 11) nameBuf += KB_KEYS[i];
}

// ---- galerie Pokédex
const GAL_X = 73, GAL_Y = 84, GAL_CELL = 80;
function drawThumb(t, x, y, s, sil) {
  const cv = thumbs.canvas(t, sil);
  const ox = x + idiv(GAL_CELL - cv.width * s, 2);
  const oy = y + idiv(GAL_CELL - cv.height * s, 2);
  gfx.image(cv, ox, oy, cv.width * s, cv.height * s);
}

function renderGallery() {
  if (galleryDetail) {
    gfx.fillScreen(RGB565_BLACK);
    gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
    const d = DEX_TBL[galleryDetail];
    const reg = pet.isRegistered(galleryDetail);
    const head = `N.${pad3(galleryDetail)} ${pet.isShinyRegistered(galleryDetail) ? '*' : ''}${reg ? dexName(galleryDetail) : '???'}`;
    gfx.setTextColor(reg ? d.accent : UI_INK);
    setSize(3);
    const gts = (textW(head, 3) <= 234) ? 3 : 2;
    setSize(gts);
    setCur(centerX(head, gts), gts === 3 ? 56 : 60);
    printT(head);
    if (galleryPmd.loaded) {
      drawPmdActM(galleryPmd, PMD_IDLE, CX, 300, reg ? millis() : 0, true, !reg, 6);
    } else {
      const t = thumbs.get(galleryDetail);
      if (t) drawThumb(t, CX - GAL_CELL, 135, 4, !reg);
    }
    gfx.setTextColor(UI_INK);
    setSize(2);
    setCur(centerX(T(S_DETAIL_BACK), 2), 408);
    printT(T(S_DETAIL_BACK));
    return;
  }

  if (!galleryDirty) return;
  galleryDirty = false;

  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  const head = sprintf(T(S_POKEDEX_FMT), pet.registeredCount());
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(head, 3), 36);
  printT(head);

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const dex = galleryPage * 16 + r * 4 + c + 1;
      if (dex > 151) break;
      const x = GAL_X + c * GAL_CELL, y = GAL_Y + r * GAL_CELL;
      const t = thumbs.get(dex);
      if (t) {
        drawThumb(t, x, y, 2, !pet.isRegistered(dex));
        if (pet.isShinyRegistered(dex)) {
          gfx.setTextColor(UI_BAR_WARN);
          setSize(2);
          setCur(x + 62, y + 4);
          printT('*');
        }
      } else {
        gfx.setTextColor(UI_TRACK);
        setSize(2);
        setCur(x + 24, y + 32);
        printT(String(dex));
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    if (i === galleryPage) gfx.fillCircle(170 + i * 14, 436, 4, UI_INK);
    else gfx.drawCircle(170 + i * 14, 436, 3, UI_INK);
  }
}

function galleryTap(x, y) {
  if (galleryDetail) {
    galleryDetail = 0;
    galleryPmd.unload();
    galleryDirty = true;
    return;
  }
  if (y < 72) {
    galleryOpen = false;
    galleryPmd.unload();
    return;
  }
  if (x < GAL_X || y < GAL_Y) return;
  const c = idiv(x - GAL_X, GAL_CELL), r = idiv(y - GAL_Y, GAL_CELL);
  if (c > 3 || r > 3) return;
  const dex = galleryPage * 16 + r * 4 + c + 1;
  if (dex > 151) return;
  galleryDetail = dex;
  galleryPmd.load(dex, pet.isShinyRegistered(dex));
}

function drawHeader(name, nameColor, msg) {
  gfx.setTextColor(nameColor);
  setSize(3);
  setCur(centerX(name, 3), 52);
  printT(name);
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(centerX(msg, 2), 90);
  printT(msg);
}

function drawCeremony() {
  if (!pmd.loaded) { drawPet(); return; }
  const now = millis();
  const t = pet.ceremonyT();
  const panic = (pet.ceremony === CER_RUNAWAY);
  let x = CX;
  const y = PET_GROUND;
  let act = PMD_IDLE;

  if (panic) {
    for (let i = 0; i < 46; i++) {
      const rx = (i * 47 + Math.floor(now / 3)) % 466;
      const ry = (i * 91 + Math.floor(now / 2)) % 470;
      gfx.drawLine(rx, ry, rx - 3, ry + 12, C565(0x6a, 0x84, 0xb0));
    }
    let fade = false;
    if (t < 0.30) {
      act = pmd.has(PMD_HURT) ? PMD_HURT : PMD_IDLE;
      x = CX + Math.trunc(4 * Math.sin(now * 0.04));
    } else {
      act = pmd.has(PMD_WALKL) ? PMD_WALKL : PMD_IDLE;
      x = CX - Math.trunc(((t - 0.30) / 0.70) * (CX + 120));
      fade = (t > 0.6) && (Math.floor(now / 160) % 2 === 0);
    }
    drawPmdAct(act, x, y, now, true, fade, 5);
    if (t < 0.55) {
      const ty = y - 150 + (Math.floor(now / 6) % 40);
      gfx.fillRect(x + 6, ty, 3, 6, C565(0x9a, 0xc4, 0xe8));
    }
    return;
  }

  const gcy = PET_GROUND - 96;
  for (let k = 0; k < 4; k++) {
    const r = 60 + k * 34 + Math.trunc(10 * Math.sin(now * 0.02));
    gfx.drawCircle(CX, gcy, r, C565(0xff, 0xdf, 0x8a));
  }
  for (let i = 0; i < 16; i++) {
    const px = (i * 71 + 28) % 466;
    const py = 410 - ((Math.floor(now / 8) + i * 70) % 360);
    if (py < 30) continue;
    if (i % 4 === 0) drawMap('SPR_HEART', 32, px - 8, py - 8, 1, false);
    else gfx.fillRect(px, py, 4, 4, (i % 2) ? C565(0xff, 0xe7, 0x9f) : C565(0xff, 0x9a, 0xc0));
  }
  if (t < 0.45) {
    act = pmd.has(PMD_POSE) ? PMD_POSE : (pmd.has(PMD_NOD) ? PMD_NOD : PMD_IDLE);
  } else {
    act = pmd.has(PMD_WALKR) ? PMD_WALKR : PMD_IDLE;
    x = CX + Math.trunc(((t - 0.45) / 0.55) * (CX + 140));
  }
  drawPmdAct(act, x, y, now, true, false, 5);
  if (pet.showHeart()) drawMap('SPR_HEART', 32, x + 50, y - 190, 2, false);
}

function drawChoiceDialog() {
  let q, o1, o2, c1, c2, t1, t2;
  if (choiceKind === 1) {
    q = T(S_EVO_Q); o1 = T(S_EVO_TAP); o2 = T(S_EVO_KEEP);
    c1 = UI_BAR_BAD; t1 = UI_WHITE; c2 = UI_TRACK; t2 = UI_INK;
  } else {
    q = T(S_FAR_Q); o1 = T(S_FAR_GO); o2 = T(S_FAR_STAY);
    c1 = UI_BAR_WARN; t1 = UI_INK; c2 = UI_BAR_OK; t2 = UI_WHITE;
  }
  gfx.fillRoundRect(73, 156, 320, 188, 16, UI_WHITE);
  gfx.drawRoundRect(73, 156, 320, 188, 16, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(q, 2), 176);
  printT(q);
  gfx.fillRoundRect(93, 206, 280, 52, 12, c1);
  gfx.setTextColor(t1);
  setCur(centerX(o1, 2), 224);
  printT(o1);
  gfx.fillRoundRect(93, 268, 280, 52, 12, c2);
  gfx.setTextColor(t2);
  setCur(centerX(o2, 2), 286);
  printT(o2);
}

function drawEvolveButton() {
  const now = millis();
  const p = Math.trunc(5 * Math.sin(now * 0.006));
  const x = EVO_BTN_X - p, y = EVO_BTN_Y - p, w = EVO_BTN_W + 2 * p, h = EVO_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 18, UI_BAR_BAD);
  gfx.drawRoundRect(x, y, w, h, 18, UI_WHITE);
  gfx.drawRoundRect(x + 2, y + 2, w - 4, h - 4, 16, UI_WHITE);
  gfx.setTextColor(UI_WHITE);
  setSize(3);
  const t = T(S_EVO_TAP);
  setCur(centerX(t, 3), y + idiv(h, 2) - 11);
  printT(t);
}
function drawFarewellButton() {
  const now = millis();
  const p = Math.trunc(4 * Math.sin(now * 0.005));
  const x = FAR_BTN_X - p, y = FAR_BTN_Y - p, w = FAR_BTN_W + 2 * p, h = FAR_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 16, UI_BAR_WARN);
  gfx.drawRoundRect(x, y, w, h, 16, UI_INK);
  const nm = pet.nick ? pet.nick : dexName(pet.speciesId);
  const buf = sprintf(T(S_FAREWELL_BTN), nm);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(buf, 2), y + idiv(h, 2) - 8);
  printT(buf);
}
function drawRunawayButton() {
  const now = millis();
  const p = Math.trunc(3 * Math.sin(now * 0.003));
  const x = FAR_BTN_X - p, y = FAR_BTN_Y - p, w = FAR_BTN_W + 2 * p, h = FAR_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 16, C565(0x3a, 0x44, 0x5a));
  gfx.drawRoundRect(x, y, w, h, 16, C565(0x70, 0x80, 0x98));
  const nm = pet.nick ? pet.nick : dexName(pet.speciesId);
  const buf = sprintf(T(S_RUNAWAY_BTN), nm);
  gfx.setTextColor(C565(0xc8, 0xd2, 0xe0));
  setSize(2);
  setCur(centerX(buf, 2), y + idiv(h, 2) - 8);
  printT(buf);
}

function drawEvolveFX(now) {
  const t = pet.evolveT();
  const cx = CX, cy = PET_GROUND - 96;
  const halo = 36 + Math.trunc(t * 150) + Math.trunc(8 * Math.sin(now * 0.02));
  for (let k = 0; k < 4; k++) {
    const r = halo - k * 7;
    if (r > 0) gfx.drawCircle(cx, cy, r, UI_WHITE);
  }
  const base = now * 0.004;
  for (let i = 0; i < 12; i++) {
    const a = base + i * (Math.PI / 6);
    const len = 90 + Math.trunc(70 * (0.5 + 0.5 * Math.sin(now * 0.012 + i)));
    gfx.drawLine(cx, cy, cx + Math.trunc(Math.cos(a) * len), cy + Math.trunc(Math.sin(a) * len), UI_WHITE);
  }
  const period = 60 + Math.trunc(220 * (1 - t));
  const showOld = t < 0.9 && evoPmd.loaded && (Math.floor(now / period) % 2) === 0;
  if (showOld) drawPmdActM(evoPmd, PMD_IDLE, cx, PET_GROUND, 0, true, true, 5);
  else drawPmdAct(PMD_IDLE, cx, PET_GROUND, 0, true, true, 5);
  for (let i = 0; i < 10; i++) {
    const a = i * (Math.PI / 5) + t * 4.0;
    const d = (Math.floor(now / 14) + i * 33) % 200;
    const sx = cx + Math.trunc(Math.cos(a) * d), sy = cy + Math.trunc(Math.sin(a) * d);
    gfx.fillRect(sx - 2, sy - 2, 5, 5, (i & 1) ? C565(0xff, 0xe0, 0x70) : UI_WHITE);
  }
  if (t > 0.9) gfx.fillCircle(cx, cy, Math.trunc(300 * (t - 0.9) / 0.1), UI_WHITE);
}

function drawPet() {
  if (pmd.loaded || pmd.loading || pet.evolving()) { drawPetPMD(); return; }
  // sprite introuvable dans l'APK : message clair (comme sans carte SD)
  gfx.setTextColor(inkColor());
  setSize(6);
  setCur(CX - 18, PET_CY - 80);
  printT('?');
  setSize(2);
  const l1 = T(S_NO_SPRITES);
  setCur(centerX(l1, 2), PET_CY - 4);
  printT(l1);
}

// ---- bain
function startBath() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony || bathUntil) return;
  bathUntil = millis() + 3000;
  bathPending = true;
  const cx = Math.trunc(beh.x);
  for (const b of bubbles) {
    b.x = cx - 70 + random(140);
    b.y = PET_GROUND - random(150);
    b.r = 8 + random(16);
    b.ph = random(64);
  }
}
function drawBath() {
  const now = millis();
  if (!timeLeft(bathUntil)) {
    bathUntil = 0;
    if (bathPending) {
      bathPending = false;
      pet.clean();
      if (pmd.has(PMD_POSE)) {
        beh.mode = 2;
        beh.act = PMD_POSE;
        beh.t0 = now;
        beh.until = now + pmdActTotalMs(pmd.acts[PMD_POSE]) * 2;
      }
    }
    return;
  }
  const left = bathUntil - now;
  if (left > 800) {
    const t = now / 220.0;
    for (const b of bubbles) {
      const bx = b.x + Math.trunc(Math.sin(t + b.ph) * 6);
      const by = b.y - Math.floor((3000 - left) / 90);
      gfx.fillCircle(bx, by, b.r, UI_WHITE);
      gfx.drawCircle(bx, by, b.r, 0x7E3D);
      gfx.fillCircle(bx - idiv(b.r, 3), by - idiv(b.r, 3), idiv(b.r, 4), UI_BG_DAY);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const b = bubbles[i];
      const sx = b.x + (i % 3) * 6 - 6, sy = b.y - 18;
      const col = (i % 2) ? UI_BAR_WARN : UI_WHITE;
      gfx.fillRect(sx - 6, sy - 1, 13, 3, col);
      gfx.fillRect(sx - 1, sy - 6, 3, 13, col);
    }
  }
}

// ---- comportement du sprite PMD
function pmdActTotalMs(a) {
  let t = 0;
  for (let i = 0; i < a.frames; i++) t += a.ms[i];
  return t ? t : 100;
}
function pmdFrameAt(a, t, loop) {
  const total = pmdActTotalMs(a);
  if (!loop && t >= total) return a.frames - 1;
  t %= total;
  let i = 0;
  for (let guard = 0; guard < a.frames && t >= a.ms[i]; guard++) {
    t -= a.ms[i];
    i = (i + 1) % a.frames;
  }
  return i;
}
function drawPmdActM(m, actId, cx, groundY, t, loop, sil, maxS) {
  if (!m.loaded) return;
  const a = m.acts[actId];
  if (!a.frames) return;
  const idleH = m.acts[PMD_IDLE].h;
  let sBase = idleH ? Math.floor(170 / idleH) : 5;
  if (sBase < 2) sBase = 2;
  if (sBase > maxS) sBase = maxS;
  let s = sBase;
  while (s > 2 && a.h * s > 250) s--;
  const fi = pmdFrameAt(a, Math.max(0, t), loop);
  const x0 = cx - Math.floor(a.w * s / 2), y0 = groundY - (a.base ? a.base : a.h) * s;
  gfx.image(pmdFrameCanvas(m, a, fi, sil), x0, y0, a.w * s, a.h * s);
}
function drawPmdAct(actId, cx, groundY, t, loop, sil, maxS) {
  drawPmdActM(pmd, actId, cx, groundY, t, loop, sil, maxS);
}

function behNext() {
  const now = millis();
  beh.t0 = now;
  const r = random(100);
  if (r < 35 && (pmd.has(PMD_WALKL) || pmd.has(PMD_WALKR))) {
    beh.mode = 1;
    beh.targetX = 150 + random(176);
    beh.until = now + 15000;
  } else if (r < 60) {
    const pick = [PMD_POSE, PMD_NOD, PMD_BREATH].filter((f) => pmd.has(f));
    if (pick.length) {
      beh.mode = 2;
      beh.act = pick[random(pick.length)];
      beh.until = now + pmdActTotalMs(pmd.acts[beh.act]);
      return;
    }
    beh.mode = 0;
    beh.until = now + 2000 + random(3000);
  } else {
    beh.mode = 0;
    beh.until = now + 2000 + random(3000);
  }
}

function drawPetPMD() {
  const now = millis();
  if (pet.evolving()) { drawEvolveFX(now); return; }
  if (evoPmd.loaded) evoPmd.unload();
  if (!pmd.loaded) return;  // encore en chargement

  const m = pet.mood();
  let act;
  let loop = true;
  if (m === MOOD_SLEEPING && pmd.has(PMD_SLEEP)) {
    act = PMD_SLEEP;
    beh.mode = 0;
  } else if (m === MOOD_EATING && pmd.has(PMD_EAT)) {
    act = PMD_EAT;
    beh.t0 = 0;
  } else if (m === MOOD_SAD && pmd.has(PMD_HURT)) {
    act = PMD_HURT;
  } else {
    if (now > beh.until) behNext();
    if (beh.mode === 1) {
      const d = beh.targetX - beh.x;
      const step = 3 * Math.min(3, frameDt / 100);  // 3 px par image de 100 ms sur la carte
      if (Math.abs(d) < Math.max(4, step)) {
        behNext();
        act = PMD_IDLE;
      } else {
        beh.x += (d > 0 ? step : -step);
        act = d > 0 ? PMD_WALKR : PMD_WALKL;
      }
    } else {
      act = beh.mode === 2 ? beh.act : PMD_IDLE;
      loop = false;
    }
    if (!pmd.has(act)) act = PMD_IDLE;
  }
  drawPmdAct(act, Math.trunc(beh.x), PET_GROUND, now - beh.t0, loop || act === PMD_IDLE, false, 5);
  if (pet.showHeart()) drawMap('SPR_HEART', 32, Math.trunc(beh.x) + 50, PET_GROUND - 190, 2, false);
}

function drawPoops() {
  for (let i = 0; i < pet.poops; i++) drawMap('SPR_POOP', 32, 36 + i * 46, 244, 2, false);
}
function drawBars() {
  if (TP_EXT) { drawBars5(); return; }
  drawBar(78, 318, T(S_BAR_FOOD), pet.fullness);
  drawBar(244, 318, T(S_BAR_JOY), pet.joy);
  drawBar(78, 346, T(S_BAR_ENE), pet.energy);
  drawBar(244, 346, T(S_BAR_HYG), pet.hygiene);
}
function barLabelGap() {
  const ids = [S_BAR_FOOD, S_BAR_JOY, S_BAR_ENE, S_BAR_HYG];
  let ancho = 0;
  for (const id of ids) { const w = textW(T(id), 2); if (w > ancho) ancho = w; }
  return ancho <= 48 ? 48 : ancho + 8;
}
// fork : 5 besoins sur deux rangées (3 + 2), colonnes de 118 px
function drawBars5() {
  const labels = [T(S_BAR_FOOD), TX('X_BAR_WATER'), T(S_BAR_JOY), T(S_BAR_ENE), T(S_BAR_HYG)];
  setSize(2);
  let ancho = 0;
  for (const l of labels) { const w = textW(l, 2); if (w > ancho) ancho = w; }
  const gap = ancho + 4, bw = 118 - gap - 6;
  const cell = (x, y, label, val) => {
    gfx.setTextColor(inkColor());
    setSize(2);
    setCur(x, y);
    printT(label);
    const bx = x + gap, bh = 15;
    const fill = (val >= 50) ? UI_BAR_OK : (val >= 25) ? UI_BAR_WARN : UI_BAR_BAD;
    gfx.fillRoundRect(bx, y, bw, bh, 4, UI_TRACK);
    const fw = idiv((bw - 4) * val, 100);
    if (fw > 0) gfx.fillRoundRect(bx + 2, y + 2, fw, bh - 4, 3, fill);
  };
  cell(56, 316, labels[0], pet.fullness);
  cell(174, 316, labels[1], pet.water);
  cell(292, 316, labels[2], pet.joy);
  cell(115, 338, labels[3], pet.energy);
  cell(233, 338, labels[4], pet.hygiene);
}

function drawBar(x, y, label, val) {
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(x, y);
  printT(label);
  const gap = barLabelGap();
  let bw = 232 - (78 + gap);
  if (bw > 100) bw = 100;
  const bx = x + gap, bh = 15;
  const fill = (val >= 50) ? UI_BAR_OK : (val >= 25) ? UI_BAR_WARN : UI_BAR_BAD;
  gfx.fillRoundRect(bx, y, bw, bh, 4, UI_TRACK);
  const fw = idiv((bw - 4) * val, 100);
  if (fw > 0) gfx.fillRoundRect(bx + 2, y + 2, fw, bh - 4, 3, fill);
}
function drawButtons() {
  for (let i = 0; i < buttons.length; i++) {
    const off = pet.sleeping && buttons[i].id !== 'light';
    const bx = buttons[i].cx - BTN_HALF, by = buttons[i].cy - BTN_HALF;
    if (!pet.sleeping) gfx.fillRoundRect(bx, by, 2 * BTN_HALF, 2 * BTN_HALF, 14, UI_WHITE);
    gfx.drawRoundRect(bx, by, 2 * BTN_HALF, 2 * BTN_HALF, 14, inkColor());
    if (!off) drawMap(buttons[i].icon, 16, buttons[i].cx - 16, buttons[i].cy - 16, 2, false);
  }
}
function eggMsg() {
  switch (pet.eggCracks()) {
    case 0: return T(S_EGG_TOUCH);
    case 1: return T(S_EGG_MOVES);
    default: return T(S_EGG_ALMOST);
  }
}
function statusMsg() {
  if (pet.evolving()) return T(S_EVOLVING);
  if (bathUntil) return 'Splish splash!';
  if (pet.sleeping) return 'Zzz...';
  if (TP_EXT && timeLeft(toastUntil)) return toastText;
  if (pet.eating()) return T(S_EATING);
  if (TP_EXT && pet.drinking()) return TX('X_DRINKING');
  if (pet.showHeart()) return T(S_LIKES);
  if (pet.fullness < 25) return T(S_HUNGRY);
  if (TP_EXT && pet.water < 25) return TX('X_THIRSTY');
  if (pet.hygiene < 25) return T(S_NEEDS_BATH);
  if (pet.energy < 25) return T(S_EXHAUSTED);
  if (pet.joy < 25) return T(S_SAD);
  if (pet.weight > 60) return T(S_CHUBBY);
  if (pet.shiny && pet.ageMinutes < 15) return T(S_IS_SHINY);
  return T(S_HAPPY);
}
function drawMap(name, n, x, y, s, silhouette) {
  gfx.image(mapCanvas(name, silhouette), x, y, n * s, n * s);
}

// ==================================================== fork : soif, pas, combats
let pedOpen = false, battleOpen = false;
let toastText = '', toastUntil = 0;
function toast(t, ms = 2500) { toastText = t; toastUntil = millis() + ms; }

// ---- pastilles du haut (série + pas). Le firmware place la flamme en (26,16),
// hors du cercle visible : ici les deux sont centrées dans la bande du haut.
function drawTopBadges() {
  const parts = [];
  if (pet.streak >= 1) parts.push({ kind: 'streak', text: String(pet.streak) });
  const encTxt = pet.pendingEnc > 0 ? `!${pet.pendingEnc}` : fmtSteps(pet.stepsToday);
  parts.push({ kind: 'steps', text: encTxt });
  setSize(2);
  const wOf = (p) => 18 + textW(p.text, 2);
  let total = parts.reduce((a, p) => a + wOf(p), 0) + (parts.length - 1) * 14;
  let x = CX - idiv(total, 2);
  const y = 16;
  for (const p of parts) {
    if (p.kind === 'streak') {
      gfx.fillTriangle(x + 8, y, x + 1, y + 17, x + 15, y + 17, UI_BAR_BAD);
      gfx.fillTriangle(x + 8, y + 7, x + 4, y + 17, x + 12, y + 17, UI_BAR_WARN);
      gfx.setTextColor(inkColor());
    } else {
      drawMap('SPR_ICON_STEP', 16, x, y + 1, 1, false);
      gfx.setTextColor(pet.pendingEnc > 0 ? UI_BAR_BAD : inkColor());
    }
    setCur(x + 18, y + 2);
    printT(p.text);
    x += wOf(p) + 14;
  }
}
function fmtSteps(n) { return n >= 10000 ? `${Math.floor(n / 1000)}k` : String(n); }

// ---- pastille « Un POKEMON sauvage ! »
const WILD_BTN_W = 300, WILD_BTN_H = 40, WILD_BTN_X = CX - 150, WILD_BTN_Y = 110;
function wildBtnShown() {
  return pet.canBattle() && !pet.wantEvolveButton() && !pet.canRunawayNow() && !pet.wantFarewellButton() &&
         !feedMenuUntil && !confirmUntil && !choiceKind && !bathUntil;
}
function drawWildButton() {
  const now = millis();
  const p = Math.trunc(3 * Math.sin(now * 0.008));
  const x = WILD_BTN_X - p, y = WILD_BTN_Y - p, w = WILD_BTN_W + 2 * p, h = WILD_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 14, UI_BAR_OK);
  gfx.drawRoundRect(x, y, w, h, 14, UI_INK);
  const t = TX('X_WILD_BTN');
  gfx.setTextColor(UI_WHITE);
  setSize(2);
  setCur(centerX(t, 2), y + idiv(h, 2) - 8);
  printT(t);
}

// ---- podomètre : capteur natif (TYPE_STEP_COUNTER), sinon accéléromètre
// state : 1 capteur actif, 0 permission à demander, -1 pas de capteur, 2 accéléromètre
let stepState = -1, lastStepPoll = 0, motionOn = false, motionSteps = 0, motionSeen = false;
function pollSteps() {
  let st = -1;
  try { if (window.TPStore && window.TPStore.stepState) st = window.TPStore.stepState(); } catch (e) { st = -1; }
  if (st === 1) {
    stepState = 1;
    let cur = -1;
    try { cur = Number(window.TPStore.getSteps()); } catch (e) { cur = -1; }
    if (cur >= 0) applyCumulative(Math.floor(cur));
    return;
  }
  if (st === 0) { stepState = 0; return; }
  enableMotion();
  stepState = motionSeen ? 2 : -1;
  if (motionSteps > 0) {
    const n = motionSteps;
    motionSteps = 0;
    if (pet.addSteps(n)) sfxPlay(SFX_WILD);
  }
}
// compteur matériel cumulé depuis le démarrage du téléphone : on ne garde que la
// différence avec la dernière lecture (les pas faits appli fermée comptent)
function applyCumulative(cur) {
  const last = prefs.get('stepLast', -1);
  prefs.put('stepLast', cur);
  if (last < 0) { prefs.flush(); return; }          // première lecture : point de départ
  let delta = cur >= last ? cur - last : cur;       // redémarrage : le compteur repart de 0
  if (delta > 60000) delta = 60000;                 // garde-fou
  if (delta > 0) { if (pet.addSteps(delta)) sfxPlay(SFX_WILD); } else prefs.flush();
}
function enableMotion() {
  if (motionOn || typeof window.DeviceMotionEvent === 'undefined') return;
  motionOn = true;
  let avg = 9.8, lastStep = 0, armed = true;
  window.addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    motionSeen = true;
    const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    avg = avg * 0.9 + m * 0.1;
    const t = performance.now();
    if (armed && m - avg > 1.8 && t - lastStep > 280) { motionSteps++; lastStep = t; armed = false; }
    else if (m - avg < 0.3) armed = true;
  });
}
function openPed() {
  if (pet.awaitingStarter()) return;
  pedOpen = true;
  pollSteps();
}
function pedTap(x, y) {
  if (stepState === 0 && y >= 318 && y <= 348) {
    try { window.TPStore.askStepPermission(); } catch (e) { /* rien */ }
    return;
  }
  if (pet.canBattle() && y >= 352 && y <= 394 && x >= 133 && x <= 333) {
    pedOpen = false;
    openBattle();
    return;
  }
  pedOpen = false;
}
function renderPed() {
  gfx.fillScreen(RGB565_BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
  gfx.setTextColor(UI_INK);
  setSize(3);
  const title = TX('X_PED_TITLE');
  setCur(centerX(title, 3), 40);
  printT(title);
  drawMap('SPR_ICON_STEP', 16, CX - 16, 70, 2, false);

  const big = String(pet.stepsToday);
  setSize(5);
  setCur(centerX(big, 5), 108);
  printT(big);
  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(TX('X_STEPS_TODAY'), 2), 154);
  printT(TX('X_STEPS_TODAY'));
  const tot = sprintf(TX('X_STEPS_TOTAL'), pet.stepsTotal, pet.stepsBest);
  gfx.setTextColor(UI_INK);
  setCur(centerX(tot, 2), 180);
  printT(tot);

  // jauge vers la prochaine rencontre
  const bx = 93, bw = 280, by = 208, bh = 18;
  gfx.fillRoundRect(bx, by, bw, bh, 6, UI_TRACK);
  const span = Math.max(1, pet.encSpan);
  const frac = pet.pendingEnc >= 3 ? 1 : Math.min(1, Math.max(0, 1 - pet.stepsToEnc / span));
  const fw = Math.floor((bw - 4) * frac);
  if (fw > 0) gfx.fillRoundRect(bx + 2, by + 2, fw, bh - 4, 5, pet.pendingEnc > 0 ? UI_BAR_WARN : UI_BAR_OK);
  const nx = pet.pendingEnc >= 3 ? TX('X_ENC_FULL') : sprintf(TX('X_NEXT_ENC'), pet.stepsToEnc);
  setCur(centerX(nx, 2), 234);
  printT(nx);
  const ec = sprintf(TX('X_ENC_COUNT'), pet.pendingEnc);
  gfx.setTextColor(pet.pendingEnc > 0 ? UI_BAR_BAD : UI_INK);
  setCur(centerX(ec, 2), 260);
  printT(ec);
  const wn = sprintf(TX('X_WINS'), pet.battlesWon);
  gfx.setTextColor(UI_INK);
  setCur(centerX(wn, 2), 284);
  printT(wn);
  if (pet.reservedEgg) {
    const ne = sprintf(TX('X_NEXT_EGG'), (pet.reservedShiny ? '*' : '') + dexName(pet.reservedEgg));
    gfx.setTextColor(0x4C98);
    setCur(centerX(ne, 2), 306);
    printT(ne);
  }
  let hint, hc = UI_TRACK;
  if (stepState === 0) { hint = TX('X_ALLOW'); hc = UI_BAR_BAD; }
  else if (stepState === -1) hint = TX('X_NO_SENSOR');
  else hint = TX('X_WALK_HINT');
  gfx.setTextColor(hc);
  setCur(centerX(hint, 2), 328);
  printT(hint);
  if (pet.canBattle()) {
    gfx.fillRoundRect(133, 352, 200, 42, 14, UI_BAR_OK);
    gfx.setTextColor(UI_WHITE);
    setSize(3);
    setCur(centerX(T(S_BATTLE), 3), 362);
    printT(T(S_BATTLE));
  }
  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(T(S_BACK), 2), 410);
  printT(T(S_BACK));
}

// ---- combat
const wildPmd = new PmdMon();
const TURN_MS = 1300, HIT_AT = 760;
let bt = null;
const WILD_POS = { x: 330, y: 214 }, ME_POS = { x: 150, y: 330 };

function openBattle() {
  if (!pet.canBattle()) return;
  if (pet.energy < 20) { toast(TX('X_TOO_TIRED')); sfxPlay(SFX_DENY); return; }
  const w = pet.pickWild();
  w.max = w.hp;
  bt = {
    phase: 'intro', t0: millis(), wild: w,
    me: { hp: pet.hpMax(), max: pet.hpMax(), atk: pet.atkStat(), def: pet.defStat(), spe: pet.speStat() },
    turn: 'me', applied: false, crit: false, tapped: false, msg: '', popups: [],
    hurt: { me: 0, wild: 0 }, shownHp: { me: 0, wild: 0 }, result: 0,
  };
  bt.shownHp.me = bt.me.hp; bt.shownHp.wild = w.hp;
  bt.msg = sprintf(TX('X_WILD_NAME'), (w.shiny ? '*' : '') + dexName(w.dex));
  wildPmd.load(w.dex, w.shiny);
  battleOpen = true;
  feedMenuUntil = 0; confirmUntil = 0; choiceKind = 0;
  sfxPlay(SFX_WILD);
}
function endBattle(result) {
  if (!bt) return;
  pet.battleResult(result, bt.wild);
  if (result === -1) toast(TX('X_FLED'));
  battleOpen = false;
  wildPmd.unload();
  bt = null;
}
function startFight() {
  bt.phase = 'fight';
  const me = bt.me.spe, wi = bt.wild.spe;
  bt.turn = me > wi ? 'me' : me < wi ? 'wild' : (random(2) ? 'me' : 'wild');
  newTurn();
}
function newTurn() {
  bt.t0 = millis(); bt.applied = false; bt.crit = false; bt.tapped = false;
  bt.msg = bt.turn === 'me' ? TX('X_TAP_HINT')
         : sprintf(TX('X_ATTACKS'), (bt.wild.shiny ? '*' : '') + dexName(bt.wild.dex));
}
function myName() { return pet.nick ? pet.nick : dexName(pet.speciesId); }
function ringRadius(t) { return 24 + Math.max(0, (HIT_AT - t) / HIT_AT) * 72; }

function battleTap(x, y) {
  const now = millis();
  if (bt.phase === 'intro') {
    if (y >= 384 && y <= 428) {
      if (x >= 125 && x < 230) startFight();
      else if (x >= 236 && x <= 341) endBattle(-1);
    }
    return;
  }
  if (bt.phase === 'fight') {
    if (bt.turn === 'me' && !bt.applied && !bt.tapped) {
      bt.tapped = true;
      if (ringRadius(now - bt.t0) <= 36) bt.crit = true;  // dans la cible
    }
    return;
  }
  if (bt.phase === 'egg') {
    if (y >= 330 && y <= 380) {
      if (x >= 113 && x < 228) pet.reserveEgg(bt.wild);
      if (x >= 113 && x <= 353) { battleOpen = false; wildPmd.unload(); bt = null; }
    }
    return;
  }
  if (bt.phase === 'result' && now - bt.t0 > 1200) finishResult();
}
function finishResult() {
  if (bt.result === 1) { bt.phase = 'egg'; bt.t0 = millis(); return; }
  battleOpen = false; wildPmd.unload(); bt = null;
}

function drawBattleScene() {
  const hh = sceneHour();
  const night = hh < 6 || hh >= 20;
  const [top, bot] = skyColors(hh, night);
  const hor = 250;
  for (let y = 0; y < hor; y += 8) gfx.fillRect(0, y, 466, 8, lerp565(top, bot, y, hor));
  if (night) for (const st of STARS) gfx.fillRect(st[0], st[1], 4, 4, UI_WHITE);
  const bio = DEX_TBL[bt.wild.dex].biome;
  let soil = BIOME_SOIL[bio < 6 ? bio : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  gfx.fillRect(0, hor, 466, 466 - hor, soil);
  const pad = lerp565(soil, C565(0x10, 0x18, 0x20), 4, 16);
  gfx.fillRoundRect(WILD_POS.x - 70, WILD_POS.y - 10, 140, 20, 10, pad);  // estrades ovales
  gfx.fillRoundRect(ME_POS.x - 70, ME_POS.y - 10, 140, 20, 10, pad);
  return night ? UI_INK_NIGHT : UI_INK;
}
function drawHpBox(x, y, name, lv, hp, max) {
  gfx.fillRoundRect(x, y, 196, 44, 10, UI_WHITE);
  gfx.drawRoundRect(x, y, 196, 44, 10, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(2);
  const lvT = sprintf(T(S_LVL_FMT), lv);
  // le nom se raccourcit pour laisser la place au niveau
  let nm = name;
  while (nm.length > 3 && textW(nm, 2) > 176 - textW(lvT, 2) - 10) nm = nm.slice(0, -1);
  setCur(x + 10, y + 6);
  printT(nm);
  setCur(x + 186 - textW(lvT, 2), y + 6);
  printT(lvT);
  const bw = 176, bx = x + 10, by = y + 26;
  gfx.fillRoundRect(bx, by, bw, 10, 4, UI_TRACK);
  const v = Math.max(0, hp);
  const fw = Math.floor((bw - 4) * v / max);
  const col = v * 2 >= max ? UI_BAR_OK : v * 4 >= max ? UI_BAR_WARN : UI_BAR_BAD;
  if (fw > 0) gfx.fillRoundRect(bx + 2, by + 2, fw, 6, 3, col);
}

function renderBattle() {
  const now = millis();
  const ink = drawBattleScene();
  const w = bt.wild;
  const t = now - bt.t0;

  // logique du tour
  if (bt.phase === 'fight') {
    const att = bt.turn === 'me' ? bt.me : w;
    const def = bt.turn === 'me' ? w : bt.me;
    if (!bt.applied && t >= HIT_AT) {
      const dmg = battleDamage(att.atk, def.def, bt.turn === 'me' && bt.crit);
      def.hp = Math.max(0, def.hp - dmg);
      bt.applied = true;
      const tgt = bt.turn === 'me' ? WILD_POS : ME_POS;
      bt.popups.push({ x: tgt.x, y: tgt.y - 150, text: `-${dmg}`, t0: now, crit: bt.turn === 'me' && bt.crit });
      bt.hurt[bt.turn === 'me' ? 'wild' : 'me'] = now + 450;
      if (bt.turn === 'me') bt.msg = bt.crit ? TX('X_CRIT') : sprintf(TX('X_ATTACKS'), myName());
      sfxPlay(bt.turn === 'me' && bt.crit ? SFX_PLAY : SFX_HIT);
    }
    if (t >= TURN_MS) {
      if (w.hp <= 0 || bt.me.hp <= 0) {
        bt.result = w.hp <= 0 ? 1 : 0;
        bt.phase = 'result';
        bt.t0 = now;
        pet.battleResult(bt.result, w);
        sfxPlay(bt.result ? SFX_WIN : SFX_BYE);
        bt.msg = bt.result ? TX('X_WIN') : TX('X_LOSE');
      } else {
        bt.turn = bt.turn === 'me' ? 'wild' : 'me';
        newTurn();
      }
    }
  } else if (bt.phase === 'result' && t > 4000) {
    finishResult();
    if (!bt) return;
  }

  // PV affichés : glissent vers la vraie valeur
  for (const k of ['me', 'wild']) {
    const real = k === 'me' ? bt.me.hp : w.hp;
    const d = real - bt.shownHp[k];
    bt.shownHp[k] = Math.abs(d) < 1 ? real : bt.shownHp[k] + d * Math.min(1, frameDt / 120);
  }

  // sprites
  const lunge = (who) => {
    if (bt.phase !== 'fight' || bt.turn !== who) return 0;
    const k = t - (HIT_AT - 160);
    return (k > 0 && k < 260) ? Math.round(18 * Math.sin(k / 260 * Math.PI)) : 0;
  };
  const actFor = (m, who) => {
    if (bt.phase === 'result') {
      const won = (bt.result === 1) === (who === 'me');
      return won ? (m.has(PMD_POSE) ? PMD_POSE : PMD_IDLE) : (m.has(PMD_SLEEP) ? PMD_SLEEP : PMD_IDLE);
    }
    if (timeLeft(bt.hurt[who]) && m.has(PMD_HURT)) return PMD_HURT;
    if (bt.phase === 'fight' && bt.turn === who && t > HIT_AT - 300 && t < HIT_AT + 300 && m.has(PMD_ATTACK)) return PMD_ATTACK;
    return PMD_IDLE;
  };
  const caught = bt.phase === 'egg' || (bt.phase === 'result' && bt.result === 1 && t > 1600);
  if (wildPmd.loaded && !caught) {
    const a = actFor(wildPmd, 'wild');
    const blink = timeLeft(bt.hurt.wild) && Math.floor(now / 80) % 2 === 0;
    if (!blink) drawPmdActM(wildPmd, a, WILD_POS.x - lunge('wild'), WILD_POS.y, now, true, false, 3);
  }
  if (pmd.loaded) {
    const a = actFor(pmd, 'me');
    const blink = timeLeft(bt.hurt.me) && Math.floor(now / 80) % 2 === 0;
    if (!blink) drawPmdActM(pmd, a, ME_POS.x + lunge('me'), ME_POS.y, now, true, false, 3);
  }

  // anneau de timing sur l'adversaire pendant mon tour
  if (bt.phase === 'fight' && bt.turn === 'me' && !bt.applied) {
    const cy = WILD_POS.y - 60;
    gfx.drawCircle(WILD_POS.x, cy, 30, UI_WHITE);
    gfx.drawCircle(WILD_POS.x, cy, 31, UI_WHITE);
    const r = Math.round(ringRadius(t));
    const col = r <= 36 ? UI_BAR_OK : UI_BAR_WARN;
    gfx.drawCircle(WILD_POS.x, cy, r, col);
    gfx.drawCircle(WILD_POS.x, cy, r + 1, col);
    if (bt.tapped && bt.crit) gfx.fillCircle(WILD_POS.x, cy, 8, UI_BAR_OK);
  }

  // dégâts qui montent
  bt.popups = bt.popups.filter((p) => now - p.t0 < 800);
  for (const p of bt.popups) {
    const k = now - p.t0;
    gfx.setTextColor(p.crit ? UI_BAR_WARN : UI_BAR_BAD);
    setSize(p.crit ? 4 : 3);
    setCur(p.x - idiv(textW(p.text, p.crit ? 4 : 3), 2), p.y - Math.floor(k / 20));
    printT(p.text);
  }

  // boîtes de PV
  drawHpBox(110, 60, (w.shiny ? '*' : '') + dexName(w.dex), w.lv, Math.round(bt.shownHp.wild), w.max);
  drawHpBox(214, 266, (pet.shiny ? '*' : '') + myName(), pet.level(), Math.round(bt.shownHp.me), bt.me.max);

  // message
  gfx.setTextColor(ink);
  setSize(2);
  setCur(centerX(bt.msg, 2), 356);
  printT(bt.msg);

  if (bt.phase === 'intro') {
    gfx.fillRoundRect(125, 384, 105, 44, 12, UI_BAR_OK);
    gfx.fillRoundRect(236, 384, 105, 44, 12, UI_TRACK);
    setSize(2);
    gfx.setTextColor(UI_WHITE);
    setCur(125 + idiv(105 - textW(T(S_BATTLE), 2), 2), 398);
    printT(T(S_BATTLE));
    gfx.setTextColor(UI_INK);
    setCur(236 + idiv(105 - textW(TX('X_FLEE'), 2), 2), 398);
    printT(TX('X_FLEE'));
  } else if (bt.phase === 'result' && bt.result === 1 && t > 1600) {
    const c = sprintf(TX('X_CAUGHT'), (w.shiny ? '*' : '') + dexName(w.dex));
    gfx.fillRoundRect(73, 150, 320, 70, 16, UI_BAR_WARN);
    gfx.drawRoundRect(73, 150, 320, 70, 16, UI_INK);
    gfx.setTextColor(UI_INK);
    setSize(2);
    setCur(centerX(c, 2), 178);
    printT(c);
  } else if (bt.phase === 'egg') {
    gfx.fillRoundRect(73, 150, 320, 240, 16, UI_WHITE);
    gfx.drawRoundRect(73, 150, 320, 240, 16, UI_INK);
    const c = sprintf(TX('X_CAUGHT'), (w.shiny ? '*' : '') + dexName(w.dex));
    gfx.setTextColor(UI_BAR_OK);
    setSize(2);
    setCur(centerX(c, 2), 172);
    printT(c);
    drawMap('SPR_EGG', 32, CX - 48, 196, 3, false);
    const q = TX('X_KEEP_EGG');
    gfx.setTextColor(UI_INK);
    setCur(centerX(q, 2), 302);
    printT(q);
    gfx.fillRoundRect(113, 330, 115, 50, 12, UI_BAR_OK);
    gfx.fillRoundRect(238, 330, 115, 50, 12, UI_BAR_BAD);
    gfx.setTextColor(UI_WHITE);
    setCur(113 + idiv(115 - textW(T(S_YES), 2), 2), 347);
    printT(T(S_YES));
    setCur(238 + idiv(115 - textW(T(S_NO), 2), 2), 347);
    printT(T(S_NO));
  }
}

// ============================================== intégration Android / page
// barre de raccourcis sous l'écran rond : les gestes du firmware restent
// valables, les boutons les rendent découvrables sur un téléphone
const NAV_LABELS = {
  FR: ['Pokédex', 'Fiche', 'Balade', 'Réglages'], ES: ['Pokédex', 'Ficha', 'Paseo', 'Ajustes'],
  EN: ['Pokédex', 'Profile', 'Walk', 'Settings'], DE: ['Pokédex', 'Profil', 'Laufen', 'Optionen'],
  IT: ['Pokédex', 'Scheda', 'Passeggio', 'Impost.'], PT: ['Pokédex', 'Ficha', 'Passeio', 'Ajustes'],
  JA: ['ずかん', 'プロフィール', 'さんぽ', 'せってい'], KO: ['도감', '프로필', '산책', '설정'],
};
function updateNav() {
  const l = NAV_LABELS[LANG_CODES[gLang]] || NAV_LABELS.EN;
  ['nav-dex', 'nav-card', 'nav-walk', 'nav-set'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.querySelector('span').textContent = l[i];
  });
}
function navAction(kind) {
  audio.ensure();
  if (pet.awaitingStarter() || pet.ceremony || gameOpen || sackOpen || kbOpen || battleOpen) return;
  confirmUntil = 0; feedMenuUntil = 0; choiceKind = 0;
  if (kind === 'walk') {
    if (galleryOpen) { galleryOpen = false; galleryPmd.unload(); }
    cardOpen = false; clockOpen = false;
    if (pedOpen) pedOpen = false; else openPed();
    return;
  }
  pedOpen = false;
  if (kind === 'dex') {
    clockOpen = false; cardOpen = false;
    if (galleryOpen) { galleryOpen = false; galleryPmd.unload(); }
    else { galleryOpen = true; galleryPage = 0; galleryDetail = 0; galleryDirty = true; }
  } else if (kind === 'card') {
    if (galleryOpen) { galleryOpen = false; galleryPmd.unload(); }
    clockOpen = false;
    if (cardOpen) cardOpen = false;
    else if (!pet.isEgg()) { cardOpen = true; cardPage = 0; }
  } else if (kind === 'set') {
    if (galleryOpen) { galleryOpen = false; galleryPmd.unload(); }
    cardOpen = false;
    if (clockOpen) clockOpen = false; else openClock();
  }
}

// bouton « retour » d'Android : ferme l'écran en cours ; sinon l'appli passe
// en arrière-plan (le jeu continue de vivre, comme la carte dans sa poche)
window.tpBack = function () {
  if (battleOpen) { if (bt.phase === 'intro') endBattle(-1); return true; }
  if (pedOpen) { pedOpen = false; return true; }
  if (kbOpen) { kbOpen = false; return true; }
  if (galleryOpen) {
    if (galleryDetail) { galleryDetail = 0; galleryPmd.unload(); galleryDirty = true; }
    else { galleryOpen = false; galleryPmd.unload(); }
    return true;
  }
  if (gameOpen) { if (!gameOverUntil) gameOpen = false; return true; }
  if (sackOpen) { if (!sackOverUntil) sackOpen = false; return true; }
  if (clockOpen) { clockOpen = false; return true; }
  if (cardOpen) { cardOpen = false; return true; }
  if (choiceKind) { choiceKind = 0; return true; }
  if (confirmUntil) { confirmUntil = 0; return true; }
  if (feedMenuUntil) { feedMenuUntil = 0; return true; }
  try { if (window.TPStore && window.TPStore.moveToBack) window.TPStore.moveToBack(); } catch (e) { /* rien */ }
  return false;
};

// mise en pause / reprise : l'équivalent de l'extinction et du RTC
let paused = false;
window.tpPause = function () {
  if (paused) return;
  paused = true;
  pet.lastSeenEpoch = rtcEpoch();
  pet.save();
};
window.tpResume = function () {
  if (!paused) return;
  paused = false;
  const mins = pet.syncClock(rtcEpoch());
  if (mins > 0) pet.lastTick = millis();  // le temps passé est déjà appliqué
  lastClock = millis();
  galleryDirty = true;
  if (TP_EXT) setTimeout(pollSteps, 600);  // le capteur se réenregistre dans onResume
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) window.tpPause(); else window.tpResume();
});
window.addEventListener('pagehide', () => window.tpPause());

function layout() {
  const nav = document.getElementById('nav');
  const navH = nav ? nav.offsetHeight + 24 : 0;
  const size = Math.floor(Math.min(window.innerWidth - 36, window.innerHeight - navH - 64, 720));
  canvas.style.width = canvas.style.height = `${Math.max(200, size)}px`;
  gfx.begin();
  galleryDirty = true;
}

function frame() {
  // garde-fou : si l'onglet a dormi sans prévenir (> 2 min sans image),
  // on traite le trou comme une absence plutôt que de jouer les ticks en direct
  const now = millis();
  if (lastFrame && now - lastFrame > 120000 && !paused) {
    paused = true;
    window.tpResume();
  }
  lastFrame = now;
  loop();
  requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.getElementById('nav-dex').addEventListener('click', () => navAction('dex'));
document.getElementById('nav-card').addEventListener('click', () => navAction('card'));
document.getElementById('nav-set').addEventListener('click', () => navAction('set'));
document.getElementById('nav-walk').addEventListener('click', () => navAction('walk'));
window.addEventListener('resize', layout);

layout();
setup();
requestAnimationFrame(frame);
window.TP = { pet, prefs, version: APP_VERSION };
