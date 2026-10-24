package com.tamapoke.launcher.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tamapoke.launcher.Act
import com.tamapoke.launcher.Dex
import com.tamapoke.launcher.LauncherViewModel
import com.tamapoke.launcher.Pet
import com.tamapoke.launcher.PmdSprite
import com.tamapoke.launcher.SpriteAction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.os.SystemClock
import java.util.Calendar
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sin
import kotlin.random.Random

/** Where the pet is wandering inside the window (fractions of the width). */
private class Motion {
    var x = 0.5f
    var target = 0.5f
    var idleUntil = 0L
    var facingRight = true
    var moving = false
}

@Composable
fun PetWindow(
    vm: LauncherViewModel,
    onTap: () -> Unit,
    onPickStarter: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    @Suppress("UNUSED_VARIABLE") val rev = vm.rev
    val pet = vm.pet
    val shape = RoundedCornerShape(16.dp)
    val tap by rememberUpdatedState(onTap)
    val motion = remember { Motion() }
    val text = rememberTextMeasurer()

    // frame clock: drives the sprite animation and the wandering
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        var last = 0L
        while (true) {
            withFrameMillis { t ->
                val dt = if (last == 0L) 0L else (t - last).coerceAtMost(100)
                last = t
                now = t
                wander(motion, pet, t, dt)
            }
        }
    }

    Box(
        modifier
            .clip(shape)
            .border(3.dp, Color(0xFF34343C), shape),
    ) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) { detectTapGestures { tap() } },
        ) {
            val t = now
            drawSky()
            val groundY = size.height * 0.86f
            drawGround(groundY, if (pet.isEgg) 0xFF6A9A50 else Dex[pet.speciesId].accent)

            repeat(pet.poops.coerceAtMost(POOP_X.size)) { i -> drawPoop(size.width * POOP_X[i], groundY) }
            if (pet.sleeping) drawRect(Color(0xFF050818).copy(alpha = 0.5f))  // lights off
            var bubbleX = size.width / 2
            var bubbleY = groundY - 70 * density
            if (pet.isEgg) {
                if (!pet.awaitingStarter) drawEgg(t, groundY, pet.eggTaps)
            } else {
                bubbleX = size.width * motion.x
                bubbleY = drawPet(vm, motion, t, groundY, text)
            }
            val said = vm.speech
            if (said != null && SystemClock.elapsedRealtime() < vm.speechUntil) {
                drawBubble(text, said, bubbleX, bubbleY)
            }
        }

        if (pet.awaitingStarter) StarterPicker(onPickStarter)
    }
}

private val POOP_X = floatArrayOf(0.12f, 0.86f, 0.74f)

private fun wander(m: Motion, pet: Pet, t: Long, dt: Long) {
    val canWalk = !pet.isEgg && !pet.sleeping && !pet.eating && !pet.evolving && !pet.showHeart
    if (!canWalk) {
        m.moving = false
        return
    }
    if (!m.moving) {
        if (t < m.idleUntil) return
        m.target = Random.nextFloat() * 0.7f + 0.15f
        if (abs(m.target - m.x) < 0.08f) {
            m.idleUntil = t + 1500
            return
        }
        m.moving = true
        m.facingRight = m.target > m.x
    }
    // tired or sad pets shuffle; a well-fed happy one trots
    val speed = if (pet.energy < 25 || pet.lowestStat < 25) 0.035f else 0.07f
    val step = speed * dt / 1000f
    if (abs(m.target - m.x) <= step) {
        m.x = m.target
        m.moving = false
        m.idleUntil = t + 2000 + Random.nextLong(4000)
    } else {
        m.x += if (m.target > m.x) step else -step
    }
}

private fun DrawScope.drawPet(
    vm: LauncherViewModel,
    m: Motion,
    t: Long,
    groundY: Float,
    text: androidx.compose.ui.text.TextMeasurer,
): Float {
    val pet = vm.pet
    val cx = size.width * m.x
    val sprite = vm.sprite
    if (sprite == null) {
        // sprite not loaded (yet): never leave the window empty
        val px = 4f * density
        drawPixels(POKEBALL, cx - 6 * px, groundY - 12 * px, px)
        return groundY - 12 * px
    }
    val idle = sprite.get(Act.IDLE)
    val scale = floor(size.height * 0.5f / idle.h).coerceIn(1f, 6f)

    if (pet.evolving) {
        // flicker between the old and the new silhouette, faster and faster
        val e = pet.evolveT
        val prev = vm.prevSprite
        val period = (400 * (1f - e) + 60).toLong()
        val showNew = prev == null || e > 0.92f || (t / period) % 2 == 0L
        val s = if (showNew) sprite else prev!!
        val act = s.get(Act.IDLE)
        drawRect(Color.White.copy(alpha = 0.25f + 0.5f * e * e))
        drawAction(act, t, cx, groundY, scale, ColorFilter.tint(Color.White, BlendMode.SrcIn).takeIf { e < 0.92f })
        return groundY - act.base * scale
    }

    val act = when {
        pet.sleeping -> sprite.get(Act.SLEEP)
        pet.eating -> sprite.get(Act.EAT)
        pet.showHeart -> sprite.get(Act.HOP)
        m.moving -> sprite.get(if (m.facingRight) Act.WALK_R else Act.WALK_L)
        pet.mood == Pet.Mood.SAD && sprite.has(Act.SIT) -> sprite.get(Act.SIT)
        else -> idle
    }
    drawAction(act, t, cx, groundY, scale, null)

    val headY = groundY - act.base * scale
    if (pet.showHeart) drawPixels(HEART, cx - 3.5f * 3 * density, headY - 12 * 3 * density, 3 * density)
    if (pet.sleeping) {
        val bob = sin(t / 500.0).toFloat() * 4 * density
        drawText(
            text, "z Z",
            topLeft = Offset(cx + 10 * density, headY - 28 * density + bob),
            style = TextStyle(color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace),
        )
    } else if (pet.mood == Pet.Mood.SAD && !pet.eating) {
        drawText(
            text, "!",
            topLeft = Offset(cx + 14 * density, headY - 24 * density),
            style = TextStyle(color = Color(0xFFFFCB05), fontSize = 20.sp, fontWeight = FontWeight.Bold),
        )
    }
    return headY
}

/** A comic speech bubble whose tail points down at (x, bottomY), kept inside the window. */
private fun DrawScope.drawBubble(
    text: androidx.compose.ui.text.TextMeasurer,
    said: String,
    x: Float,
    bottomY: Float,
) {
    val layout = text.measure(
        said,
        style = TextStyle(color = Color.Black, fontSize = 15.sp, fontWeight = FontWeight.Bold),
        constraints = Constraints(maxWidth = (size.width * 0.8f).toInt()),
    )
    val pad = 8 * density
    val tail = 8 * density
    val w = layout.size.width + 2 * pad
    val h = layout.size.height + 2 * pad
    val left = (x - w / 2).coerceIn(4 * density, size.width - w - 4 * density)
    val top = (bottomY - tail - h).coerceAtLeast(4 * density)
    val tipX = x.coerceIn(left + 2 * tail, left + w - 2 * tail)
    val tip = Path().apply {
        moveTo(tipX - tail, top + h - 1)
        lineTo(tipX + tail, top + h - 1)
        lineTo(tipX, top + h + tail)
        close()
    }
    val outline = Color(0xFF1A1A1A)
    drawRoundRect(outline, Offset(left - 2 * density, top - 2 * density),
        Size(w + 4 * density, h + 4 * density), CornerRadius(14 * density))
    drawPath(tip, outline, style = Stroke(width = 4 * density))
    drawRoundRect(Color.White, Offset(left, top), Size(w, h), CornerRadius(12 * density))
    drawPath(tip, Color.White)
    drawText(layout, topLeft = Offset(left + pad, top + pad))
}

private fun DrawScope.drawAction(
    act: SpriteAction,
    t: Long,
    cx: Float,
    groundY: Float,
    scale: Float,
    filter: ColorFilter?,
) {
    val frame = act.frameAt(t)
    val w = (act.w * scale).toInt()
    val h = (act.h * scale).toInt()
    val x = (cx - w / 2f).toInt()
    val y = (groundY - act.base * scale).toInt()
    drawImage(
        image = frame,
        srcOffset = IntOffset.Zero,
        srcSize = IntSize(act.w, act.h),
        dstOffset = IntOffset(x, y),
        dstSize = IntSize(w, h),
        colorFilter = filter,
        filterQuality = FilterQuality.None,  // keep the pixels crisp
    )
}

// ---------------------------------------------------------------- scenery

private fun DrawScope.drawSky() {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val (top, bottom) = when (hour) {
        in 7..17 -> Color(0xFF6EC6F5) to Color(0xFFCDEEFF)
        in 18..20, in 5..6 -> Color(0xFF4A3A78) to Color(0xFFF2A46B)
        else -> Color(0xFF070B24) to Color(0xFF1F2A5A)
    }
    drawRect(Brush.verticalGradient(listOf(top, bottom)))
    if (hour >= 21 || hour <= 4) {
        val r = Random(7)
        repeat(24) {
            drawCircle(Color.White.copy(alpha = 0.7f), radius = 1.5f * density,
                center = Offset(r.nextFloat() * size.width, r.nextFloat() * size.height * 0.6f))
        }
    }
}

private fun DrawScope.drawGround(groundY: Float, accent: Long) {
    val grass = lerp(Color(0xFF5DA548), Color(accent), 0.25f)
    drawRect(grass, topLeft = Offset(0f, groundY - 4 * density), size = Size(size.width, size.height - groundY + 4 * density))
    drawRect(grass.copy(alpha = 1f).darker(), topLeft = Offset(0f, groundY - 4 * density), size = Size(size.width, 3 * density))
}

private fun lerp(a: Color, b: Color, f: Float) = Color(
    red = a.red + (b.red - a.red) * f,
    green = a.green + (b.green - a.green) * f,
    blue = a.blue + (b.blue - a.blue) * f,
)

private fun Color.darker() = Color(red * 0.75f, green * 0.75f, blue * 0.75f)

// ---------------------------------------------------------------- pixel art

/** Draws a pixel pattern: each char is a pixel, '.' is transparent. */
private fun DrawScope.drawPixels(rows: Array<String>, left: Float, top: Float, px: Float) {
    for ((r, row) in rows.withIndex()) {
        for ((c, ch) in row.withIndex()) {
            val color = PIXEL_COLORS[ch] ?: continue
            drawRect(color, topLeft = Offset(left + c * px, top + r * px), size = Size(px + 0.5f, px + 0.5f))
        }
    }
}

private val PIXEL_COLORS = mapOf(
    'k' to Color(0xFF1A1A1A),
    'r' to Color(0xFFE7352C),
    'p' to Color(0xFFFF8A9A),
    'w' to Color(0xFFFFFFFF),
    'c' to Color(0xFFF4EBD6),
    's' to Color(0xFFD8C9A6),
    'g' to Color(0xFF5DBB63),
    'b' to Color(0xFF7A5230),
    'd' to Color(0xFF4E321C),
)

private val HEART = arrayOf(
    ".kk.kk.",
    "krrkrrk",
    "krprrrk",
    "krrrrrk",
    ".krrrk.",
    "..krk..",
    "...k...",
)

private val POKEBALL = arrayOf(
    "....kkkk....",
    "..kkrrrrkk..",
    ".krrrrrrrrk.",
    ".krrrrrrrrk.",
    "krrrrkkrrrrk",
    "kkkkkwwkkkkk",
    "kwwwwkkwwwwk",
    ".kwwwwwwwwk.",
    ".kwwwwwwwwk.",
    "..kkwwwwkk..",
    "....kkkk....",
)

private val POOP = arrayOf(
    "...d....",
    "..dbd...",
    ".dbbbd..",
    ".dbbbbd.",
    "dbbbbbbd",
    "dddddddd",
)

private val EGG = arrayOf(
    "....kkkk....",
    "...kcccck...",
    "..kccggcck..",
    ".kccggggcck.",
    ".kcccggcccck",
    "kccccccccsck",
    "kcgggcccccsk",
    "kggggccggcsk",
    "kcgggcggggsk",
    "kccccccggcsk",
    ".kcccccccsk.",
    ".kscccccssk.",
    "..kssssssk..",
    "...kkkkkk...",
)

private fun DrawScope.drawPoop(x: Float, groundY: Float) {
    val px = 2.5f * density
    drawPixels(POOP, x - 4 * px, groundY - 6 * px + 2 * density, px)
}

private fun DrawScope.drawEgg(t: Long, groundY: Float, cracks: Int) {
    val px = 5f * density
    // wobbles more the closer it is to hatching
    val wobble = sin(t / (260.0 - cracks * 60)).toFloat() * (1 + cracks) * 1.5f * density
    val left = size.width / 2 - 6 * px + wobble
    val top = groundY - 14 * px
    drawPixels(EGG, left, top, px)
    val k = Color(0xFF1A1A1A)
    if (cracks >= 1) {
        drawLine(k, Offset(left + 3 * px, top + 5 * px), Offset(left + 5 * px, top + 6.5f * px), 2 * density)
        drawLine(k, Offset(left + 5 * px, top + 6.5f * px), Offset(left + 6.5f * px, top + 5 * px), 2 * density)
    }
    if (cracks >= 2) {
        drawLine(k, Offset(left + 6.5f * px, top + 5 * px), Offset(left + 8 * px, top + 7 * px), 2 * density)
        drawLine(k, Offset(left + 8 * px, top + 7 * px), Offset(left + 9.5f * px, top + 5.5f * px), 2 * density)
    }
}

// ---------------------------------------------------------------- first run

@Composable
private fun StarterPicker(onPick: (Int) -> Unit) {
    val context = LocalContext.current
    val sprites by produceState<List<PmdSprite?>>(emptyList()) {
        value = withContext(Dispatchers.IO) { Dex.STARTERS.map { PmdSprite.load(context, it, false) } }
    }
    var now by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) { while (true) withFrameMillis { now = it } }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.55f))
            .padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Choose your partner!", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Row(
            Modifier.fillMaxWidth().weight(1f),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Dex.STARTERS.forEachIndexed { i, dex ->
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { onPick(dex) }
                        .padding(6.dp),
                ) {
                    val sprite = sprites.getOrNull(i)
                    Canvas(Modifier.size(84.dp)) {
                        val t = now
                        val idle = sprite?.get(Act.IDLE) ?: return@Canvas
                        val scale = floor(size.height * 0.8f / idle.h).coerceIn(1f, 4f)
                        drawAction(idle, t, size.width / 2, size.height * 0.95f, scale, null)
                    }
                    Text(Dex[dex].name, color = Color(Dex[dex].accent).brighter(), fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold,
                        modifier = Modifier.height(16.dp))
                }
            }
        }
    }
}

private fun Color.brighter() = Color(
    (red * 1.3f).coerceAtMost(1f), (green * 1.3f).coerceAtMost(1f), (blue * 1.3f).coerceAtMost(1f),
)
