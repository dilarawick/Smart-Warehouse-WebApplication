/*
 * Conveyor belt + gate controller (ESP32)
 *
 * Hardware:
 * - Stepper driver  STEP=18, DIR=19
 * - IR sensors      S1=33, S2=32, S3=26
 * - Servo (gate)    GPIO 21
 * - DHT22           GPIO 25
 * - LCD 16x2 I2C    SDA=23, SCL=22  (address 0x27)
 *
 * Libraries needed (install via Library Manager):
 *   - LiquidCrystal_I2C  (by Frank de Brabander)
 *   - DHT sensor library  (by Adafruit)
 *   - Adafruit Unified Sensor (dependency of DHT)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <esp32-hal-ledc.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>

// ---------- Pins ----------
#define STEP_PIN      18
#define DIR_PIN       19

#define IR_SENSOR_1   33   // S1: start
#define IR_SENSOR_2   32   // S2: stop + scan decision
#define IR_SENSOR_3   26   // S3: stop after B path

#define SERVO_PIN     21   // gate servo
#define DHT_PIN       25
#define DHT_TYPE      DHT22

#define LCD_SDA       23
#define LCD_SCL       22
#define LCD_ADDR      0x27  // change to 0x3F if display stays blank

// ---------- IR module behavior ----------
// Many 3-pin IR obstacle modules are either:
// - active LOW (OUT=0 when blocked) and often work well with INPUT_PULLUP, OR
// - active HIGH (OUT=1 when blocked) and should use INPUT.
// If your sensors are not triggering, flip these.
#define IR_ACTIVE_LOW  1   // 1 => blocked when LOW, 0 => blocked when HIGH
#define IR_USE_PULLUP  1   // 1 => use INPUT_PULLUP, 0 => use INPUT

// ---------- Wi-Fi / API ----------
const char *WIFI_SSID          = "";
const char *WIFI_PASS          = "";
const char *QR_API_BASE_URL    = "http://10.124.192.48:3000";
const char *API_KEY            = "";
const char *DEVICE_ID          = "belt-esp32-01";
const char *BELT_EVENTS_SECRET = "";

// Optional shared secret for POST /api/belt/telemetry (must match BELT_TELEMETRY_SECRET in Next.js)
const char *BELT_TELEMETRY_SECRET = "";

// ---------- Belt motion ----------
#define DEBOUNCE_MS         3
#define DEBOUNCE_TIMEOUT_MS 500
int stepDelayUs       = 150;
unsigned long lastStepUs = 0;
bool beltRunning      = false;

// ---------- Gate state ----------
enum class GateState { CLOSED, OPEN };
GateState currentGateState = GateState::CLOSED;

static const char* gateStateStr(GateState g) {
  return g == GateState::OPEN ? "open" : "closed";
}

// ---------- Last category seen ----------
String lastCategory = "";  // "Category A" or "Category B"

// ---------- Servo (ESP32 core 3.x LEDC) ----------
static const int SERVO_LEDC_BITS = 16;
static const int SERVO_FREQ_HZ   = 50;
static const int GATE_CLOSED_DEG = 15;
static const int GATE_OPEN_DEG   = 95;

static uint16_t dutyFromPulseUs(uint16_t pulseUs) {
  const uint32_t maxDuty = (1u << SERVO_LEDC_BITS) - 1u;
  return (uint16_t)((uint32_t)pulseUs * maxDuty / 20000u);
}
static uint16_t pulseUsFromDeg(int deg) {
  if (deg < 0)   deg = 0;
  if (deg > 180) deg = 180;
  return (uint16_t)(500 + (uint32_t)(deg) * (2500 - 500) / 180);
}
static void setGateDeg(int deg) {
  ledcWrite(SERVO_PIN, dutyFromPulseUs(pulseUsFromDeg(deg)));
}

// ---------- Devices ----------
LiquidCrystal_I2C lcd(LCD_ADDR, 16, 2);
DHT dht(DHT_PIN, DHT_TYPE);

// ---------- Forward declarations ----------
static bool containsIgnoreCase(const String &haystack, const char *needle);

// ---------- LCD helpers ----------
static String g_lcdLine1 = "";
static String g_lcdLine2 = "";

static void lcdPrint(uint8_t row, const String &msg) {
  String padded = msg;
  while ((int)padded.length() < 16) padded += ' ';
  padded = padded.substring(0, 16);

  if (row == 0) g_lcdLine1 = padded;
  if (row == 1) g_lcdLine2 = padded;

  lcd.setCursor(0, row);
  lcd.print(padded);
}

static void lcdStatus(const String &msg) {
  lcdPrint(0, msg);
}

// Bottom row: category (if known) + temperature + humidity
static void lcdUpdateBottom() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  String bottom = "";
  if (lastCategory.length() > 0) {
    String catShort = containsIgnoreCase(lastCategory, "Category A") ? "CatA" : "CatB";
    if (!isnan(t) && !isnan(h)) {
      bottom = catShort + " " + String(t, 1) + "C " + String((int)h) + "%";
    } else {
      bottom = catShort + " --C --%";
    }
  } else {
    if (!isnan(t) && !isnan(h)) {
      bottom = String(t, 1) + "C  " + String((int)h) + "%";
    } else {
      bottom = "Sensor error";
    }
  }
  lcdPrint(1, bottom);
}

// ---------- Sensor helpers ----------
static bool readSensor(int pin) {
  const int active = IR_ACTIVE_LOW ? LOW : HIGH;
  if (digitalRead(pin) == active) {
    delay(DEBOUNCE_MS);
    return digitalRead(pin) == active;
  }
  return false;
}

static void waitSensorClear(int pin) {
  unsigned long start = millis();
  const int active = IR_ACTIVE_LOW ? LOW : HIGH;
  while (digitalRead(pin) == active) {
    if (millis() - start > DEBOUNCE_TIMEOUT_MS) {
      Serial.printf("!! Sensor GPIO%d stuck LOW — giving up\n", pin);
      break;
    }
    delay(2);
  }
}

// ---------- Belt / gate ----------
static void stopBelt() {
  beltRunning = false;
  digitalWrite(STEP_PIN, LOW);
  Serial.println(">> Belt STOPPED");
}
static void startBelt() {
  beltRunning = true;
  Serial.println(">> Belt RUNNING");
}
static void setGateClosed() {
  setGateDeg(GATE_CLOSED_DEG);
  currentGateState = GateState::CLOSED;
  Serial.println(">> Gate: CLOSED");
  delay(350); // give servo time to move
}
static void setGateOpen() {
  setGateDeg(GATE_OPEN_DEG);
  currentGateState = GateState::OPEN;
  Serial.println(">> Gate: OPEN");
  delay(350); // give servo time to move
}

// ---------- JSON ----------
static String jsonEscape(const String &s) {
  String out; out.reserve(s.length() + 8);
  for (int i = 0; i < (int)s.length(); i++) {
    char c = s[i];
    if      (c=='\\' || c=='"') { out += '\\'; out += c; }
    else if (c=='\n') out += "\\n";
    else if (c=='\r') out += "\\r";
    else if (c=='\t') out += "\\t";
    else              out += c;
  }
  return out;
}

static bool postBeltEvent(const String &eventType,
                          const String &beltState,
                          const String &qrText,
                          const String &note) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(String(QR_API_BASE_URL) + "/api/belt/events");
  http.addHeader("content-type", "application/json");
  if (String(BELT_EVENTS_SECRET).length() > 0)
    http.addHeader("x-belt-secret", BELT_EVENTS_SECRET);

  String payload =
      String("{") +
      "\"deviceId\":\""  + jsonEscape(String(DEVICE_ID))       + "\"," +
      "\"eventType\":\"" + jsonEscape(eventType)                + "\"," +
      "\"gateState\":\""  + jsonEscape(gateStateStr(currentGateState)) + "\"," +
      "\"beltState\":\""  + jsonEscape(beltState)               + "\"," +
      "\"qrText\":"  + (qrText.length() ? "\"" + jsonEscape(qrText) + "\"" : "null") + "," +
      "\"note\":"    + (note.length()   ? "\"" + jsonEscape(note)   + "\"" : "null") +
      "}";

  const int code = http.POST((uint8_t *)payload.c_str(), payload.length());
  http.end();
  return code == 200;
}

// POST latest LCD lines + DHT readings to Next.js (in-memory "last telemetry")
static bool postTelemetry(float tC, float hPct) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setTimeout(4000);
  http.begin(String(QR_API_BASE_URL) + "/api/belt/telemetry");
  http.addHeader("content-type", "application/json");
  if (String(BELT_TELEMETRY_SECRET).length() > 0) {
    http.addHeader("x-belt-secret", BELT_TELEMETRY_SECRET);
  }

  const bool tOk = !isnan(tC);
  const bool hOk = !isnan(hPct);

  String payload =
      String("{") +
      "\"deviceId\":\"" + jsonEscape(String(DEVICE_ID)) + "\"," +
      "\"lcdLine1\":\"" + jsonEscape(g_lcdLine1) + "\"," +
      "\"lcdLine2\":\"" + jsonEscape(g_lcdLine2) + "\"," +
      "\"temperatureC\":" + (tOk ? String(tC, 1) : "null") + "," +
      "\"humidityPct\":" + (hOk ? String(hPct, 0) : "null") +
      "}";

  const int code = http.POST((uint8_t *)payload.c_str(), payload.length());
  http.end();
  return code == 200;
}

static void stepMotorNonBlocking() {
  unsigned long now = micros();
  if (now - lastStepUs >= (unsigned long)stepDelayUs) {
    lastStepUs = now;
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(STEP_PIN, LOW);
  }
}

// ---------- WiFi ----------
static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  if (String(WIFI_SSID).length() == 0) {
    Serial.println("[WiFi] SSID empty; skipping WiFi (offline mode).");
    lcdStatus("WiFi skipped");
    return;
  }
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] connecting");
  lcdStatus("WiFi connecting");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 15000) {
      Serial.println("\n[WiFi] timeout");
      lcdStatus("WiFi timeout");
      return;
    }
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
  lcdStatus("WiFi OK");
}

static void ensureWiFi() {
  if (String(WIFI_SSID).length() == 0) return;
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.reconnect();
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) delay(200);
}

// ---------- HTTP ----------
static String httpGetLastCaptureJson() {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(String(QR_API_BASE_URL) + "/api/qr/last-capture");
  if (String(API_KEY).length() > 0) http.addHeader("x-api-key", API_KEY);
  const int code = http.GET();
  if (code <= 0) { http.end(); return ""; }
  String body = http.getString();
  http.end();
  return body;
}

static bool jsonExtractString(const String &json, const char *key, String &out) {
  String needle = String("\"") + key + "\":";
  int k = json.indexOf(needle);
  if (k < 0) return false;
  int p = k + needle.length();
  while (p < (int)json.length() &&
         (json[p]==' '||json[p]=='\n'||json[p]=='\r'||json[p]=='\t')) p++;
  if (p >= (int)json.length() || json[p] != '"') return false;
  p++;
  String v = ""; v.reserve(64);
  bool esc = false;
  for (; p < (int)json.length(); p++) {
    char c = json[p];
    if (esc) {
      if      (c=='"'||c=='\\'||c=='/') v += c;
      else if (c=='n') v += '\n';
      else if (c=='r') v += '\r';
      else if (c=='t') v += '\t';
      else             v += c;
      esc = false; continue;
    }
    if (c=='\\') { esc=true; continue; }
    if (c=='"')  { out=v; return true; }
    v += c;
  }
  return false;
}

static bool jsonExtractNumber(const String &json, const char *key, unsigned long &out) {
  String needle = String("\"") + key + "\":";
  int k = json.indexOf(needle);
  if (k < 0) return false;
  int p = k + needle.length();
  while (p < (int)json.length() &&
         (json[p]==' '||json[p]=='\n'||json[p]=='\r'||json[p]=='\t')) p++;
  if (p >= (int)json.length() || json.startsWith("null", p)) return false;
  unsigned long val = 0; bool any = false;
  for (; p < (int)json.length(); p++) {
    char c = json[p];
    if (c<'0'||c>'9') break;
    any = true;
    val = val*10ul + (unsigned long)(c-'0');
  }
  if (!any) return false;
  out = val; return true;
}

static bool containsIgnoreCase(const String &haystack, const char *needle) {
  String h = haystack, n = String(needle);
  h.toLowerCase(); n.toLowerCase();
  return h.indexOf(n) >= 0;
}

// ---------- State machine ----------
enum class State { STOPPED_WAIT_S1, RUNNING, STOPPED_WAIT_QR, RUN_TO_S3 };
State state = State::STOPPED_WAIT_S1;
unsigned long lastSeenCaptureUpdatedAt = 0;
static unsigned long qrWaitStart = 0;
static const unsigned long QR_TIMEOUT_MS = 15000;

// DHT refresh interval
static unsigned long lastDhtMs = 0;
static const unsigned long DHT_INTERVAL_MS = 3000;

// Telemetry POST interval
static unsigned long lastTelemetryMs = 0;
static const unsigned long TELEMETRY_INTERVAL_MS = 2000;

static int pollQrDecision() {
  if (millis() - qrWaitStart >= QR_TIMEOUT_MS) {
    Serial.println("!! QR wait timeout.");
    return -1;
  }
  static unsigned long lastPollMs = 0;
  if (millis() - lastPollMs < 250) return 0;
  lastPollMs = millis();

  String json = httpGetLastCaptureJson();
  if (json.length() == 0) return 0;

  String status, qrText;
  unsigned long updatedAt = 0;
  if (!jsonExtractString(json, "status", status))       return 0;
  if (!jsonExtractNumber(json, "updatedAt", updatedAt)) return 0;
  if (updatedAt <= lastSeenCaptureUpdatedAt)            return 0;
  if (status != "decoded")                              return 0;
  if (!jsonExtractString(json, "qrText", qrText))       return 0;

  lastSeenCaptureUpdatedAt = updatedAt;
  Serial.println(">> QR decoded: " + qrText);

  if (containsIgnoreCase(qrText, "Category B")) {
    lastCategory = "Category B";
    postBeltEvent("qr_decision", "stopped", qrText, "Decision=Category B");
    return 2;
  }
  if (containsIgnoreCase(qrText, "Category A")) {
    lastCategory = "Category A";
    postBeltEvent("qr_decision", "stopped", qrText, "Decision=Category A");
    return 1;
  }

  Serial.println("!! QR did not match Category A/B. Still waiting...");
  return 0;
}

// ---------- setup ----------
void setup() {
  Serial.begin(115200);
  delay(300);

  // I2C + LCD
  Wire.begin(LCD_SDA, LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdStatus("Booting...");
  lcdPrint(1, "");

  // DHT22
  dht.begin();

  // Stepper
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN,  OUTPUT);
  digitalWrite(DIR_PIN, HIGH);

  // IR sensors (3-pin modules drive output themselves)
  pinMode(IR_SENSOR_1, IR_USE_PULLUP ? INPUT_PULLUP : INPUT);
  pinMode(IR_SENSOR_2, IR_USE_PULLUP ? INPUT_PULLUP : INPUT);
  pinMode(IR_SENSOR_3, IR_USE_PULLUP ? INPUT_PULLUP : INPUT);

  // Servo
  const bool servoOk = ledcAttach(SERVO_PIN, SERVO_FREQ_HZ, SERVO_LEDC_BITS);
  Serial.printf("[SERVO] ledcAttach(pin=%d,f=%d,bits=%d) => %s\n", SERVO_PIN, SERVO_FREQ_HZ, SERVO_LEDC_BITS,
                servoOk ? "OK" : "FAIL");
  setGateClosed();

  Serial.println("Conveyor Belt + Gate System ready");

  connectWiFi();
  postBeltEvent("boot", "stopped", "", "boot: gate default closed");

  lcdStatus("Wait for S1");
  lcdUpdateBottom();
  Serial.println("Waiting for S1...");
}

// ---------- loop ----------
void loop() {
  ensureWiFi();

  // Refresh DHT on bottom row every 3 seconds
  if (millis() - lastDhtMs >= DHT_INTERVAL_MS) {
    lastDhtMs = millis();
    lcdUpdateBottom();
  }

  // Post telemetry (LCD lines + latest DHT values) every 2 seconds
  if (millis() - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = millis();
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    postTelemetry(t, h);
  }

  const bool s1 = readSensor(IR_SENSOR_1);
  const bool s2 = readSensor(IR_SENSOR_2);
  const bool s3 = readSensor(IR_SENSOR_3);

  // ── S3 emergency stop while running ─────────────────────────────────────────
  if ((state == State::RUNNING || state == State::RUN_TO_S3) && s3) {
    stopBelt();
    postBeltEvent("sensor_s3_stop", "stopped", "", "S3 stop");
    lcdStatus("S3 Stop");
    lcdUpdateBottom();
    state = State::STOPPED_WAIT_S1;
    waitSensorClear(IR_SENSOR_3);
    lcdStatus("Wait for S1");
    Serial.println("Waiting for S1...");
    return;
  }

  // ── S3 during QR wait ────────────────────────────────────────────────────────
  if (state == State::STOPPED_WAIT_QR && s3) {
    stopBelt();
    postBeltEvent("sensor_s3_emergency", "stopped", "", "S3 during QR wait");
    lcdStatus("S3 Emergency!");
    lcdUpdateBottom();
    state = State::STOPPED_WAIT_S1;
    waitSensorClear(IR_SENSOR_3);
    lcdStatus("Wait for S1");
    Serial.println("Waiting for S1...");
    return;
  }

  // ── STOPPED_WAIT_S1 ──────────────────────────────────────────────────────────
  if (state == State::STOPPED_WAIT_S1) {
    if (s1) {
      Serial.println("S1 TRIGGERED → Belt STARTING");
      startBelt();
      postBeltEvent("sensor_s1_start", "running", "", "S1 start");
      lcdStatus("Belt Running");
      lcdUpdateBottom();
      state = State::RUNNING;
    }
    return;
  }

  // ── RUNNING: S2 decision point ───────────────────────────────────────────────
  if (state == State::RUNNING && s2) {
    stopBelt();
    postBeltEvent("sensor_s2_stop", "stopped", "", "S2 stop; awaiting QR");
    lcdStatus("Scanning QR...");
    lcdUpdateBottom();
    waitSensorClear(IR_SENSOR_2);
    qrWaitStart = millis();
    state = State::STOPPED_WAIT_QR;
    return;
  }

  // ── STOPPED_WAIT_QR ──────────────────────────────────────────────────────────
  if (state == State::STOPPED_WAIT_QR) {
    int result = pollQrDecision();
    if (result == 0) return;

    if (result == -1) {
      lcdStatus("QR Timeout");
      lcdUpdateBottom();
      state = State::STOPPED_WAIT_S1;
      lcdStatus("Wait for S1");
      Serial.println("Waiting for S1...");
      return;
    }

    if (result == 2) {
      // Category B → open gate, restart belt
      Serial.println("[QR] Category B -> gate OPEN");
      setGateOpen();
      postBeltEvent("gate_set", "stopped", "", "Category B => gate open");
      lcdStatus("Cat B: Gate Open");
      lcdUpdateBottom();
      startBelt();
      postBeltEvent("belt_start", "running", "", "Category B => run to S3");
      state = State::RUN_TO_S3;
      return;
    }

    if (result == 1) {
      // Category A → keep gate as-is, restart belt (continue normal flow)
      Serial.println("[QR] Category A -> gate unchanged");
      lcdStatus("Cat A: Running");
      lcdUpdateBottom();
      startBelt();
      postBeltEvent("belt_start", "running", "", "Category A => resume belt (gate unchanged)");
      state = State::RUNNING;
      return;
    }
  }

  // ── Motor stepping ───────────────────────────────────────────────────────────
  if ((state == State::RUNNING || state == State::RUN_TO_S3) && beltRunning) {
    stepMotorNonBlocking();
  }

  // ── S2 during RUN_TO_S3 ──────────────────────────────────────────────────────
  if (state == State::RUN_TO_S3 && s2) {
    stopBelt();
    postBeltEvent("sensor_s2_recheck", "stopped", "", "S2 during RUN_TO_S3");
    lcdStatus("Scanning QR...");
    lcdUpdateBottom();
    waitSensorClear(IR_SENSOR_2);
    qrWaitStart = millis();
    state = State::STOPPED_WAIT_QR;
  }
}

