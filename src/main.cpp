/*========================================================================
 * Smart Warehouse ESP32-CAM Scanner with ZXing-Cpp
 * Supports QR codes AND barcodes (Code 128, EAN-13, UPC-A, etc.)
 *
 * INSTALLATION - PlatformIO (Recommended)
 * =========================================
 * 1. Install PlatformIO IDE (VSCode extension) or use command line
 * 2. Copy this file to src/main.cpp
 * 3. Copy platformio.ini to project root
 * 4. Run: pio run -t upload -t monitor
 *
 * WIRING (AI-Thinker ESP32-CAM)
 * ==============================
 * Camera already wired on module. Just connect:
 *   - GPIO0 must be LOW when flashing, HIGH for runtime
 *   - 5V power (camera needs 5V, not 3.3V)
 *
 *========================================================================*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

// ============================================================
// CAMERA PIN DEFINITIONS (AI-Thinker OV2640)
// ============================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ============================================================
// USER CONFIGURATION — EDIT THESE
// ============================================================

// WiFi credentials
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// API endpoint — point to your Next.js deployment
// Local dev:    "http://192.168.1.x:3000/api/scan"
// Vercel prod:  "https://your-app.vercel.app/api/scan"
const char* API_URL = "https://your-app.vercel.app/api/scan";

// Belt identifier shown in the dashboard
const char* BELT_ID = "Belt-1";

// Scan timing
const int SCAN_INTERVAL_MS      = 500;   // ms between scan attempts
const int DUPLICATE_COOLDOWN_MS = 3000;  // suppress re-scan of same code
const int WIFI_RETRY_INTERVAL_MS = 5000;

// ============================================================
// GLOBAL STATE
// ============================================================

const int FLASH_LED_PIN = 4;

String lastScannedCode = "";
unsigned long lastScanTime = 0;
unsigned long lastWifiAttempt = 0;
bool cameraOK = false;

// ============================================================
// ZXING-CPP DECODER
// Install: pio lib install "ZXing"
// ============================================================

#if __has_include(<ZXing/ReadBarcode.h>)
  #include <ZXing/ReadBarcode.h>
  using namespace ZXing;

  String decodeBarcode(camera_fb_t* fb) {
    if (!fb) return "";
    try {
      ImageView image(fb->buf, fb->width, fb->height, ImageFormat::Lum);
      DecodeHints hints;
      hints.setTryHarder(true);
      hints.setTryRotate(true);
      auto results = ReadBarcodes(image, hints);
      if (!results.empty() && results[0].isValid()) {
        String text = results[0].text().c_str();
        text.trim();
        return text;
      }
    } catch (const std::exception& e) {
      Serial.printf("WARN: Decode exception: %s\n", e.what());
    } catch (...) {}
    return "";
  }

#else
  #error "ZXing library not found. Install with: pio lib install 'ZXing'"
#endif

// ============================================================
// CAMERA INITIALIZATION
// ============================================================

bool initCamera() {
  camera_config_t config;

  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;

  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_GRAYSCALE; // Grayscale for ZXing
  config.frame_size   = FRAMESIZE_QVGA;      // 320×240 — fast enough
  config.jpeg_quality = 12;
  config.fb_count     = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("ERROR: Camera init failed (0x%x)\n", err);
    return false;
  }

  // Tune sensor for overhead conveyor view
  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_brightness(sensor, 1);
    sensor->set_contrast(sensor, 1);
    sensor->set_saturation(sensor, 0);
    sensor->set_sharpness(sensor, 2);
    sensor->set_whitebal(sensor, 1);
    sensor->set_exposure_ctrl(sensor, 1);
    sensor->set_aec2(sensor, 1);
  }

  Serial.println("INFO: Camera OK");
  cameraOK = true;
  return true;
}

// ============================================================
// WIFI MANAGEMENT
// ============================================================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttempt < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttempt = now;

  Serial.print("INFO: Connecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(250);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nINFO: WiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nWARN: WiFi connection timeout");
  }
}

// ============================================================
// POST JSON SCAN TO API
//
// Sends: { "box_id": "...", "belt_id": "...",
//           "raw_payload": "...", "device_ip": "..." }
//
// Server expects Content-Type: application/json
// ============================================================

bool postScanToAPI(const String& box_id) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WARN: No WiFi — scan not sent");
    return false;
  }

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(15000);

  // Build JSON body — matches what /api/scan route.ts now reads
  StaticJsonDocument<256> doc;
  doc["box_id"]      = box_id;
  doc["belt_id"]     = BELT_ID;
  doc["raw_payload"] = box_id;          // decoded text is the payload
  doc["device_ip"]   = WiFi.localIP().toString();

  String body;
  serializeJson(doc, body);

  Serial.printf("INFO: POST %s\n", body.c_str());

  int httpCode = http.POST(body);
  String resp  = http.getString();
  http.end();

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("INFO: API OK (HTTP %d) → %s\n", httpCode, resp.c_str());
    return true;
  } else {
    Serial.printf("ERROR: API failed (HTTP %d) → %s\n", httpCode, resp.c_str());
    return false;
  }
}

// ============================================================
// LED FEEDBACK
// ============================================================

void indicateSuccess() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH); delay(100);
    digitalWrite(FLASH_LED_PIN, LOW);  delay(100);
  }
}

void indicateError() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH); delay(300);
    digitalWrite(FLASH_LED_PIN, LOW);  delay(300);
  }
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==========================================");
  Serial.println("  Smart Warehouse — ESP32-CAM Scanner");
  Serial.println("  QR + Barcode via ZXing-Cpp");
  Serial.println("==========================================");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  connectWiFi();

  if (!initCamera()) {
    Serial.println("FATAL: Camera init failed!");
    while (true) { indicateError(); delay(2000); }
  }

  Serial.println("INFO: System ready. Scanning...");
  indicateSuccess();
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  connectWiFi();

  unsigned long now = millis();
  if (now - lastScanTime < SCAN_INTERVAL_MS) return;

  // Capture frame
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("ERROR: Frame capture failed");
    return;
  }

  // Decode QR / barcode on-device
  String decoded = decodeBarcode(fb);
  esp_camera_fb_return(fb);

  if (decoded.length() == 0) return; // Nothing found

  // Duplicate suppression
  if (decoded == lastScannedCode &&
      (millis() - lastScanTime) < DUPLICATE_COOLDOWN_MS) {
    Serial.printf("INFO: Duplicate suppressed: %s\n", decoded.c_str());
    return;
  }

  lastScannedCode = decoded;
  lastScanTime    = millis();

  Serial.printf("SCAN: [%s] %s\n", BELT_ID, decoded.c_str());
  indicateSuccess();

  if (!postScanToAPI(decoded)) {
    indicateError();
  }

  delay(200);
}
