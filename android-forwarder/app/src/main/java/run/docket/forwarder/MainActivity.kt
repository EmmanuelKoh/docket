package run.docket.forwarder

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import run.docket.forwarder.databinding.ActivityMainBinding

/**
 * Minimal config + control screen: enter the /ingest URL and token, grant
 * SMS + notification permissions, start/stop the forwarder service.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding

    private val permissions = arrayOf(
        Manifest.permission.READ_SMS,
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.POST_NOTIFICATIONS,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        val prefs = getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
        b.urlField.setText(prefs.getString(Config.KEY_URL, "https://docket.ekoh.run/ingest"))
        b.tokenField.setText(prefs.getString(Config.KEY_TOKEN, ""))

        b.saveBtn.setOnClickListener {
            prefs.edit()
                .putString(Config.KEY_URL, b.urlField.text.toString().trim())
                .putString(Config.KEY_TOKEN, b.tokenField.text.toString().trim())
                .apply()
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        }

        b.permBtn.setOnClickListener {
            ActivityCompat.requestPermissions(this, permissions, 1)
        }

        b.startBtn.setOnClickListener {
            if (!hasSmsPermission()) {
                Toast.makeText(this, "Grant SMS permission first", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            startForegroundService(Intent(this, ForwarderService::class.java))
            Toast.makeText(this, "Forwarder started", Toast.LENGTH_SHORT).show()
        }

        b.stopBtn.setOnClickListener {
            stopService(Intent(this, ForwarderService::class.java))
            Toast.makeText(this, "Forwarder stopped", Toast.LENGTH_SHORT).show()
        }
    }

    private fun hasSmsPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED
}
