package run.docket.forwarder

import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Reads new inbound messages from the telephony provider and POSTs each to
 * the docket /ingest endpoint.
 *
 * Both SMS and RCS land in this provider on this device (verified: RCS chat
 * messages appear in content://mms even with the thread open), so a single
 * scan of content://sms/inbox + content://mms (msg_box=1) captures
 * everything — no dependency on notifications or broadcasts.
 *
 * State: the highest _id already forwarded, tracked per table in
 * SharedPreferences. A row is marked seen only after a 2xx from the server,
 * so a failed POST is retried on the next scan and ordering is preserved
 * (scan stops at the first failure).
 */
object MessageScanner {
    private const val TAG = "docket-forwarder"
    private const val PREFS = "forwarder"
    private const val KEY_LAST_SMS = "last_sms_id"
    private const val KEY_LAST_MMS = "last_mms_id"

    // PduHeaders.FROM — the address row that holds the MMS/RCS sender.
    private const val MMS_ADDR_FROM = 137
    // Placeholder address the provider stores for the local user.
    private const val INSERT_ADDRESS_TOKEN = "insert-address-token"

    @Synchronized
    fun scan(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val url = prefs.getString(Config.KEY_URL, "") ?: ""
        val token = prefs.getString(Config.KEY_TOKEN, "") ?: ""
        if (url.isBlank() || token.isBlank()) {
            Log.w(TAG, "URL or token not configured; skipping scan")
            return
        }
        scanSms(ctx, prefs, url, token)
        scanMms(ctx, prefs, url, token)
    }

    /** First run: adopt the current max id per table so history isn't replayed. */
    fun baseline(ctx: Context) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(KEY_LAST_SMS)) {
            prefs.edit().putLong(KEY_LAST_SMS, maxId(ctx, Uri.parse("content://sms/inbox")))
                .putLong(KEY_LAST_MMS, maxId(ctx, Uri.parse("content://mms"), "msg_box=1"))
                .apply()
        }
    }

    private fun maxId(ctx: Context, uri: Uri, where: String? = null): Long {
        ctx.contentResolver.query(uri, arrayOf("_id"), where, null, "_id DESC LIMIT 1")
            ?.use { if (it.moveToFirst()) return it.getLong(0) }
        return 0
    }

    private fun scanSms(ctx: Context, prefs: android.content.SharedPreferences, url: String, token: String) {
        var last = prefs.getLong(KEY_LAST_SMS, 0)
        ctx.contentResolver.query(
            Uri.parse("content://sms/inbox"),
            arrayOf("_id", "address", "body", "date"),
            "_id > ?", arrayOf(last.toString()), "_id ASC"
        )?.use { c ->
            val idCol = c.getColumnIndexOrThrow("_id")
            val addrCol = c.getColumnIndexOrThrow("address")
            val bodyCol = c.getColumnIndexOrThrow("body")
            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val body = c.getString(bodyCol) ?: ""
                val number = c.getString(addrCol) ?: "unknown"
                val sender = contactName(ctx, number) ?: number
                if (!post(url, token, body, sender, "sms")) return  // retry next scan
                last = id
                prefs.edit().putLong(KEY_LAST_SMS, last).apply()
            }
        }
    }

    private fun scanMms(ctx: Context, prefs: android.content.SharedPreferences, url: String, token: String) {
        var last = prefs.getLong(KEY_LAST_MMS, 0)
        ctx.contentResolver.query(
            Uri.parse("content://mms"),
            arrayOf("_id", "date"),
            "msg_box=1 AND _id > ?", arrayOf(last.toString()), "_id ASC"
        )?.use { c ->
            val idCol = c.getColumnIndexOrThrow("_id")
            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val body = mmsText(ctx, id)
                val number = mmsSender(ctx, id)
                val sender = contactName(ctx, number) ?: number
                // Some MMS rows are notifications/receipts with no text part; skip.
                if (body.isNotBlank()) {
                    if (!post(url, token, body, sender, "rcs")) return  // retry next scan
                }
                last = id
                prefs.edit().putLong(KEY_LAST_MMS, last).apply()
            }
        }
    }

    /** Body text lives in content://mms/part, ct=text/plain, keyed by mid. */
    private fun mmsText(ctx: Context, mid: Long): String {
        val sb = StringBuilder()
        ctx.contentResolver.query(
            Uri.parse("content://mms/part"),
            arrayOf("ct", "text"),
            "mid=?", arrayOf(mid.toString()), null
        )?.use { c ->
            val ctCol = c.getColumnIndexOrThrow("ct")
            val textCol = c.getColumnIndexOrThrow("text")
            while (c.moveToNext()) {
                if (c.getString(ctCol) == "text/plain") {
                    c.getString(textCol)?.let { sb.append(it) }
                }
            }
        }
        return sb.toString().trim()
    }

    /** Sender address lives in content://mms/{id}/addr, type=137 (FROM). */
    private fun mmsSender(ctx: Context, mid: Long): String {
        ctx.contentResolver.query(
            Uri.parse("content://mms/$mid/addr"),
            arrayOf("address", "type"),
            "type=$MMS_ADDR_FROM", null, null
        )?.use { c ->
            val addrCol = c.getColumnIndexOrThrow("address")
            while (c.moveToNext()) {
                val a = c.getString(addrCol)
                if (!a.isNullOrBlank() && a != INSERT_ADDRESS_TOKEN) return a
            }
        }
        return "unknown"
    }

    /**
     * Resolve a phone number to a saved contact's display name via the
     * Contacts provider. Returns null if the number isn't a saved contact
     * (caller falls back to the raw number) or if READ_CONTACTS wasn't
     * granted — the query throws a SecurityException, which we swallow so a
     * missing permission degrades to "number as sender" instead of crashing.
     */
    private fun contactName(ctx: Context, number: String): String? {
        if (number.isBlank() || number == "unknown") return null
        return try {
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number)
            )
            ctx.contentResolver.query(
                uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null
            )?.use { if (it.moveToFirst()) it.getString(0) else null }
        } catch (e: SecurityException) {
            null
        }
    }

    /** POST {text, sender, source} to /ingest. Returns true on 2xx. */
    private fun post(url: String, token: String, text: String, sender: String, source: String): Boolean {
        return try {
            val sep = if (url.contains("?")) "&" else "?"
            val conn = URL("$url${sep}token=$token").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.doOutput = true
            // JSONObject escapes quotes/backslashes/newlines correctly — the
            // naive-string-concatenation bug the Tasker route had can't happen.
            val json = JSONObject()
                .put("text", text)
                .put("sender", sender)
                .put("source", source)
                .toString()
            conn.outputStream.use { it.write(json.toByteArray()) }
            val code = conn.responseCode
            conn.disconnect()
            if (code in 200..299) {
                Log.i(TAG, "forwarded ($source) from $sender -> $code")
                true
            } else {
                Log.w(TAG, "ingest returned $code; will retry")
                false
            }
        } catch (e: Exception) {
            Log.w(TAG, "post failed: ${e.message}; will retry")
            false
        }
    }
}
