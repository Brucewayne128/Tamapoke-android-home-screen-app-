// Test différentiel : exécute une séquence d'actions pseudo-aléatoire sur le
// Pet C++ d'origine (pet.cpp + shim du dépôt) et imprime l'état après chaque
// pas. test/diff.js rejoue la même séquence sur le Pet JavaScript (core.js) ;
// les deux sorties doivent être identiques ligne à ligne.
#define private public
#include "pet.h"
#undef private
#include "dex.h"
#include <stdio.h>

static uint32_t act = 1;  // flux d'actions (xorshift32), indépendant du random() du jeu
static uint32_t nextAct() { act ^= act << 13; act ^= act >> 17; act ^= act << 5; return act; }

static void dump(Pet &p, int step, int op) {
  printf("%d op%d sp=%d prev=%d egg=%d tgt=%d eshy=%d taps=%d stpk=%d age=%u lv=%u "
         "f=%u j=%u e=%u h=%u poop=%u w=%u g=%u/%u/%u tr=%u/%u/%u bk=%d shy=%d "
         "mist=%u cool=%u sl=%d cer=%u lend=%u nt=%u gt=%u bond=%u bt=%u st=%u/%u cday=%u "
         "med=%u tm=%u nm=%u ms=%u ghi=%u shi=%u seen=%u reg=%u evdl=%u fdl=%u "
         "atk=%u def=%u spe=%u cev=%d cfw=%d crun=%d\n",
         step, op, p.speciesId, p.prevSpeciesId, p.isEgg(), p.eggTarget, p.eggShiny, p.eggTaps,
         p.starterPick, p.ageMinutes, p.level(), p.fullness, p.joy, p.energy, p.hygiene,
         p.poops, p.weight, p.geneAtk, p.geneDef, p.geneSpe, p.trAtk, p.trDef, p.trSpe,
         p.berryKnown, p.shiny, p.careMistakes, p.mistakeCooldown, p.sleeping, p.ceremony,
         p.lastEnd, p.neglectTicks, p.goodTicks, p.bond, p.bondToday, p.streak, p.bestStreak,
         p.lastCareDay, p.medals, p.totalMedals, p.newMedal, p.lastMilestone, p.gameHi,
         p.strHi, p.lastSeenEpoch, p.registeredCount(), p.evoDeclinedLv, p.farDeclinedAge,
         p.atkStat(), p.defStat(), p.speStat(), p.canEvolveNow(), p.canFarewellNow(),
         p.canRunawayNow());
}

int main(int argc, char **argv) {
  uint32_t seed = argc > 1 ? (uint32_t)atoi(argv[1]) : 7;
  int steps = argc > 2 ? atoi(argv[2]) : 4000;
  act = seed * 2654435761u + 1;
  randomSeed(seed);
  mockSetMillis(1000);
  Pet p;
  p.begin();
  uint32_t epoch = 1767225600UL + (seed % 97) * 3600;
  p.syncClock(epoch);
  dump(p, 0, -1);
  for (int i = 1; i <= steps; i++) {
    uint32_t r = nextAct() % 100;
    int op;
    if (r < 40) {                      // le temps passe (1..90 min)
      op = 0;
      uint32_t mins = 1 + nextAct() % 90;
      mockAdvanceMillis(mins * 60000UL);
      epoch += mins * 60;
      p.lastSeenEpoch = epoch;
      p.update(millis());
    } else if (r < 44) {               // longue absence (appli fermée)
      op = 1;
      uint32_t mins = 30 + nextAct() % 3000;
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
    else if (r < 90) { op = 14; if (nextAct() % 4 == 0) p.release(); }
    else if (r < 91) { op = 15; if (p.canRunawayNow()) p.startRunaway(); }
    else if (r < 95) {                 // fin de cérémonie éventuelle
      op = 16;
      mockAdvanceMillis(11000);
      p.update(millis());
    } else if (r < 97) {               // nouveau jour soigné (racha)
      op = 17;
      epoch += 86400;
      p.setClock(epoch);
      p.caress();
    } else {                           // saut de niveau (comme la commande LVL)
      op = 18;
      p.ageMinutes += 60 * (1 + nextAct() % 12);
      p.checkMedals();
    }
    // les minuteries (repas, cœur) expirent pour ne pas figer l'humeur
    mockAdvanceMillis(3000);
    dump(p, i, op);
  }
  return 0;
}
