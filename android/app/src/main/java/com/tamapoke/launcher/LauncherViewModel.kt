package com.tamapoke.launcher

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class LauncherViewModel(app: Application) : AndroidViewModel(app) {
    val pet = Pet(app.getSharedPreferences("pet", Context.MODE_PRIVATE))

    /** Bumped after every pet change so Compose re-reads the pet's fields. */
    var rev by mutableIntStateOf(0)
        private set

    var apps by mutableStateOf<List<AppEntry>>(emptyList())
        private set

    /** Bumped when Home is pressed while the launcher is already showing. */
    var homePressed by mutableIntStateOf(0)
        private set

    var sprite by mutableStateOf<PmdSprite?>(null)
        private set
    var prevSprite by mutableStateOf<PmdSprite?>(null)
        private set
    private var spriteKey = ""

    init {
        reloadSprite()
    }

    fun act(block: Pet.() -> Unit) {
        pet.block()
        changed()
    }

    /** Called every second while the home screen is visible. */
    fun tick() {
        if (pet.update()) changed()
    }

    fun onHomePressed() {
        homePressed++
    }

    private fun changed() {
        rev++
        reloadSprite()
    }

    private fun reloadSprite() {
        val key = "${pet.speciesId}/${pet.shiny}"
        if (key == spriteKey) return
        spriteKey = key
        val ctx = getApplication<Application>()
        val dex = pet.speciesId
        val shiny = pet.shiny
        val prev = pet.prevSpeciesId
        viewModelScope.launch {
            val (s, p) = withContext(Dispatchers.IO) {
                val s = if (dex > 0) PmdSprite.load(ctx, dex, shiny) else null
                val p = if (prev > 0 && pet.evolving) PmdSprite.load(ctx, prev, shiny) else null
                s to p
            }
            sprite = s
            prevSprite = p
        }
    }

    fun refreshApps(iconPx: Int) {
        val ctx = getApplication<Application>()
        viewModelScope.launch {
            apps = withContext(Dispatchers.IO) { Apps.load(ctx, iconPx) }
        }
    }
}
