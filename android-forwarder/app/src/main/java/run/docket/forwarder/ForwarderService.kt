package run.docket.forwarder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log

/**
 * Foreground service that keeps a ContentObserver registered on the
 * telephony provider. onChange fires the instant any SMS/MMS/RCS row is
 * inserted — regardless of screen state or whether the thread is open — and
 * we scan for new inbound rows to forward.
 *
 * A periodic re-scan (every 60s) is a safety net: it catches rows missed
 * while offline (POST failures are retried) and any observer callback the
 * OS coalesces or drops.
 */
class ForwarderService : Service() {
    private val TAG = "docket-forwarder"
    private val CHANNEL = "forwarder"
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private lateinit var observer: ContentObserver

    private val rescan = object : Runnable {
        override fun run() {
            MessageScanner.scan(applicationContext)
            handler.postDelayed(this, 60_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("scanner").apply { start() }
        handler = Handler(thread.looper)

        observer = object : ContentObserver(handler) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                MessageScanner.scan(applicationContext)
            }
        }
        // content://mms-sms/ notifies for both sms and mms tables.
        contentResolver.registerContentObserver(
            Uri.parse("content://mms-sms/"), true, observer
        )

        startForeground(1, buildNotification())
        MessageScanner.baseline(applicationContext)
        handler.post(rescan)
        Log.i(TAG, "forwarder service started")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(Config.KEY_RUNNING, true).apply()
        return START_STICKY  // OS restarts us if killed
    }

    override fun onDestroy() {
        contentResolver.unregisterContentObserver(observer)
        handler.removeCallbacks(rescan)
        thread.quitSafely()
        getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(Config.KEY_RUNNING, false).apply()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Forwarder", NotificationManager.IMPORTANCE_LOW)
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("docket forwarder")
            .setContentText("Forwarding incoming messages")
            .setSmallIcon(android.R.drawable.sym_action_email)
            .setOngoing(true)
            .build()
    }
}
