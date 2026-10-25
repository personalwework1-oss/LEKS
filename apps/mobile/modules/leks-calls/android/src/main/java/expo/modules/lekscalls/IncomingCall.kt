package expo.modules.lekscalls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person

/**
 * The "someone is calling" notification: rings and vibrates until answered,
 * covers the lock screen (full-screen intent) and has Answer / Decline.
 * It carries no name or number: the push that triggers it has no content.
 */
object IncomingCall {
  private const val CHANNEL = "incoming_calls"
  private const val NOTIFICATION_ID = 4401
  const val EXTRA_ACTION = "leks_call_action"
  private const val RING_MS = 45_000L

  fun show(context: Context, title: String, text: String) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Входящие звонки", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 1000, 800, 1000, 800)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    fun open(action: String?, requestCode: Int): PendingIntent {
      val intent = Intent(launch).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        if (action != null) putExtra(EXTRA_ACTION, action)
      }
      return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val screen = open(null, 1)
    val answer = open("answer", 2)
    val decline = open("decline", 3)

    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
    val caller = Person.Builder().setName(title).setImportant(true).build()
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(true)
      .setTimeoutAfter(RING_MS)
      .setContentIntent(screen)
      .setFullScreenIntent(screen, true)
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer))
      .build()
    // Keep ringing until it is answered, declined or times out.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    manager.notify(NOTIFICATION_ID, notification)
  }

  fun cancel(context: Context) {
    context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
  }

  /** Android 14+ asks the user to allow full-screen calls for apps not from the store. */
  fun canCoverLockScreen(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    return context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: false
  }
}
