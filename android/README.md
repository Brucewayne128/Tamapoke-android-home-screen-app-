# TamaPoke Home (Android launcher)

An Android home-screen app with your TamaPoke living on it. It replaces the
default launcher and stacks four things:

1. **A small top row** in place of the phone's status bar: time and date on the
   left (tap for alarms), battery on the right. Swipe down from the top for
   notifications.
2. **The pet window**: your Pokémon walks around a little scene that follows
   the time of day. It uses the same animated sprites as the board
   (`tools/sdcard/mons`) and the same care rules as the firmware (`pet.cpp`).
   - **Feed** (three berries, one is its secret favourite, or candy), **Play**,
     **Bath**, **Sleep/Wake**. Tap the pet to pet it, tap the egg to hatch it.
   - +1 level per real hour; when it is ready to evolve a button appears.
   - Long-press its name to release it and get a new egg.
3. **Talk to your Pokémon**: type a message and it answers in a speech bubble.
   Like in the anime it only ever says its own name.
4. **Your apps** in a grid. Tap to open, long-press for app info.
   Pressing Home brings you back here.

Time spent in other apps is applied when you come back, the same way the board
catches up after being off: stats drop but stop at 15, and no care mistakes
are counted while you are away.

Not ported yet: medals, streak, battle stats, minigames, farewell/runaway.

## Get the APK

Every push builds it on GitHub Actions: open the **CI** run → **Artifacts** →
`tamapoke-launcher-apk`. Install `app-release.apk` (enable "install unknown
apps" for your browser or file manager).

Then press Home and pick **TamaPoke Home**, or set it in
*Settings → Apps → Default apps → Home app*. To go back, choose your old
launcher in the same place.

## Build it yourself

Needs JDK 17 and the Android SDK (Android Studio sets both up):

```bash
cd android
./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
```

The sprites are copied from `../tools/sdcard/mons` at build time. The species
table `Dex.kt` is generated from `tools/dex_data.py`; after changing the dex
data run `python3 tools/gen_android_dex.py`.

## Code map

| File | What it does |
|---|---|
| `MainActivity.kt` | the HOME activity, pet clock, app-list refresh |
| `Pet.kt` | pet rules (port of `pet.cpp`) and saving |
| `PmdSprite.kt` | reads the TPK2 sprite files |
| `Apps.kt` | lists and launches installed apps |
| `ui/LauncherScreen.kt` | clock, stats, buttons, app grid |
| `ui/PetWindow.kt` | the scene, walking, egg, evolution, starter choice |

Sprites: PMD SpriteCollab, CC BY-NC (see `../CREDITS.md`).
