package com.tamapoke.launcher

import android.content.SharedPreferences
import android.os.SystemClock
import kotlin.random.Random

/**
 * The TamaPoke pet, ported from the firmware (pet.cpp) with the same numbers:
 * 1 tick = 1 real minute, +1 level per hour, the same drains, actions, sleep
 * and evolution rules. Time spent away from the home screen is applied like
 * the board's "powered off" catch-up: needs drop with a floor of 15 and no
 * care mistakes, capped at two weeks.
 *
 * Left out for now: medals, streak, battle stats, minigames, farewell/runaway
 * ceremonies.
 */
class Pet(private val prefs: SharedPreferences, private val rnd: Random = Random.Default) {
    var fullness = 80; private set
    var joy = 80; private set
    var energy = 80; private set
    var hygiene = 100; private set
    var poops = 0; private set
    var weight = 0; private set
    var ageMinutes = 0L; private set
    var speciesId = -1; private set   // dex number 1..151, -1 = egg
    var shiny = false; private set
    var careMistakes = 0; private set
    var sleeping = false; private set
    var bond = 0; private set
    var berryKnown = false; private set
    var eggTaps = 0; private set
    /** first ever egg: the player picks Bulbasaur / Charmander / Squirtle */
    var awaitingStarter = false; private set

    private var eggTarget = 1
    private var eggShiny = false
    private var mistakeCooldown = 0
    private var lastTickMs = 0L      // wall clock of the last applied tick
    private var evoDeclinedLv = 0
    private val registered = HashSet<Int>()

    // animation timers (elapsedRealtime deadlines, not persisted)
    private var eatUntil = 0L
    private var heartUntil = 0L
    private var evolveUntil = 0L
    var prevSpeciesId = -1; private set

    val isEgg get() = speciesId < 0
    val level get() = (1 + ageMinutes / MINUTES_PER_LEVEL).coerceAtMost(999).toInt()
    val lowestStat get() = minOf(minOf(fullness, joy), minOf(energy, hygiene))
    val eating get() = SystemClock.elapsedRealtime() < eatUntil
    val showHeart get() = SystemClock.elapsedRealtime() < heartUntil
    val evolving get() = SystemClock.elapsedRealtime() < evolveUntil
    val evolveT get() = 1f - (evolveUntil - SystemClock.elapsedRealtime()).coerceAtLeast(0) / EVOLVE_ANIM_MS.toFloat()
    val registeredCount get() = registered.size
    val name get() = if (isEgg) "EGG" else Dex[speciesId].name

    fun lovesBerry(color: Int) = !isEgg && speciesId % 3 == color
    val favoriteBerry get() = if (isEgg) -1 else speciesId % 3

    val mood: Mood
        get() = when {
            sleeping -> Mood.SLEEPING
            eating -> Mood.EATING
            lowestStat < 25 -> Mood.SAD
            else -> Mood.HAPPY
        }

    init {
        if (!prefs.getBoolean("init", false)) {
            newEgg()
            lastTickMs = System.currentTimeMillis()
            save()
        } else {
            load()
        }
    }

    // ---- time ----

    /** Applies the minutes elapsed since the last tick. Call often (e.g. every second). */
    fun update(nowMs: Long = System.currentTimeMillis()): Boolean {
        if (lastTickMs == 0L || nowMs < lastTickMs) {  // first run, or the clock went back
            lastTickMs = nowMs
            return false
        }
        val mins = (nowMs - lastTickMs) / TICK_MS
        if (mins <= 0) return false
        lastTickMs += mins * TICK_MS
        if (awaitingStarter) return false  // time doesn't run until a starter is chosen
        if (mins >= 2) catchUp(minOf(mins, 14L * 24 * 60)) else tick()
        save()
        return true
    }

    private fun tick() {
        if (awaitingStarter) return  // the game doesn't start until a starter is chosen
        ageMinutes++
        if (isEgg) {
            if (ageMinutes >= 3) hatch()  // hatches on its own after 3 minutes
            return
        }
        if (sleeping) {  // rest: energy comes back, needs drop ~4x slower with floors
            energy = clamp(energy + 6)
            if (weight > 0 && ageMinutes % 3 == 0L) weight--
            if (ageMinutes % 2 == 0L) {
                fullness = dropTo(fullness, 1, 30)
                joy = dropTo(joy, 1, 35)
            }
            if (ageMinutes % 3 == 0L) hygiene = dropTo(hygiene, 1, 45)
            return
        }
        fullness = clamp(fullness - 2)
        energy = clamp(energy - 1)
        if (fullness > 40 && poops < 3 && rnd.nextInt(100) < 15) poops++
        hygiene = clamp(hygiene - 1 - 4 * poops)
        if (weight > 50) energy = clamp(energy - 1)  // overweight = sluggish
        if (weight > 0 && ageMinutes % 3 == 0L) weight--

        var dJoy = -1
        if (fullness < 30) dJoy -= 2
        if (hygiene < 30) dJoy -= 2
        joy = clamp(joy + dJoy)

        if (mistakeCooldown > 0) mistakeCooldown--
        if (lowestStat <= 10 && mistakeCooldown == 0) {
            careMistakes++
            mistakeCooldown = 60
            if (bond > 1) bond--
        }
    }

    /** Away from the home screen: merciful catch-up, same as the board's offline progression. */
    private fun catchUp(mins: Long) {
        for (i in 0 until mins) {
            ageMinutes++
            if (isEgg) {
                if (ageMinutes >= 3) hatch()
                continue
            }
            if (sleeping) {
                energy = clamp(energy + 6)
                if (ageMinutes % 2 == 0L) {
                    fullness = dropTo(fullness, 1, 30)
                    joy = dropTo(joy, 1, 35)
                }
                if (ageMinutes % 3 == 0L) hygiene = dropTo(hygiene, 1, 45)
                continue
            }
            fullness = dropTo(fullness, 2, 15)
            energy = dropTo(energy, 1, 15)
            hygiene = dropTo(hygiene, 1, 15)
            joy = dropTo(joy, 1, 15)
        }
        if (!isEgg && !sleeping) poops = minOf(3, poops + (mins / 240).toInt())
    }

    // ---- life cycle ----

    fun newEgg() {
        speciesId = -1
        prevSpeciesId = -1
        weight = 0
        eggTarget = pickEggSpecies()
        awaitingStarter = registered.isEmpty()
        eggShiny = rnd.nextInt(48) == 0
        eggTaps = 0
        fullness = 80; joy = 80; energy = 80; hygiene = 100
        poops = 0
        ageMinutes = 0
        careMistakes = 0
        mistakeCooldown = 0
        sleeping = false
        evoDeclinedLv = 0
        save()
    }

    fun chooseStarter(dex: Int) {
        eggTarget = dex
        awaitingStarter = false
        lastTickMs = System.currentTimeMillis()
        save()
    }

    private fun pickEggSpecies(): Int {
        if (registered.isEmpty()) return intArrayOf(1, 4, 7, 25, 133).random(rnd)
        var tier = 1
        val r = rnd.nextInt(100)
        val leg = if (registered.size >= 25) 3 else 0
        if (r < leg) tier = 3 else if (r < leg + 27) tier = 2
        // prefer species whose evolution line still has unregistered members
        for (pass in 0..1) {
            for (t in tier downTo 1) {
                val cand = (1..Dex.COUNT).filter {
                    Dex[it].rarity == t && (pass == 1 || lineHasUnregistered(it))
                }
                if (cand.isNotEmpty()) return cand.random(rnd)
            }
        }
        return 1
    }

    private fun lineHasUnregistered(base: Int): Boolean {
        var cur = base
        repeat(6) {
            if (cur !in 1..Dex.COUNT) return false
            if (cur !in registered) return true
            if (cur == Dex.EEVEE) return (134..136).any { it !in registered }
            cur = Dex[cur].evolvesTo
        }
        return false
    }

    private fun hatch() {
        speciesId = eggTarget
        shiny = eggShiny
        berryKnown = false
        bond = 0
        registered.add(speciesId)
        save()
    }

    fun eggTap() {
        if (!isEgg || awaitingStarter) return
        if (++eggTaps >= 3) hatch() else save()
    }

    /** Evolution waits for the player: each care mistake delays it a level, and all stats must be >= 40. */
    val canEvolveNow: Boolean
        get() {
            if (isEgg || sleeping) return false
            val d = Dex[speciesId]
            if (d.evolvesTo == 0) return false
            return level >= d.evolveLevel + careMistakes && lowestStat >= 40
        }
    val wantEvolveButton get() = canEvolveNow && level > evoDeclinedLv

    fun declineEvolve() {
        evoDeclinedLv = level
        save()
    }

    fun evolve() {
        if (!canEvolveNow) return
        prevSpeciesId = speciesId
        var next = Dex[speciesId].evolvesTo
        if (speciesId == Dex.EEVEE) {
            val opts = (134..136).filter { it !in registered }
            next = if (opts.isNotEmpty()) opts.random(rnd) else (134..136).random(rnd)
        }
        speciesId = next
        registered.add(next)
        evolveUntil = SystemClock.elapsedRealtime() + EVOLVE_ANIM_MS
        save()
    }

    /** Let it go and start a new egg. */
    fun release() {
        newEgg()
    }

    // ---- actions ----

    fun feedBerry(color: Int) {
        if (isEgg || sleeping) return
        if (lovesBerry(color)) {
            fullness = clamp(fullness + 35)
            joy = clamp(joy + 10)
            heart()
            berryKnown = true
            bond = clamp(bond + 2)
        } else {
            fullness = clamp(fullness + 25)
        }
        eatUntil = SystemClock.elapsedRealtime() + EAT_ANIM_MS
        save()
    }

    fun feedCandy() {
        if (isEgg || sleeping) return
        fullness = clamp(fullness + 10)
        joy = clamp(joy + 12)
        weight = clamp(weight + 12)
        eatUntil = SystemClock.elapsedRealtime() + EAT_ANIM_MS
        save()
    }

    fun play() {
        if (isEgg || sleeping) return
        joy = clamp(joy + 25)
        energy = clamp(energy - 10)
        fullness = clamp(fullness - 5)
        weight = maxOf(0, weight - 4)
        heart()
        bond = clamp(bond + 2)
        save()
    }

    fun clean() {
        poops = 0
        hygiene = 100
        bond = clamp(bond + 1)
        save()
    }

    fun toggleSleep() {
        if (isEgg) return
        sleeping = !sleeping
        save()
    }

    fun caress() {
        if (isEgg || sleeping) return
        joy = clamp(joy + 5)
        heart()
        bond = clamp(bond + 1)
        save()
    }

    /**
     * What it says when you talk to it. Like in the anime, a Pokémon only ever
     * says its own name (or a piece of it); the tone follows its mood.
     */
    fun reply(): String {
        if (isEgg) return "..."
        val name = spokenName(Dex[speciesId].name)
        val short = Regex("^[^aeiouy]*[aeiouy]+[^aeiouy]?", RegexOption.IGNORE_CASE)
            .find(name)?.value?.takeIf { it.length in 2 until name.length && it.all(Char::isLetter) } ?: name
        val options = when {
            sleeping -> listOf("$short... $short...", "$name...", "...$short...")
            lowestStat < 25 -> listOf("$name...", "$short... $short...", "$name?")
            showHeart || joy >= 70 -> listOf("$name!", "$short, $short!", "$short! $name!", "${name.uppercase()}!!", "$name ♪")
            else -> listOf("$name!", "$name?", "$short?", "$short, $name!")
        }
        return options.random(rnd)
    }

    private fun heart() {
        heartUntil = SystemClock.elapsedRealtime() + HEART_MS
    }

    // ---- persistence ----

    private fun save() {
        prefs.edit()
            .putBoolean("init", true)
            .putInt("full", fullness).putInt("joy", joy).putInt("ene", energy).putInt("hyg", hygiene)
            .putInt("poops", poops).putInt("weight", weight)
            .putLong("age", ageMinutes).putInt("species", speciesId).putBoolean("shiny", shiny)
            .putInt("mistakes", careMistakes).putBoolean("sleep", sleeping).putInt("bond", bond)
            .putBoolean("berryKnown", berryKnown).putInt("eggTaps", eggTaps)
            .putBoolean("starterPick", awaitingStarter).putInt("eggTarget", eggTarget)
            .putBoolean("eggShiny", eggShiny).putInt("mistakeCd", mistakeCooldown)
            .putLong("lastTick", lastTickMs).putInt("evoDeclined", evoDeclinedLv)
            .putString("dex", registered.joinToString(","))
            .apply()
    }

    private fun load() {
        fullness = prefs.getInt("full", 80)
        joy = prefs.getInt("joy", 80)
        energy = prefs.getInt("ene", 80)
        hygiene = prefs.getInt("hyg", 100)
        poops = prefs.getInt("poops", 0)
        weight = prefs.getInt("weight", 0)
        ageMinutes = prefs.getLong("age", 0)
        speciesId = prefs.getInt("species", -1)
        shiny = prefs.getBoolean("shiny", false)
        careMistakes = prefs.getInt("mistakes", 0)
        sleeping = prefs.getBoolean("sleep", false)
        bond = prefs.getInt("bond", 0)
        berryKnown = prefs.getBoolean("berryKnown", false)
        eggTaps = prefs.getInt("eggTaps", 0)
        awaitingStarter = prefs.getBoolean("starterPick", false)
        eggTarget = prefs.getInt("eggTarget", 1)
        eggShiny = prefs.getBoolean("eggShiny", false)
        mistakeCooldown = prefs.getInt("mistakeCd", 0)
        lastTickMs = prefs.getLong("lastTick", 0)
        evoDeclinedLv = prefs.getInt("evoDeclined", 0)
        registered.clear()
        prefs.getString("dex", "")!!.split(',').mapNotNullTo(registered) { it.toIntOrNull() }
    }

    enum class Mood { HAPPY, SAD, EATING, SLEEPING }

    companion object {
        const val TICK_MS = 60_000L
        const val MINUTES_PER_LEVEL = 60
        const val EAT_ANIM_MS = 2500L
        const val HEART_MS = 1500L
        const val EVOLVE_ANIM_MS = 5200L

        private fun clamp(v: Int) = v.coerceIn(0, 100)

        /** "NIDORAN H" -> "Nidoran", "MR. MIME" -> "Mr. Mime" */
        fun spokenName(display: String): String =
            display.removeSuffix(" H").removeSuffix(" M")
                .lowercase()
                .split(' ')
                .joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }

        /** drop by d but never below the floor fl (and leave values already under it alone) */
        private fun dropTo(v: Int, d: Int, fl: Int): Int {
            if (v <= fl) return v
            return if (v - fl > d) v - d else fl
        }
    }
}
