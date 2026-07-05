package run.docket.forwarder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restart the forwarder after a reboot if it was running before. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = ctx.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(Config.KEY_RUNNING, false)) {
            ctx.startForegroundService(Intent(ctx, ForwarderService::class.java))
        }
    }
}
