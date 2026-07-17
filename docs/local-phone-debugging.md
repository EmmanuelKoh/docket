# Debugging the dev app on a phone

Some things only break on a real phone: touch targets, mobile Safari and
Chrome quirks, the Tape microphone, and the Tape transcriber running on a
phone GPU. This doc is how to point a phone at the local `npm run dev`
server and read its console.

There are two ways to reach the dev server from a phone. Pick by what you
are testing.

## Which path to use

| Path | URL on phone | Secure context | Microphone works | Setup |
|---|---|---|---|---|
| LAN IP | `http://<mac-ip>:3000` | no | no | none |
| Tunnel | `https://<name>.trycloudflare.com` | yes | yes | cloudflared |

Browsers only grant a "secure context" to `localhost` or to `https://`. A
bare LAN IP over plain `http://` is not secure, so `getUserMedia` (the
Tape mic) is blocked there. Use the LAN IP for quick layout checks, and
the tunnel whenever you need the mic or anything else that needs HTTPS.

Do not use `next dev --experimental-https`. It serves a self-signed cert,
and a phone cannot click past a cert warning for a WebSocket, so Next's
hot-reload socket fails and the page loads but never becomes interactive.
The tunnel gives a real trusted cert and avoids all of that.

## Find your Mac's LAN IP

```
ipconfig getifaddr en0
```

If that is empty try `en1` or `en5` (the Wi-Fi interface name varies by
Mac). Use the address it prints, for example `192.168.1.157`. Do not use
the `.255` broadcast address that `ifconfig` also shows.

## Path A: LAN IP (layout only, no mic)

1. `npm run dev` on the Mac.
2. Phone and Mac on the same Wi-Fi.
3. On the phone open `http://<mac-ip>:3000`.

The LAN IP must be listed in two places or the app will not come alive
(see "Why the config entries exist" below). The current IP is already
listed; if your router hands the Mac a different address, update both.

## Path B: cloudflared tunnel (HTTPS, mic works)

1. Install once: `brew install cloudflared`.
2. `npm run dev` on the Mac (plain HTTP, the tunnel adds the TLS).
3. In a second terminal:

   ```
   cloudflared tunnel --url http://localhost:3000
   ```

4. It prints a line like
   `https://<random-words>.trycloudflare.com`. Open that on the phone.
5. Stop the tunnel with Ctrl-C when done. The URL is reachable from the
   public internet while it runs.

Each run of a quick tunnel prints a new random subdomain. You do not need
to change any config for a new subdomain: the allowlists use a
`*.trycloudflare.com` wildcard.

## Why the config entries exist

Two separate gates reject requests from any origin other than `localhost`,
so both need the phone's origin allowlisted. Both are dev only and do not
affect production.

1. **`allowedDevOrigins` in `next.config.mjs`.** Next 16 rejects its own
   dev-runtime requests (the hot-reload socket, Turbopack internals) from
   non-`localhost` origins. Without the origin listed, every JS bundle
   downloads with status 200 but the page never hydrates, so a form does a
   native submit instead of running its handler. Symptom: after Sign in,
   the URL becomes `/login?email=...&password=...` and nothing else
   happens.

2. **`trustedOrigins` in `lib/auth-server.js`.** Better Auth's CSRF check
   rejects a sign-in whose `Origin` header is not trusted. Symptom: the
   sign-in request returns 403 with `Invalid origin` in the dev server
   log, and login fails even though the page is now interactive.

Both files list `*.trycloudflare.com`, `*.ngrok-free.app`, and the
current LAN IP. Add a new entry only if you use a different tunnel host.

## Reading the phone's console

The console error is worth more than any guess. Remote debugging mirrors
the phone's DevTools on the Mac.

- **Android (Chrome):** enable Developer options and USB debugging on the
  phone, connect it by USB, then on the Mac open Chrome at
  `chrome://inspect/#devices` and click **inspect** under the phone's tab.
- **iOS (Safari):** on the phone enable Settings > Safari > Advanced > Web
  Inspector, connect by USB, then on the Mac use Safari's Develop menu and
  pick the phone.

Check the **Console** tab for red errors and the **Network** tab for any
request that failed (filter to JS to see the bundles).

## Tape transcriber on the phone

The Tape transcriber runs the Basic Pitch neural net through TensorFlow.js.
Some phone GPUs miscompute it in WebGL while reporting full float32
support, which produces wildly wrong notes. The transcriber defends
against this itself: on the first decode it runs a short synthetic A4
through the model (the "canary") and, if WebGL gets it wrong, switches to
the WASM kernels in `public/tf-wasm/`. See `components/tape/decode.js`.

WASM is the last rung. It computes in plain IEEE floats, so if it also
fails the canary or will not start, something on our side is broken (a
missing `/tf-wasm` asset, or a stale Fill-kernel shim after a tfjs
upgrade). The decode raises an error rather than falling back further.
There is deliberately no CPU rung: a pure-JS decode of a real take can
run for minutes, which would hide the fault instead of surfacing it. A
failed pick is not cached, so the next take retries.

The chosen backend is decided once per page load and reused for every
take. The canary result and the chosen backend are logged to the console
(`tape decode canary:` and `tape decode backend:`), visible over remote
debugging. A phone with a working GPU stays on WebGL, so to see the
fallback you need a device whose GPU actually fails the canary.
