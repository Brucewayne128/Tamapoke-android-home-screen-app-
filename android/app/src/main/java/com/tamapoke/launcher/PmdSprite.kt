package com.tamapoke.launcher

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** Sprite actions in a TPK2 file (same ids as the firmware's PMD_* enum). */
object Act {
    const val IDLE = 0
    const val WALK_L = 1
    const val WALK_R = 2
    const val SLEEP = 3
    const val EAT = 4
    const val HURT = 5
    const val ATTACK = 6
    const val POSE = 7
    const val HOP = 8
    const val NOD = 9
    const val BREATH = 10
    const val SIT = 11
    const val COUNT = 12
}

class SpriteAction(
    val w: Int,
    val h: Int,
    val frames: List<ImageBitmap>,
    val ms: IntArray,
    /** row + 1 of the lowest opaque pixel in any frame: anchor by the feet, not the canvas */
    val base: Int,
) {
    private val total = ms.sum()

    fun frameAt(timeMs: Long): ImageBitmap {
        var t = (timeMs % total).toInt()
        for (i in ms.indices) {
            if (t < ms[i]) return frames[i]
            t -= ms[i]
        }
        return frames.last()
    }
}

/**
 * Multi-action PMD sprite in the TPK2 format written by tools/pack_pmd.py:
 *
 *   "TPK2", u8 nActs, u16 palCount, u16 pal[palCount] (RGB565)
 *   per action: u8 id, u8 w, u8 h, u8 nFrames, u16 ms[nFrames], u8 data[w*h*nFrames]
 *
 * Index 0xFF is transparent. Multi-byte values are little-endian.
 */
class PmdSprite private constructor(private val acts: Array<SpriteAction?>) {

    fun has(act: Int) = act in 0 until Act.COUNT && acts[act] != null

    /** The action, or the closest fallback the sprite actually has. */
    fun get(act: Int): SpriteAction {
        acts.getOrNull(act)?.let { return it }
        val fallback = when (act) {
            Act.WALK_L, Act.WALK_R -> intArrayOf(Act.WALK_R, Act.WALK_L, Act.IDLE)
            Act.SLEEP -> intArrayOf(Act.SIT, Act.IDLE)
            Act.HOP, Act.POSE -> intArrayOf(Act.HOP, Act.POSE, Act.NOD, Act.IDLE)
            else -> intArrayOf(Act.IDLE)
        }
        for (a in fallback) acts[a]?.let { return it }
        return acts.firstNotNullOf { it }
    }

    companion object {
        private val cache = HashMap<String, PmdSprite?>()

        /** Loads assets/mons/p[s]NNN.bin; falls back to the normal sprite if there is no shiny. */
        fun load(context: Context, dex: Int, shiny: Boolean): PmdSprite? {
            val key = "$dex/$shiny"
            synchronized(cache) { if (cache.containsKey(key)) return cache[key] }
            val names = buildList {
                if (shiny) add("mons/ps%03d.bin".format(dex))
                add("mons/p%03d.bin".format(dex))
            }
            var sprite: PmdSprite? = null
            for (n in names) {
                sprite = runCatching {
                    context.assets.open(n).use { parse(it.readBytes()) }
                }.getOrNull()
                if (sprite != null) break
            }
            synchronized(cache) {
                if (cache.size > 8) cache.clear()  // a handful of sprites at a time is plenty
                cache[key] = sprite
            }
            return sprite
        }

        fun parse(b: ByteArray): PmdSprite? {
            if (b.size < 7 || String(b, 0, 4, Charsets.US_ASCII) != "TPK2") return null
            fun u8(i: Int) = b[i].toInt() and 0xFF
            fun u16(i: Int) = u8(i) or (u8(i + 1) shl 8)

            val nActs = u8(4)
            val palCount = u16(5)
            if (palCount > 256 || 7 + palCount * 2 > b.size) return null
            val pal = IntArray(256)
            for (i in 0 until palCount) {
                val c = u16(7 + i * 2)
                val r = (c shr 11) and 0x1F
                val g = (c shr 5) and 0x3F
                val bl = c and 0x1F
                pal[i] = (0xFF shl 24) or
                    (((r shl 3) or (r shr 2)) shl 16) or
                    (((g shl 2) or (g shr 4)) shl 8) or
                    ((bl shl 3) or (bl shr 2))
            }

            val acts = arrayOfNulls<SpriteAction>(Act.COUNT)
            var p = 7 + palCount * 2
            repeat(nActs) {
                if (p + 4 > b.size) return@repeat
                val id = u8(p); val w = u8(p + 1); val h = u8(p + 2); val nf = u8(p + 3)
                p += 4
                if (id >= Act.COUNT || nf == 0 || nf > 24 || w == 0 || h == 0) return null
                if (p + nf * 2 + w * h * nf > b.size) return null  // truncated file
                val ms = IntArray(nf) { k -> u16(p + k * 2).let { if (it == 0) 100 else it } }
                p += nf * 2
                var base = 1
                val pixels = IntArray(w * h)
                val frames = ArrayList<ImageBitmap>(nf)
                for (f in 0 until nf) {
                    val off = p + f * w * h
                    for (i in 0 until w * h) {
                        val idx = u8(off + i)
                        pixels[i] = if (idx == 0xFF) 0 else pal[idx]
                        if (idx != 0xFF) base = maxOf(base, i / w + 1)
                    }
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    bmp.setPixels(pixels, 0, w, 0, 0, w, h)
                    frames.add(bmp.asImageBitmap())
                }
                p += w * h * nf
                acts[id] = SpriteAction(w, h, frames, ms, base)
            }
            if (acts.all { it == null }) return null
            return PmdSprite(acts)
        }
    }
}
