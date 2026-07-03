// docket-agent.ino — the DOCKET printer device.
//
// Replaces both Mac processes (printer agent + heartbeat): polls the server
// for print jobs, streams the ESC/POS bytes to the RP850 over serial, acks,
// and POSTs /tick so plugins run. Once this is mounted, no computer is
// involved.
//
//   server <--wifi--> ESP32 <--MAX3232/DB9 serial--> RP850 printer
//
// Works against a local dev server (http://<laptop-ip>:3000) or production
// (https://<app>.vercel.app) — set SERVER_URL below. See
// docs/receipt-printer-build-guide.md for the staged bring-up.
//
// LED language (onboard LED):
//   fast blink   connecting to wifi
//   short pulse every ~3s   idle, polling normally
//   solid on     printing a job
//   double-blink loop   config/auth problem (check token or server URL)

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// ---------------- configuration ----------------
// Credentials live in secrets.h (gitignored — this repo is public).
// First time: copy secrets.h.example to secrets.h and fill it in.

#include "secrets.h"

const char* WIFI_SSID    = SECRET_WIFI_SSID;
const char* WIFI_PASS    = SECRET_WIFI_PASS;
const char* SERVER_URL   = SECRET_SERVER_URL;
const char* DEVICE_TOKEN = SECRET_DEVICE_TOKEN;

// Serial link to the printer. Set the RP850's DIP switches to 115200.
const uint32_t PRINTER_BAUD = 115200;

// UART pins wired to the MAX3232 board's TTL side.
//   Classic ESP32 DevKit (WROOM-32): TX=17, RX=16
//   Seeed XIAO ESP32-S3:             TX=43 (D6), RX=44 (D7)
const int PIN_TX = 17;
const int PIN_RX = 16;

const uint32_t POLL_MS = 3000;   // how often to ask /next for a job
const uint32_t TICK_MS = 30000;  // how often to POST /tick (heartbeat)

// Generic "ESP32 Dev Module" boards don't define LED_BUILTIN even though
// the DevKit's blue LED is on GPIO 2. Boards that do define it (XIAO: 21)
// win; capture the result as a typed constant.
#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif
const uint8_t LED_PIN = LED_BUILTIN;

// ----------------------------------------------------------------------

HardwareSerial Printer(1);

const bool USE_TLS = strncmp(SERVER_URL, "https", 5) == 0;
String pendingAckId = "";        // a job we printed but haven't acked yet
uint32_t lastTick = 0;
uint32_t lastPoll = 0;
uint32_t backoffUntil = 0;

// ---- LED ----

void ledOn()  { digitalWrite(LED_PIN, HIGH); }
void ledOff() { digitalWrite(LED_PIN, LOW); }
void blink(int times, int ms) {
  for (int i = 0; i < times; i++) { ledOn(); delay(ms); ledOff(); delay(ms); }
}

// ---- HTTP helpers ----

// Begin a request on the right client type for http/https. The TLS client
// skips certificate validation — the Bearer token is the auth, and the
// threat model of a home printer doesn't justify baking in root CAs that
// expire. Revisit if this ever leaves the house.
WiFiClientSecure tlsClient;
WiFiClient plainClient;

bool httpBegin(HTTPClient& http, const String& path) {
  String url = String(SERVER_URL) + path;
  if (USE_TLS) {
    tlsClient.setInsecure();
    return http.begin(tlsClient, url);
  }
  return http.begin(plainClient, url);
}

void addAuth(HTTPClient& http) {
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
}

// POST helper for /ack, /nack, /tick. Returns HTTP code (or negative).
int post(const String& path) {
  HTTPClient http;
  if (!httpBegin(http, path)) return -1;
  addAuth(http);
  int code = http.POST("");
  http.end();
  return code;
}

// ---- printer status (DLE EOT real-time probes) ----

void drainPrinterInput() {
  while (Printer.available()) Printer.read();
}

// Ask the printer a status question; returns the reply byte or -1 on silence.
int probe(uint8_t n) {
  drainPrinterInput();
  Printer.write(0x10); Printer.write(0x04); Printer.write(n);
  Printer.flush();
  uint32_t t0 = millis();
  while (!Printer.available() && millis() - t0 < 400) delay(2);
  if (!Printer.available()) return -1;
  return Printer.read();
}

// Calibrated against the RP850: online 0x16, lid open 0x1E (bit3 = offline).
bool printerOnline() {
  int s = probe(1);
  if (s < 0) return false;         // silence = off or unplugged
  return (s & 0x08) == 0;          // bit3 set = offline (lid open, error)
}

// Calibrated: paper ok 0x12, near-end 0x1E (prints on — it's a warning),
// out/lid 0x72 (bits 5+6 = paper end — refuse the job).
bool paperOK() {
  int s = probe(4);
  if (s < 0) return false;         // silent printer = not safe to print
  return (s & 0x60) == 0;
}

// ---- printing ----

// Stream the job body to the printer in small chunks, honoring XON/XOFF
// software flow control if the printer sends it (0x13 pause / 0x11 resume).
// Returns bytes written, or -1 on a stall.
long streamToPrinter(WiFiClient* body, long expected) {
  uint8_t buf[512];
  long written = 0;
  bool paused = false;
  uint32_t lastData = millis();

  while (written < expected) {
    // honor flow control from the printer
    while (Printer.available()) {
      uint8_t b = Printer.read();
      if (b == 0x13) paused = true;    // XOFF — printer buffer is full
      if (b == 0x11) paused = false;   // XON — go again
    }
    if (paused) {
      if (millis() - lastData > 15000) return -1; // stuck paused — give up
      delay(20);
      continue;
    }

    size_t avail = body->available();
    if (!avail) {
      if (millis() - lastData > 10000) return -1; // network stalled
      delay(5);
      continue;
    }

    size_t n = body->readBytes(buf, min(avail, sizeof(buf)));
    Printer.write(buf, n);              // blocks at PRINTER_BAUD — self-pacing
    written += n;
    lastData = millis();
  }
  Printer.flush();
  return written;
}

// ---- the two loops ----

void doTick() {
  int code = post("/tick");
  if (code == 401) { Serial.println("tick: 401 — check DEVICE_TOKEN"); blink(2, 120); }
  else if (code != 200) Serial.printf("tick: %d\n", code);
  else Serial.println("tick: ok");
}

void doPoll() {
  // A printed-but-unacked job MUST be acked before fetching a new one,
  // or the lease expiry would reprint it.
  if (pendingAckId.length()) {
    int code = post("/ack?job=" + pendingAckId);
    if (code == 200) {
      Serial.println("ack (retry): " + pendingAckId);
      pendingAckId = "";
    } else {
      Serial.printf("ack retry failed (%d), will retry\n", code);
      return;
    }
  }

  HTTPClient http;
  if (!httpBegin(http, "/next")) return;
  addAuth(http);
  const char* headerKeys[] = { "X-Job-Id" };
  http.collectHeaders(headerKeys, 1);

  int code = http.GET();
  if (code == 204) { http.end(); return; }              // queue empty
  if (code == 401) { http.end(); Serial.println("next: 401 — check DEVICE_TOKEN"); blink(2, 120); return; }
  if (code != 200) { http.end(); Serial.printf("next: %d\n", code); backoffUntil = millis() + 15000; return; }

  String jobId = http.header("X-Job-Id");
  long expected = http.getSize();
  Serial.printf("job %s: %ld bytes\n", jobId.c_str(), expected);

  // check the printer before committing to the job
  int s1 = probe(1);
  int s4 = probe(4);
  bool online = s1 >= 0 && (s1 & 0x08) == 0;
  bool paper = s4 >= 0 && (s4 & 0x60) == 0;
  if (!online || !paper) {
    http.end();
    Serial.printf("printer not ready (EOT1=%d 0x%02X, EOT4=%d 0x%02X) — nack\n",
                  s1, s1 < 0 ? 0 : s1, s4, s4 < 0 ? 0 : s4);
    post("/nack?job=" + jobId);
    backoffUntil = millis() + 15000;
    return;
  }

  ledOn();
  long written = streamToPrinter(http.getStreamPtr(), expected);
  http.end();
  ledOff();

  if (written == expected && expected > 0) {
    Serial.printf("job %s: printed\n", jobId.c_str());
    if (post("/ack?job=" + jobId) == 200) {
      Serial.println("ack: " + jobId);
    } else {
      pendingAckId = jobId;   // printed for sure — never nack it now
      Serial.println("ack failed — will retry before next job");
    }
  } else {
    Serial.printf("job %s: stalled at %ld/%ld — nack\n", jobId.c_str(), written, expected);
    post("/nack?job=" + jobId);
    backoffUntil = millis() + 15000;
  }
}

// ---- setup / main loop ----

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);                                  // USB debug console
  Printer.begin(PRINTER_BAUD, SERIAL_8N1, PIN_RX, PIN_TX);
  delay(300);

  Serial.printf("\nDOCKET agent — server %s\n", SERVER_URL);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { blink(1, 80); }
  Serial.print("wifi: ");
  Serial.println(WiFi.localIP());
  blink(3, 60);                                          // connected!
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {                   // self-heal wifi
    Serial.println("wifi lost — reconnecting");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) { blink(1, 80); }
    Serial.println("wifi back");
  }

  uint32_t now = millis();
  if (now - lastTick >= TICK_MS || lastTick == 0) {
    lastTick = now;
    doTick();
  }
  if (now >= backoffUntil && (now - lastPoll >= POLL_MS || lastPoll == 0)) {
    lastPoll = now;
    ledOn(); delay(15); ledOff();                        // idle pulse
    doPoll();
  }
  delay(50);
}
