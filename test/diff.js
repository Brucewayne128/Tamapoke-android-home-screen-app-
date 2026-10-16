// Rejoue la séquence de diff_driver.cpp sur le Pet JavaScript (www/core.js).
// usage : node diff.js <seed> <steps>
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const www = path.join(__dirname, '..', 'www');
const seed = +(process.argv[2] || 7) >>> 0;
const steps = +(process.argv[3] || 4000);

let mockMillis = 0;
let gSeed = seed ? seed : 1;
function nextRand() { gSeed = (Math.imul(gSeed, 1664525) + 1013904223) >>> 0; return gSeed >>> 1; }
function rnd(a, b) {
  if (b !== undefined) { if (a >= b) return a; return a + rnd(b - a); }
  if (a <= 0) return 0;
  return nextRand() % a;
}

const mem = {};
const ctx = {
  console: { log() {} },
  performance: { now: () => 0 },
  navigator: { language: 'en' },
  localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(www, 'data.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(www, 'core.js'), 'utf8') +
  '\n;TP_EXT = false; this.__x = { Pet, prefs, DEX_TBL };', ctx);
ctx.random = rnd;               // même LCG que le shim du dépôt
ctx.millis = () => mockMillis;  // horloge factice
ctx.sfxPlay = () => {};
const { Pet } = ctx.__x;

let act = (Math.imul(seed, 2654435761) + 1) >>> 0;
function nextAct() {
  act = (act ^ (act << 13)) >>> 0;
  act = (act ^ (act >>> 17)) >>> 0;
  act = (act ^ (act << 5)) >>> 0;
  return act;
}

const b = (v) => (v ? 1 : 0);
const out = [];
function dump(p, step, op) {
  out.push(`${step} op${op} sp=${p.speciesId} prev=${p.prevSpeciesId} egg=${b(p.isEgg())} tgt=${p.eggTarget} eshy=${b(p.eggShiny)} taps=${p.eggTaps} stpk=${b(p.starterPick)} age=${p.ageMinutes} lv=${p.level()} ` +
    `f=${p.fullness} j=${p.joy} e=${p.energy} h=${p.hygiene} poop=${p.poops} w=${p.weight} g=${p.geneAtk}/${p.geneDef}/${p.geneSpe} tr=${p.trAtk}/${p.trDef}/${p.trSpe} bk=${b(p.berryKnown)} shy=${b(p.shiny)} ` +
    `mist=${p.careMistakes} cool=${p.mistakeCooldown} sl=${b(p.sleeping)} cer=${p.ceremony} lend=${p.lastEnd} nt=${p.neglectTicks} gt=${p.goodTicks} bond=${p.bond} bt=${p.bondToday} st=${p.streak}/${p.bestStreak} cday=${p.lastCareDay} ` +
    `med=${p.medals} tm=${p.totalMedals} nm=${p.newMedal} ms=${p.lastMilestone} ghi=${p.gameHi} shi=${p.strHi} seen=${p.lastSeenEpoch} reg=${p.registeredCount()} evdl=${p.evoDeclinedLv} fdl=${p.farDeclinedAge} ` +
    `atk=${p.atkStat()} def=${p.defStat()} spe=${p.speStat()} cev=${b(p.canEvolveNow())} cfw=${b(p.canFarewellNow())} crun=${b(p.canRunawayNow())}`);
}

mockMillis = 1000;
const p = new Pet();
p.begin();
let epoch = 1767225600 + (seed % 97) * 3600;
p.syncClock(epoch);
dump(p, 0, -1);
for (let i = 1; i <= steps; i++) {
  const r = nextAct() % 100;
  let op;
  if (r < 40) {
    op = 0;
    const mins = 1 + nextAct() % 90;
    mockMillis += mins * 60000;
    epoch += mins * 60;
    p.lastSeenEpoch = epoch;
    p.update(mockMillis);
  } else if (r < 44) {
    op = 1;
    const mins = 30 + nextAct() % 3000;
    p.lastSeenEpoch = epoch; p.save();
    epoch += mins * 60;
    p.syncClock(epoch);
  } else if (r < 52) { op = 2; p.feedBerry(nextAct() % 3); }
  else if (r < 55) { op = 3; p.feedCandy(); }
  else if (r < 58) { op = 4; p.play(); }
  else if (r < 61) { op = 5; p.playResult(nextAct() % 30); }
  else if (r < 63) { op = 6; p.trainStrength(nextAct() % 90); }
  else if (r < 67) { op = 7; p.toggleLight(); }
  else if (r < 71) { op = 8; p.clean(); }
  else if (r < 76) { op = 9; p.caress(); }
  else if (r < 82) { op = 10; p.eggTap(); }
  else if (r < 86) { op = 11; if (p.canEvolveNow()) p.evolve(); else p.declineEvolve(); }
  else if (r < 88) { op = 12; if (p.awaitingStarter()) p.chooseStarter(1 + 3 * (nextAct() % 3)); }
  else if (r < 89) { op = 13; if (p.canFarewellNow()) p.startFarewell(); else p.declineFarewell(); }
  else if (r < 90) { op = 14; if (nextAct() % 4 === 0) p.release(); }
  else if (r < 91) { op = 15; if (p.canRunawayNow()) p.startRunaway(); }
  else if (r < 95) { op = 16; mockMillis += 11000; p.update(mockMillis); }
  else if (r < 97) { op = 17; epoch += 86400; p.setClock(epoch); p.caress(); }
  else { op = 18; p.ageMinutes += 60 * (1 + nextAct() % 12); p.checkMedals(); }
  mockMillis += 3000;
  dump(p, i, op);
}
process.stdout.write(out.join('\n') + '\n');
