package com.tamapoke.launcher

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.provider.Settings
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap

class AppEntry(
    val label: String,
    val component: ComponentName,
    val icon: ImageBitmap,
)

object Apps {
    /** Every installed app that has a launcher icon. */
    fun getInstalledApps(context: Context): List<ResolveInfo> {
        val mainIntent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        return context.packageManager.queryIntentActivities(mainIntent, PackageManager.MATCH_ALL)
    }

    /** Loads labels and icons, sorted by name. Slow: call off the main thread. */
    fun load(context: Context, iconPx: Int): List<AppEntry> {
        val pm = context.packageManager
        return getInstalledApps(context)
            .filter { it.activityInfo.packageName != context.packageName }
            .map { ri ->
                val info = ri.activityInfo
                AppEntry(
                    label = ri.loadLabel(pm).toString(),
                    component = ComponentName(info.packageName, info.name),
                    icon = ri.loadIcon(pm).toBitmap(iconPx, iconPx).asImageBitmap(),
                )
            }
            .distinctBy { it.component }
            .sortedBy { it.label.lowercase() }
    }

    fun launch(context: Context, app: AppEntry) {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
            component = app.component
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
        }
        runCatching { context.startActivity(intent) }
    }

    fun openInfo(context: Context, app: AppEntry) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", app.component.packageName, null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        runCatching { context.startActivity(intent) }
    }
}
