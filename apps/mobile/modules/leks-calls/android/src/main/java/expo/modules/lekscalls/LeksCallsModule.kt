package expo.modules.lekscalls

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LeksCallsModule : Module() {
  /** "answer" or "decline" when the app was opened from the call notification's buttons. */
  private var pendingAction: String? = null

  private fun context() = appContext.reactContext ?: throw IllegalStateException("no context")

  private fun remember(intent: Intent?) {
    val action = intent?.getStringExtra(IncomingCall.EXTRA_ACTION) ?: return
    pendingAction = action
    intent.removeExtra(IncomingCall.EXTRA_ACTION)
    IncomingCall.cancel(context())
  }

  override fun definition() = ModuleDefinition {
    Name("LeksCalls")

    OnCreate { remember(appContext.currentActivity?.intent) }
    OnNewIntent { intent -> remember(intent) }

    Function("showIncomingCall") { title: String, text: String -> IncomingCall.show(context(), title, text) }
    Function("cancelIncomingCall") { IncomingCall.cancel(context()) }

    /** Returns and forgets the button the person pressed on the notification, if any. */
    Function("takePendingAction") {
      remember(appContext.currentActivity?.intent)
      val action = pendingAction
      pendingAction = null
      action
    }

    /** While a call rings or runs, the app may show over the lock screen and wake it. */
    Function("setShowOverLockScreen") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(on)
          activity.setTurnScreenOn(on)
        }
      }
    }

    Function("canCoverLockScreen") { IncomingCall.canCoverLockScreen(context()) }

    Function("openFullScreenSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context().packageName}"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context().startActivity(intent)
      }
    }
  }
}
