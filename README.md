# TamaPoke pour Android

Portage Android du tamagotchi [TamaPoke](https://github.com/socquique/TamaPoke)
(firmware v1.17 pour Waveshare ESP32-S3-Touch-AMOLED-1.75).

Le firmware C++ a été traduit en JavaScript fonction par fonction et tourne dans
une WebView : mêmes règles, mêmes chiffres (cf. « Game manual » du dépôt
d'origine), même écran rond 466×466, mêmes 8 langues, mêmes 151 + shinies avec
les sprites PMD animés.

## Ajouts de ce fork (version 1.17-android.2)

- **Soif** : 5ᵉ besoin, jauge EAU (−1/min éveillé, plus lent en dormant, plancher à 15 appli fermée), bouton verre pour boire (+35). Les baies donnent +5 d'eau, le mini-jeu et le sac −5. Sous 30 la joie baisse plus vite ; l'eau compte comme les autres besoins pour l'évolution (≥ 40), les négligences (≤ 10), la défense et la fugue.
- **Podomètre** : capteur de pas matériel d'Android (`TYPE_STEP_COUNTER`, il compte même appli fermée ; permission « Activité physique » sur Android 10+). Repli sur l'accéléromètre appli ouverte si le téléphone n'a pas de capteur. Marcher : +1 VIT tous les 1000 pas, −1 de poids tous les 300.
- **Rencontres sauvages** (à la Digimon) : une jauge de 400 à 1200 pas se remplit en marchant ; pleine, un POKEMON sauvage apparaît (3 en attente au maximum). Surtout des formes de base communes, parfois des rares, des formes évoluées une fois ton compagnon assez fort, très rarement un légendaire (Pokédex ≥ 25). Shiny à 1/64.
- **Combat** au tour par tour (le plus rapide commence) avec les stats ATQ/DEF/VIT de la fiche. À ton tour, un anneau se resserre sur l'adversaire : touche l'écran quand il entre dans la cible pour un coup parfait (×1,5). Combattre fatigue (énergie ≥ 20 requise).
- **Victoire** = capture : l'espèce entre dans le Pokédex (et le Pokédex shiny), +1 ATQ/DEF d'entraînement, et tu peux garder son œuf : il remplace le prochain œuf tiré au sort.

Avec `TP_EXT = false` (dans `core.js`), le jeu redevient exactement le firmware : c'est ce que vérifie le test différentiel.

## Ce qui change par rapport à la carte

| Carte ESP32 | Android |
|---|---|
| RTC PCF85063 | heure du téléphone (le réglage d'heure applique un décalage) |
| Carte microSD | sprites intégrés à l'APK (`assets/www/mons`) |
| NVS (flash) | SharedPreferences via le pont `TPStore` |
| Haut-parleur ES8311 | WebAudio (mêmes notes carrées) |
| Bouton PWR / atténuation AMOLED | gérés par Android |
| Gestes seuls | gestes + barre Pokédex / Fiche / Réglages + bouton retour |
| Langue par défaut : anglais | langue du téléphone si le jeu la connaît |

La progression hors ligne est celle du firmware : appli fermée, la créature
vieillit (2 semaines max), les barres descendent avec un plancher à 15, sans
négligence ni fugue en ton absence.

## Structure

```
www/            le jeu (index.html, core.js = pet.cpp/i18n/audio, game.js = TamaPoke.ino)
www/data.js     tables générées depuis le firmware (ne pas éditer)
android/        manifeste, ressources, code natif en smali (WebView + pont)
tools/          gen_data.py, make_icon.py, apktool.jar, uber-apk-signer.jar
test/           test différentiel C++ ↔ JavaScript de la logique du jeu
build.sh        construit et signe l'APK
```

## Reconstruire

Prérequis : Java 11+, Python 3 + Pillow, le dépôt TamaPoke et Arduino_GFX
(pour la police 5×7) clonés à côté.

```bash
git clone https://github.com/socquique/TamaPoke ../TamaPoke
git clone --depth 1 https://github.com/moononournation/Arduino_GFX ../Arduino_GFX
./build.sh ../TamaPoke ../Arduino_GFX      # -> dist/TamaPoke-<version>.apk
```

Pas besoin d'Android Studio ni du SDK : apktool embarque aapt2 et smali.
**Garde `tamapoke-release.jks`** : une mise à jour doit être signée avec la même
clé, sinon Android refuse de l'installer par-dessus (il faudrait désinstaller et
perdre la partie). Pour changer de version : `versionCode`/`versionName` dans
`android/AndroidManifest.xml`.

Tester dans un navigateur : `cd www && python3 -m http.server`, puis
http://localhost:8000. Console de debug (mêmes commandes que la console série) :
`tpDebug('HATCH')`, `tpDebug('LVL 16')`, `tpDebug('STATS')`, `tpDebug('WIPE')`…

## Vérifier la logique contre le firmware

```bash
g++ -std=c++17 -O1 -w -I ../TamaPoke/test/shim -I ../TamaPoke -o /tmp/diff test/diff_driver.cpp \
    ../TamaPoke/test/shim/shim.cpp ../TamaPoke/pet.cpp ../TamaPoke/i18n.cpp
for s in 1 2 3; do cmp <(/tmp/diff $s 5000) <(node test/diff.js $s 5000) && echo "seed $s OK"; done
```

Les deux implémentations jouent la même séquence d'actions aléatoires (même
générateur que le shim du dépôt) et doivent produire un état identique à chaque pas.

## Licences

Code d'origine : MIT (Quique Tortosa) ; ce portage reste sous MIT. Sprites :
PMD SpriteCollab, CC BY-NC 4.0. Pokémon © Nintendo / Game Freak / The Pokémon
Company. Projet de fan **non commercial** : ne pas vendre ni publier sur un store.
