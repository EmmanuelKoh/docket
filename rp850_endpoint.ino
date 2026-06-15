// rp850_endpoint.ino
// Thin print endpoint: XIAO ESP32-S3 + MAX3232 -> Rongta RP850 (serial)
//
// Loop:  WiFi -> poll server for a job -> check paper -> stream ESC/POS
//        -> ack (or nack so the server re-queues). The endpoint stays dumb:
//        no rendering, no source knowledge, just bytes in -> head.
//
// This is a skeleton to validate the output side against real hardware.
// Endpoints (/next, /ack, /nack) are yours to define on the server.

#include <WiFi.h>
#include <HTTPClient.h>

// ---------------- config ----------------
const char*    WIFI_SSID    = "your-ssid";
const char*    WIFI_PASS    = "your-pass";
const char*    SERVER       = "http://192.168.1.10:8080";  // render/route server
const char*    DEVICE_ID    = "desk-01";

// XIAO ESP32-S3 hardware UART pins: D6 = GPIO43 (TX), D7 = GPIO44 (RX)
const int      PIN_TX       = 43;
const int      PIN_RX       = 44;

// MUST match the printer self-test (FEED-hold power-on prints the config).
// Keep modest: at 19200 the serial link is slower than the print mechanism,
// so it self-throttles and you avoid buffer overflow. Raise only if you
// also honor the printer's busy/DTR line.
const uint32_t PRINTER_BAUD = 19200;

const uint32_t POLL_MS      = 15000;

HardwareSerial Printer(1);

// ---------------- wifi ----------------
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
}

// ---------------- printer status ----------------
// Real-time status via ESC/POS: DLE EOT 4 -> paper sensor byte.
// Returns true if paper is present (or if the printer doesn't answer:
// don't block printing on a silent status line).
bool paperOK() {
  while (Printer.available()) Printer.read();        // flush stale bytes
  const uint8_t q[] = { 0x10, 0x04, 0x04 };          // DLE EOT 4
  Printer.write(q, sizeof(q));

  uint32_t t0 = millis();
  while (!Printer.available() && millis() - t0 < 200) delay(2);
  if (!Printer.available()) return true;             // no reply -> assume ok

  uint8_t s = Printer.read();
  // bits set in 0x0C indicate paper near-end / out on most ESC/POS units.
  return (s & 0x0C) == 0;
}

// ---------------- ack / nack ----------------
void report(const String& path) {
  HTTPClient h;
  h.begin(String(SERVER) + path);
  h.GET();
  h.end();
}

// ---------------- setup ----------------
void setup() {
  Serial.begin(115200);
  Printer.begin(PRINTER_BAUD, SERIAL_8N1, PIN_RX, PIN_TX);
  connectWiFi();
}

// ---------------- main loop ----------------
void loop() {
  connectWiFi();

  HTTPClient http;
  http.begin(String(SERVER) + "/next?device=" + DEVICE_ID);
  const char* headerKeys[] = { "X-Job-Id" };
  http.collectHeaders(headerKeys, 1);

  int code = http.GET();

  // 200 = a job is waiting; 204 = nothing to print right now.
  if (code == 200) {
    String jobId = http.header("X-Job-Id");

    if (!paperOK()) {
      http.end();
      report("/nack?job=" + jobId + "&reason=paper");   // server re-queues
    } else {
      // Stream raw ESC/POS bytes straight to the head, chunked.
      WiFiClient* stream = http.getStreamPtr();
      uint8_t buf[256];
      while (http.connected()) {
        size_t n = stream->readBytes(buf, sizeof(buf));
        if (n == 0) break;
        Printer.write(buf, n);
        // At 19200 the link self-throttles. If you raise baud, gate this
        // write on the printer's busy line or poll DLE EOT 4 between chunks.
      }
      http.end();
      report("/ack?job=" + jobId);
    }
  } else {
    http.end();
  }

  delay(POLL_MS);
}
