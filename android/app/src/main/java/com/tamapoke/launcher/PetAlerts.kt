package com.tamapoke.launcher

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** One Pet per process, shared by the home screen and the background alarm. */
object PetStore {
    @Volatile private var pet: Pet? = null

    fun get(context: Context): Pet = pet ?: synchronized(this) {
        pet ?: Pet(context.applicationContext.getSharedPreferences("pet", Context.MODE_PRIVATE)).also { pet = it }
    }
}

/**
 * Phone notifications for the pet: it woke up, it's hungry, it's lonely.
 *
 * The pet's clock only runs while something looks at it, so when the home screen
 * goes to the background an alarm is set for the moment the next alert could
 * happen; the alarm catches the pet up, posts what happened and sets the next one.
 */
object PetAlerts {
    private const val CHANNEL = "pet"
    private const val REQUEST_ALARM = 1

    fun postEvents(context: Context, pet: Pet) {
        val events = pet.drainEvents()
        if (events.isEmpty() || pet.isEgg) return
        val name = Pet.spokenName(pet.name)
        for (e in events) {
            val (id, title, text) = when (e) {
                Pet.Event.WOKE_UP -> Triple(1, "$name woke up!", "$name is full of energy and ready to play.")
                Pet.Event.HUNGRY -> Triple(2, "$name is hungry", "Its food bar is getting low. Time for a berry!")
                Pet.Event.LONELY -> Triple(3, "$name is lonely", "You haven't played with $name in a while.")
            }
            notify(context, id, title, text)
        }
    }

    @SuppressLint("MissingPermission")  // checked on the first lines
    private fun notify(context: Context, id: Int, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(context)
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, n) }
    }

    private fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Your Pokémon", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "When your Pokémon wakes up, gets hungry or feels lonely"
                },
            )
        }
    }

    /** Sets (or replaces) the background check for the pet's next alert. */
    fun schedule(context: Context, pet: Pet) {
        val am = context.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(context)
        val at = pet.nextAlertAt()
        if (at == null) {
            am.cancel(pi)
            return
        }
        // Inexact but allowed in Doze: may fire a little late, which is fine for a pet.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }

    fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context))
    }

    private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(
        context, REQUEST_ALARM,
        Intent(context, PetAlarmReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

/** Fired by the alarm while you are in other apps: catch the pet up, notify, re-arm. */
class PetAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pet = PetStore.get(context)
        pet.update()
        PetAlerts.postEvents(context, pet)
        PetAlerts.schedule(context, pet)
    }
}

/** Alarms are wiped by a reboot: set the next one again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val pet = PetStore.get(context)
        pet.update()
        PetAlerts.postEvents(context, pet)
        PetAlerts.schedule(context, pet)
    }
}
