package com.tamapoke.launcher.ui

import android.content.Intent
import android.provider.AlarmClock
import android.text.format.DateFormat
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tamapoke.launcher.AppEntry
import com.tamapoke.launcher.Apps
import com.tamapoke.launcher.Dex
import com.tamapoke.launcher.LauncherViewModel
import kotlinx.coroutines.delay
import java.util.Date

val PokeRed = Color(0xFFE7352C)
val Panel = Color(0xFF1C1C22)

@Composable
fun LauncherScreen(vm: LauncherViewModel) {
    MaterialTheme(colorScheme = darkColorScheme(primary = PokeRed, surface = Panel)) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Color(0xFF0E0E12))
                .systemBarsPadding()
                .padding(horizontal = 12.dp),
        ) {
            ClockHeader()
            PetSection(vm)
            Spacer(Modifier.height(10.dp))
            AppDrawer(vm, Modifier.weight(1f))
        }
    }
}

// ---------------------------------------------------------------- clock

@Composable
private fun ClockHeader() {
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000 - now % 1000)
        }
    }
    val pattern = if (DateFormat.is24HourFormat(context)) "HH:mm" else "h:mm"
    val time = DateFormat.format(pattern, now).toString()
    val date = DateFormat.format("EEEE, d MMMM", Date(now)).toString()

    Column(
        Modifier
            .fillMaxWidth()
            .clickable {
                runCatching {
                    context.startActivity(
                        Intent(AlarmClock.ACTION_SHOW_ALARMS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            }
            .padding(top = 12.dp, bottom = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(time, fontSize = 64.sp, fontWeight = FontWeight.Light, color = Color.White)
        Text(date.replaceFirstChar { it.uppercase() }, fontSize = 16.sp, color = Color(0xFFB0B0B8))
    }
}

// ---------------------------------------------------------------- pet

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PetSection(vm: LauncherViewModel) {
    @Suppress("UNUSED_VARIABLE") val rev = vm.rev  // re-read the pet when it changes
    val pet = vm.pet
    var confirmRelease by remember { mutableStateOf(false) }
    var askEvolve by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxWidth()
            .background(Panel, RoundedCornerShape(20.dp))
            .padding(10.dp),
    ) {
        PetWindow(
            vm = vm,
            onTap = {
                vm.act {
                    when {
                        isEgg -> eggTap()
                        else -> caress()
                    }
                }
            },
            onPickStarter = { dex -> vm.act { chooseStarter(dex) } },
            modifier = Modifier.fillMaxWidth().height(200.dp),
        )
        Spacer(Modifier.height(8.dp))

        // name + level (long-press the name to release)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val accent = if (pet.isEgg) Color.White else Color(Dex[pet.speciesId].accent)
            Text(
                (if (pet.shiny && !pet.isEgg) "★ " else "") + pet.name,
                color = accent,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                fontSize = 16.sp,
                modifier = Modifier.combinedClickable(
                    onClick = {},
                    onLongClick = { if (!pet.isEgg) confirmRelease = true },
                ),
            )
            Spacer(Modifier.weight(1f))
            if (!pet.isEgg) {
                Text(
                    "Lv ${pet.level}",
                    color = Color.White,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 14.sp,
                )
            } else if (!pet.awaitingStarter) {
                Text("tap to hatch ${pet.eggTaps}/3", color = Color(0xFFB0B0B8), fontSize = 13.sp)
            }
        }

        if (!pet.isEgg) {
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatBar("FOOD", pet.fullness, Color(0xFFF2A93B), Modifier.weight(1f))
                StatBar("JOY", pet.joy, Color(0xFFF06292), Modifier.weight(1f))
                StatBar("ENE", pet.energy, Color(0xFF64B5F6), Modifier.weight(1f))
                StatBar("HYG", pet.hygiene, Color(0xFF81C784), Modifier.weight(1f))
            }
            Spacer(Modifier.height(8.dp))
            Controls(vm, onEvolve = { askEvolve = true })
        }
    }

    if (confirmRelease) {
        AlertDialog(
            onDismissRequest = { confirmRelease = false },
            title = { Text("Release ${pet.name}?") },
            text = { Text("It goes back to the wild and a new egg appears. This can't be undone.") },
            confirmButton = {
                TextButton(onClick = { vm.act { release() }; confirmRelease = false }) { Text("Release") }
            },
            dismissButton = { TextButton(onClick = { confirmRelease = false }) { Text("Keep") } },
        )
    }
    if (askEvolve) {
        AlertDialog(
            onDismissRequest = { askEvolve = false },
            title = { Text("${pet.name} is evolving!") },
            text = { Text("Let it evolve now?") },
            confirmButton = {
                TextButton(onClick = { vm.act { evolve() }; askEvolve = false }) { Text("Evolve") }
            },
            dismissButton = {
                TextButton(onClick = { vm.act { declineEvolve() }; askEvolve = false }) { Text("Not yet") }
            },
        )
    }
}

@Composable
private fun StatBar(label: String, value: Int, color: Color, modifier: Modifier) {
    Column(modifier) {
        Text(label, fontSize = 10.sp, color = Color(0xFFB0B0B8), fontFamily = FontFamily.Monospace)
        LinearProgressIndicator(
            progress = { value / 100f },
            color = if (value <= 25) PokeRed else color,
            trackColor = Color(0xFF33333B),
            modifier = Modifier.fillMaxWidth().height(6.dp),
            drawStopIndicator = {},
        )
    }
}

private val BERRIES = listOf("Red berry" to Color(0xFFE05050), "Blue berry" to Color(0xFF5080E0), "Green berry" to Color(0xFF50B060))

@Composable
private fun Controls(vm: LauncherViewModel, onEvolve: () -> Unit) {
    val pet = vm.pet
    var feedMenu by remember { mutableStateOf(false) }
    val awake = !pet.sleeping

    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.weight(1f)) {
            ActionButton("Feed", enabled = awake, modifier = Modifier.fillMaxWidth()) { feedMenu = true }
            DropdownMenu(expanded = feedMenu, onDismissRequest = { feedMenu = false }) {
                BERRIES.forEachIndexed { i, (label, color) ->
                    val fav = pet.berryKnown && pet.favoriteBerry == i
                    DropdownMenuItem(
                        text = { Text(if (fav) "$label  ♥" else label, color = color) },
                        onClick = { vm.act { feedBerry(i) }; feedMenu = false },
                    )
                }
                DropdownMenuItem(
                    text = { Text("Candy") },
                    onClick = { vm.act { feedCandy() }; feedMenu = false },
                )
            }
        }
        ActionButton("Play", enabled = awake, modifier = Modifier.weight(1f)) { vm.act { play() } }
        ActionButton("Bath", enabled = true, modifier = Modifier.weight(1f)) { vm.act { clean() } }
        ActionButton(if (pet.sleeping) "Wake" else "Sleep", enabled = true, modifier = Modifier.weight(1f)) {
            vm.act { toggleSleep() }
        }
    }
    if (pet.wantEvolveButton) {
        Spacer(Modifier.height(6.dp))
        Button(
            onClick = onEvolve,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFCB05), contentColor = Color.Black),
        ) { Text("✨ Ready to evolve!") }
    }
}

@Composable
private fun ActionButton(label: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp),
        shape = RoundedCornerShape(12.dp),
    ) { Text(label, fontSize = 13.sp, maxLines = 1) }
}

// ---------------------------------------------------------------- apps

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AppDrawer(vm: LauncherViewModel, modifier: Modifier) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    var query by remember { mutableStateOf("") }
    val grid = rememberLazyGridState()

    LaunchedEffect(vm.homePressed) {
        query = ""
        focus.clearFocus()
        grid.scrollToItem(0)
    }
    BackHandler(enabled = query.isNotEmpty()) { query = ""; focus.clearFocus() }

    val shown: List<AppEntry> = remember(vm.apps, query) {
        if (query.isBlank()) vm.apps else vm.apps.filter { it.label.contains(query.trim(), ignoreCase = true) }
    }

    Column(modifier) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search apps") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(
                onGo = { shown.firstOrNull()?.let { Apps.launch(context, it) }; query = ""; focus.clearFocus() },
            ),
            shape = RoundedCornerShape(16.dp),
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = Color(0xFF33333B),
                focusedBorderColor = PokeRed,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(6.dp))
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            state = grid,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 8.dp),
        ) {
            items(shown, key = { it.component.flattenToString() }) { app ->
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .padding(4.dp)
                        .combinedClickable(
                            onClick = { Apps.launch(context, app); query = ""; focus.clearFocus() },
                            onLongClick = { Apps.openInfo(context, app) },
                        )
                        .padding(vertical = 6.dp),
                ) {
                    Image(
                        bitmap = app.icon,
                        contentDescription = app.label,
                        filterQuality = FilterQuality.Medium,
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        app.label,
                        fontSize = 11.sp,
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.width(72.dp),
                    )
                }
            }
        }
    }
}
