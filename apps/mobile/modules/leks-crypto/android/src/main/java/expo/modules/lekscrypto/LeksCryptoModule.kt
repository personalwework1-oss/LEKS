package expo.modules.lekscrypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class LeksCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LeksCrypto")

    /** Private app storage for the encryption state; excluded from backups (allowBackup=false). */
    Function("stateDirectory") {
      val context = appContext.reactContext ?: throw IllegalStateException("no context")
      val dir = File(context.noBackupFilesDir, "leks")
      dir.mkdirs()
      dir.absolutePath
    }

    /** Runs on a background thread; encryption never blocks the interface. */
    AsyncFunction("call") { request: String ->
      String(LeksCryptoNative.call(request.toByteArray(Charsets.UTF_8)), Charsets.UTF_8)
    }
  }
}
