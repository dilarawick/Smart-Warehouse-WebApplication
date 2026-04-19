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
 * INSTALLATION - Arduino IDE
 * ==========================
 * Due to ZXing-Cpp complexity, PlatformIO is strongly recommended.
 * If using Arduino IDE, you must manually install:
 *   - esp32-camera (by Espressif) via Library Manager
 *   - ArduinoJson (by Bblanchon) via Library Manager
 *   - ZXing-Cpp from: https://github.com/nu-book/zxing-cpp (manual)
 *
 * WIRING (AI-Thinker ESP32-CAM)
 * ==============================
 * Camera already wired on module. Just connect:
 *   - GPIO1 (TX) and GPIO3 (RX) for Serial (optional debug)
 *   - GPIO0 must be LOW when flashing, then HIGH for runtime
 *   - 5V power (camera needs 5V, not 3.3V)
 *
 * PIN CONFIGURATION FOR DIFFERENT MODULES
 * ========================================
 * If using ESP32-CAM-MB (with built-in regulator) or different board,
 * update the CAMERA_MODEL_* define below.
 * See: https://github.com/espressif/esp32-camera-driver/tree/master/examples
 *
 *========================================================================*/

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

// ============================================================
// CAMERA MODEL CONFIGURATION
// ============================================================
// Define your ESP32-CAM model below:
// AI-Thinker (OV2640) — most common
// #define CAMERA_MODEL_WROVER_KIT
// #define CAMERA_MODEL_ESP_EYE
// #define CAMERA_MODEL_M5STACK_PSRAM
// #define CAMERA_MODEL_TTGO_T_JOURNAL

// Pin definitions for AI-Thinker module (hardcoded)
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
// USER CONFIGURATION - EDIT THESE
// ============================================================

// WiFi
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// API Settings
const char* API_URL = "https://your-app.vercel.app/api/scan";
const char* API_KEY = ""; // Set if you add API key auth
const char* BELT_ID = "Belt-1";

// Hardware
const int FLASH_LED_PIN = 4;
const int SCAN_INTERVAL_MS = 500;
const int DUPLICATE_COOLDOWN_MS = 3000;
const int WIFI_RETRY_INTERVAL_MS = 5000;

// ============================================================
// GLOBAL STATE
// ============================================================

String lastScannedCode = "";
unsigned long lastScanTime = 0;
unsigned long lastWifiAttempt = 0;
bool cameraOK = false;

// ============================================================
// ZXING-CPP DECODER SETUP
// ============================================================

// ZXing library required: pio lib install "ZXing"
#pragma message "Remember: Install ZXing library via: pio lib install 'ZXing'"

#if __has_include(<ZXing/ReadBarcode.h>)
  #include <ZXing/ReadBarcode.h>
  using namespace ZXing;

  String decodeBarcode(camera_fb_t* fb) {
    if (!fb) return "";
    try {
      ImageView image(fb->buf, fb->width, fb->height, ImageFormat::Lum);
      DecodeHints hints;
      hints.setTryHarder(true);
      Reader reader(BarcodeFormat::Any, hints);
      Result result = reader.decode(image);
      if (result.isValid()) {
        String text = result.text().c_str();
        text.trim();
        return text;
      }
    } catch (...) {}
    return "";
  }

#else
  // ZXing not installed — compile will fail
  #error "ZXing library not found. Install: pio lib install 'ZXing'"
#endif

// Convert camera frame buffer to ZXing ImageView
ImageView createImageView(camera_fb_t* fb) {
  // Camera is in GRAYSCALE, so each pixel is 1 byte
  return ImageView{fb->buf, fb->width, fb->height, ImageFormat::Lum};
}

String decodeBarcode(camera_fb_t* fb) {
  try {
    // Create image view from frame buffer
    ImageView image = createImageView(fb);
    
    // Configure reader - try all supported formats
    DecodeHints hints;
    hints.setTryHarder(true);  // More thorough, slower
    hints.setTryRotate(true);  // Try rotated images
    
    Reader reader(BarcodeFormat::Any, hints);
    Result result = reader.decode(image);
    
    if (result.isValid()) {
      String text = result.text().c_str();
      text.trim();
      return text;
    }
  } catch (const std::exception& e) {
    Serial.printf("WARN: Decode exception: %s\n", e.what());
  }
  
  return "";
}

// ============================================================
// CAMERA INITIALIZATION
// ============================================================

bool initCamera() {
  camera_config_t config;
  
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  
  #ifdef CAMERA_MODEL_AI_THINKER
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  #endif
  
  #ifdef CAMERA_MODEL_WROVER_KIT
  // Different pin mapping for WROVER
  #endif

  config.xclk_freq_hz = 20000000;
  
  // GRAYSCALE for faster decoding
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.frame_size = FRAMESIZE_QVGA; // 320x240
  config.jpeg_quality = 12;
  config.fb_count = 2; // Double buffering for smoother capture

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("ERROR: Camera init failed (0x%x)\n", err);
    return false;
  }

  // Optimize for overhead conveyor view
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
// API POST
// ============================================================

bool postScanToAPI(const String& boxId, const String& rawPayload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WARN: No WiFi - scan queued");
    return false;
  }

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  
  if (strlen(API_KEY) > 0) {
    http.addHeader("x-api-key", API_KEY);
  }
  
  http.setTimeout(15000); // 15s timeout for API call

  StaticJsonDocument<256> doc;
  doc["box_id"] = boxId;
  doc["belt_id"] = BELT_ID;
  doc["raw_payload"] = rawPayload;
  doc["device_ip"] = WiFi.localIP().toString();
  
  String body;
  serializeJson(doc, body);

  Serial.printf("INFO: POSTing %s\n", body.c_str());
  
  int httpCode = http.POST(body);
  
  if (httpCode >= 200 && httpCode < 300) {
    String resp = http.getString();
    Serial.printf("INFO: API OK (HTTP %d)\n", httpCode);
    http.end();
    return true;
  } else {
    Serial.printf("ERROR: API failed (HTTP %d)\n", httpCode);
    http.end();
    return false;
  }
}

// ============================================================
// LED FEEDBACK
// ============================================================

void indicateSuccess() {
  for (int i = 0; i < 2; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(100);
    digitalWrite(FLASH_LED_PIN, LOW);
    delay(100);
  }
}

void indicateError() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(300);
    digitalWrite(FLASH_LED_PIN, LOW);
    delay(300);
  }
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n==========================================");
  Serial.println("  Smart Warehouse - ESP32-CAM Scanner");
  Serial.println("  QR + Barcode Support via ZXing-Cpp");
  Serial.println("==========================================");

  // Flash LED
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // WiFi
  connectWiFi();

  // Camera
  if (!initCamera()) {
    Serial.println("FATAL: Camera init failed!");
    while (true) {
      indicateError();
      delay(2000);
    }
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
  if (now - lastScanTime < SCAN_INTERVAL_MS) {
    return;
  }
  
  // Capture frame
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("ERROR: Frame capture failed");
    return;
  }

  // Decode
  String decoded = decodeBarcode(fb);
  esp_camera_fb_return(fb);

  if (decoded.length() == 0) {
    return; // Nothing found
  }

  // Duplicate check
  if (decoded == lastScannedCode && 
      (millis() - lastScanTime) < DUPLICATE_COOLDOWN_MS) {
    Serial.printf("INFO: Duplicate suppressed: %s\n", decoded.c_str());
    return;
  }

  // Successful scan
  lastScannedCode = decoded;
  lastScanTime = millis();
  
  Serial.printf("SCAN: [%s] %s\n", BELT_ID, decoded.c_str());
  indicateSuccess();

  // POST to API
  if (!postScanToAPI(decoded, decoded)) {
    indicateError();
  }
  
  delay(200); // Brief pause
}
