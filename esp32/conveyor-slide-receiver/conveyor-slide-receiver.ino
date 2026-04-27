/*
 * Conveyor slide receiver — second ESP32 on the same LAN as your Next.js PC.
 *
 * 1) Install in Arduino IDE: Board "ESP32 Dev Module" (or your module).
 * 2) Set WIFI_SSID / WIFI_PASS below.
 * 3) Choose SLIDE_GPIO (relay IN pin; active HIGH unless USE_ACTIVE_LOW).
 * 4) In web/.env.local set:
 *      CONVEYOR_SLIDE_WEBHOOK_URL=http://<THIS_ESP32_IP>/slide
 *    Optional shared secret (must match both sides):
 *      CONVEYOR_SLIDE_WEBHOOK_SECRET=your-secret
 *      WEBHOOK_SECRET in this sketch = same value
 * 5) Upload, open Serial Monitor, note the printed IP. Put that URL in .env.local and restart Next.js.
 *
 * Next.js only POSTs here when the decoded QR text contains "Category A" (configurable there).
 */

#include <WiFi.h>

// ----- Wi‑Fi -----
const char *WIFI_SSID = "";
const char *WIFI_PASS = "";

// ----- Slide output -----
// GPIO that drives your relay / MOSFET (solenoid or small motor). Not the same pins as ESP32‑CAM camera.
const int SLIDE_GPIO = 2;
const bool USE_ACTIVE_LOW = false;  // set true if relay module is active LOW
const unsigned long PULSE_MS = 400; // solenoid pulse; tune 200–800 ms

// ----- Webhook auth (optional; must match CONVEYOR_SLIDE_WEBHOOK_SECRET in Next.js) -----
const char *WEBHOOK_SECRET = "";  // empty = accept any POST to /slide (LAN only — still risky)

// ----- HTTP server -----
WiFiServer server(80);

static void pulseSlide() {
  if (USE_ACTIVE_LOW) {
    digitalWrite(SLIDE_GPIO, LOW);
    delay(PULSE_MS);
    digitalWrite(SLIDE_GPIO, HIGH);
  } else {
    digitalWrite(SLIDE_GPIO, HIGH);
    delay(PULSE_MS);
    digitalWrite(SLIDE_GPIO, LOW);
  }
}

static bool readHttpRequest(WiFiClient &client, String &outMethod, String &outPath,
                            String &outHeadersLower, String &outBody) {
  outMethod = "";
  outPath = "";
  outHeadersLower = "";
  outBody = "";

  unsigned long deadline = millis() + 8000;
  while (client.connected() && millis() < deadline) {
    if (client.available()) break;
    delay(1);
  }
  if (!client.available()) return false;

  String line = client.readStringUntil('\n');
  line.trim();
  int sp = line.indexOf(' ');
  int sp2 = line.indexOf(' ', sp + 1);
  if (sp < 1 || sp2 < sp + 1) return false;
  outMethod = line.substring(0, sp);
  outPath = line.substring(sp + 1, sp2);

  // Headers until blank line
  while (client.connected() && millis() < deadline) {
    String h = client.readStringUntil('\n');
    if (h.length() <= 2) break;
    outHeadersLower += h;
    outHeadersLower += "\n";
  }
  outHeadersLower.toLowerCase();

  int cl = -1;
  int pos = outHeadersLower.indexOf("content-length:");
  if (pos >= 0) {
    int end = outHeadersLower.indexOf('\n', pos);
    String clStr = outHeadersLower.substring(pos + 15, end >= 0 ? end : outHeadersLower.length());
    clStr.trim();
    cl = clStr.toInt();
  }
  if (cl < 0 || cl > 8192) cl = 0;

  outBody.reserve(cl + 8);
  deadline = millis() + 8000;
  while ((int)outBody.length() < cl && client.connected() && millis() < deadline) {
    while (client.available() && (int)outBody.length() < cl) {
      outBody += (char)client.read();
    }
    if ((int)outBody.length() >= cl) break;
    delay(1);
  }
  return true;
}

static String headerValue(const String &headersLower, const char *nameColonLower) {
  int p = headersLower.indexOf(nameColonLower);
  if (p < 0) return "";
  int start = p + strlen(nameColonLower);
  while (start < (int)headersLower.length() && (headersLower[start] == ' ' || headersLower[start] == '\t')) start++;
  int end = headersLower.indexOf('\n', start);
  if (end < 0) end = headersLower.length();
  String v = headersLower.substring(start, end);
  v.trim();
  return v;
}

static void sendResponse(WiFiClient &client, int code, const char *jsonBody) {
  const char *reason = code == 200 ? "OK" : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : "Error";
  client.print("HTTP/1.1 ");
  client.print(code);
  client.print(" ");
  client.print(reason);
  client.print("\r\nContent-Type: application/json\r\nConnection: close\r\n");
  client.print("Content-Length: ");
  client.print((int)strlen(jsonBody));
  client.print("\r\n\r\n");
  client.print(jsonBody);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(SLIDE_GPIO, OUTPUT);
  if (USE_ACTIVE_LOW)
    digitalWrite(SLIDE_GPIO, HIGH);
  else
    digitalWrite(SLIDE_GPIO, LOW);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("[WiFi] IP: ");
  Serial.println(WiFi.localIP());

  server.begin();
  Serial.println("[HTTP] POST /slide  ->  pulse slide GPIO");
}

void loop() {
  WiFiClient client = server.available();
  if (!client) return;

  String method, path, headers, body;
  if (!readHttpRequest(client, method, path, headers, body)) {
    sendResponse(client, 400, "{\"error\":\"bad request\"}");
    client.stop();
    return;
  }

  if (method != "POST" || path != "/slide") {
    sendResponse(client, 404, "{\"error\":\"not found\"}");
    client.stop();
    return;
  }

  if (strlen(WEBHOOK_SECRET) > 0) {
    String got = headerValue(headers, "x-slide-webhook-secret:");
    if (!got.equals(WEBHOOK_SECRET)) {
      sendResponse(client, 401, "{\"error\":\"unauthorized\"}");
      client.stop();
      return;
    }
  }

  Serial.println("[slide] webhook OK, pulsing GPIO");
  pulseSlide();
  sendResponse(client, 200, "{\"ok\":true,\"pulsedMs\":" + String(PULSE_MS) + "}");
  client.stop();
}
