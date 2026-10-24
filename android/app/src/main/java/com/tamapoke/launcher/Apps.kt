package com.tamapoke.launcher

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Process
import android.os.UserHandle
import android.provider.Settings
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap

class AppEntry(
    val label: String,
    val component: ComponentName,
    val user: UserHandle,
    val icon: ImageBitmap,
) {
    val key = component.flattenToString() + "#" + user.hashCode()
}

object Apps {
    /** Every installed app that has a launcher icon (main profile only; see [load] for all). */
    fun getInstalledApps(context: Context): List<ResolveInfo> {
        val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        return context.packageManager.queryIntentActivities(mainIntent, PackageManager.MATCH_ALL)
    }

    /**
     * Loads every launchable app, sorted by name. Uses LauncherApps, the API home
     * screens are meant to use: it covers every profile on the phone (work profile,
     * Samsung Secure Folder / Dual Messenger...), which a plain package query misses.
     * Slow: call off the main thread.
     */
    fun load(context: Context, iconPx: Int): List<AppEntry> {
        val out = LinkedHashMap<String, AppEntry>()
        val la = context.getSystemService(LauncherApps::class.java)
        runCatching {
            for (user in la.profiles) {
                for (info in la.getActivityList(null, user)) {
                    if (info.componentName.packageName == context.packageName) continue
                    val e = AppEntry(
                        label = info.label.toString(),
                        component = info.componentName,
                        user = user,
                        icon = info.getBadgedIcon(0).toBitmap(iconPx, iconPx).asImageBitmap(),
                    )
                    out[e.key] = e
                }
            }
        }
        // Belt and braces: anything the package query sees that LauncherApps didn't.
        val pm = context.packageManager
        val me = Process.myUserHandle()
        runCatching {
            for (ri in getInstalledApps(context)) {
                val info = ri.activityInfo
                if (info.packageName == context.packageName) continue
                val cn = ComponentName(info.packageName, info.name)
                val key = cn.flattenToString() + "#" + me.hashCode()
                if (key in out) continue
                out[key] = AppEntry(
                    label = ri.loadLabel(pm).toString(),
                    component = cn,
                    user = me,
                    icon = ri.loadIcon(pm).toBitmap(iconPx, iconPx).asImageBitmap(),
                )
            }
        }
        return out.values.sortedBy { it.label.lowercase() }
    }

    fun launch(context: Context, app: AppEntry) {
        val la = context.getSystemService(LauncherApps::class.java)
        val ok = runCatching { la.startMainActivity(app.component, app.user, null, null) }.isSuccess
        if (ok) return
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            component = app.component
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        }
        runCatching { context.startActivity(intent) }
    }

    fun openInfo(context: Context, app: AppEntry) {
        val la = context.getSystemService(LauncherApps::class.java)
        val ok = runCatching { la.startAppDetailsActivity(app.component, app.user, null, null) }.isSuccess
        if (ok) return
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", app.component.packageName, null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        runCatching { context.startActivity(intent) }
    }
}
