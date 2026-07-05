# docket forwarder

A small Android app that forwards every incoming message — **SMS and RCS** —
to the docket `/ingest` endpoint, which classifies it with Gemini and prints
a task receipt when it contains one.

## Why an app (not Tasker)

RCS messages never trigger the SMS broadcast, and Android exposes no RCS API.
But on this phone, Google Messages writes RCS into the shared telephony
provider (`content://mms`) — verified: inbound RCS rows appear even with the
thread open on screen. This app registers a **ContentObserver** on that
provider, so it captures every message the instant it lands, regardless of
screen state, open threads, or muted conversations. Notification-listener
apps can't do that (open thread = no notification = nothing to forward).

## How it works

- A foreground service keeps a `ContentObserver` on `content://mms-sms/`.
- On each insert it scans `content://sms/inbox` and `content://mms` (inbox)
  for rows newer than the last one forwarded, reads the body + sender, and
  POSTs `{text, sender, source}` to `/ingest`.
- A row is marked "seen" only after a `2xx`, so a failed POST is retried on
  the next scan (a 60s safety-net re-scan runs alongside the observer).
- Survives reboot (BootReceiver restarts the service if it was running).

## One-time toolchain setup (on the Mac)

You have Java 8 and no Android SDK; the build needs JDK 17 + the Android SDK.

```sh
brew install openjdk@17 gradle
brew install --cask android-commandlinetools

# Point this shell at JDK 17 and the SDK (add to ~/.zshrc to make permanent)
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"

# Accept licenses and install the platform + build tools this project targets
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## Build the APK

```sh
cd android-forwarder
gradle assembleDebug          # first run downloads Gradle deps (~1–2 min)
# APK lands at: app/build/outputs/apk/debug/app-debug.apk
```

Use the **debug** build for sideloading: it's auto-signed with the debug key,
so `adb install` accepts it. ("Debug" refers only to the signing key and a
debuggable flag — the forwarding logic is identical to release.)
`gradle assembleRelease` produces `app-release-unsigned.apk`, which `adb
install` **rejects** because it has no signature — don't use it for sideload.

## Sideload onto the phone

Phone plugged in, USB debugging on (same as when you ran the adb queries):

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Configure and run (on the phone)

1. Open **docket forwarder**.
2. Ingest URL: `https://docket.ekoh.run/ingest` (or your deployment).
   Ingest token: the `INGEST_TOKEN` you set in the Vercel env. Tap **Save**.
3. Tap **Grant permissions** → allow SMS and notifications.
4. Tap **Start forwarder**. A persistent "Forwarding incoming messages"
   notification confirms it's running.
5. Battery: Settings → Apps → docket forwarder → Battery → **Unrestricted**,
   so Android doesn't kill the service in the background.

## Test

Have someone send you a task-shaped message ("remember to renew the
insurance by thursday") — SMS or RCS, thread open or closed. A TASK receipt
should print within a few seconds. Send an "ok see you later" and nothing
should print. Watch live logs while testing:

```sh
adb logcat -s docket-forwarder
```

## Notes

- First launch adopts the current newest message id per table as a baseline,
  so your existing history is not replayed — only messages received after you
  start the service are forwarded.
- No duplicate protection on the server yet; the app's per-table "last seen
  id" prevents the app from re-sending, which covers the normal case.
