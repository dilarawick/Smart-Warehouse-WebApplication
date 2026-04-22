#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include "esp_camera.h"
#include <WiFiClientSecure.h>

// ============== WIFI CONFIG ==============
const char* ssid     = "";
const char* password = "";

// ============== MQTT CONFIG ==============
const char* mqttServer = "fd9d4523e84b4b22b1f3ff686ffbc123.s1.eu.hivemq.cloud";
const int mqttPort = 8883; // HiveMQ Cloud TLS port
const char* mqttUser = "Dilara"; // set to your HiveMQ Cloud user
const char* mqttPass = "Dilara@2005"; // set to your HiveMQ Cloud password
const char* beltId       = "Belt-1";
const char* mqttClientId = "ESP32_CAM_SERVO_001";

WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// ============== SERVO CONFIG ==============
#define SERVO_PIN        13
Servo sliderServo;
const int SERVO_EXTENDED  = 170;
const int SERVO_RETRACTED = 10;

// Non-blocking servo state
bool          servoActive     = false;
unsigned long servoStartTime  = 0;
const unsigned long SERVO_HOLD_MS = 1000;

// ============== CAMERA PINS (AI-Thinker) ==============
#define PWDN_GPIO_NUM   32
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM    0
#define SIOD_GPIO_NUM   26
#define SIOC_GPIO_NUM   27
#define Y9_GPIO_NUM     35
#define Y8_GPIO_NUM     34
#define Y7_GPIO_NUM     39
#define Y6_GPIO_NUM     36
#define Y5_GPIO_NUM     21
#define Y4_GPIO_NUM     19
#define Y3_GPIO_NUM     18
#define Y2_GPIO_NUM      5
#define VSYNC_GPIO_NUM  25
#define HREF_GPIO_NUM   23
#define PCLK_GPIO_NUM   22

// On AI-Thinker boards the onboard flash LED is usually on GPIO 4
#define FLASH_LED_PIN 4

// ============== HTTP SERVER ==============
WebServer server(80);

void handleFrame() {
  // Turn on flash LED briefly while capturing to improve exposure
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(80); // small delay to let LED light up
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);
  if (!fb) { server.send(503, "text/plain", "Capture failed"); return; }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ============== STATE MACHINE ==============
enum ScanState { IDLE, WAITING_RESPONSE };
ScanState    scanState       = IDLE;
unsigned long scanRequestTime = 0;
const unsigned long SCAN_TIMEOUT_MS  = 5000;
const unsigned long SCAN_COOLDOWN_MS = 2000;
unsigned long lastScanTime   = 0;
String        currentScanId  = "";
bool          cameraReady    = false;

// ============== BASE64 ENCODER ==============
// Needed to embed JPEG frames directly in MQTT payload
static const char b64chars[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

String base64Encode(const uint8_t* data, size_t len) {
  String out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    uint32_t b = (uint32_t)data[i] << 16;
    if (i + 1 < len) b |= (uint32_t)data[i + 1] << 8;
    if (i + 2 < len) b |= data[i + 2];
    out += b64chars[(b >> 18) & 0x3F];
    out += b64chars[(b >> 12) & 0x3F];
    out += (i + 1 < len) ? b64chars[(b >> 6) & 0x3F] : '=';
    out += (i + 2 < len) ? b64chars[b & 0x3F]        : '=';
  }
  return out;
}

// ============== SERVO (NON-BLOCKING) ==============
void triggerSlideA() {
  if (servoActive) return;
  Serial.println("[SERVO] Extending for SLIDE_A");
  sliderServo.write(SERVO_EXTENDED);
  servoActive    = true;
  servoStartTime = millis();
}

void updateServo() {
  if (servoActive && (millis() - servoStartTime >= SERVO_HOLD_MS)) {
    sliderServo.write(SERVO_RETRACTED);
    servoActive = false;
    Serial.println("[SERVO] Retracted");
  }
}

// ============== MQTT CALLBACK ==============
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  char message[256] = {0};
  unsigned int msgLen = min(length, (unsigned int)(sizeof(message) - 1));
  memcpy(message, payload, msgLen);

  Serial.printf("[MQTT] Topic: %s | Msg: %s\n", topic, message);
 

  // Manual servo control
  if (strstr(topic, "/servo") != nullptr) {
    if (strcmp(message, "SLIDE_A") == 0 || strcmp(message, "TEST") == 0) {
      triggerSlideA();
    } else if (strcmp(message, "PASS_B") == 0) {
      Serial.println("[SERVO] PASS_B - no action");
    }
    return;
  }

  // Action response - must match current scan ID exactly
  if (strstr(topic, "/scan/action") != nullptr && scanState == WAITING_RESPONSE) {
    // Extract "id" field value from JSON for exact match
    String msg(message);
    String idKey = "\"id\":\"" + currentScanId + "\"";

    if (msg.indexOf(idKey) == -1) {
      Serial.println("[MQTT] Ignored - scan ID mismatch");
      return;
    }

    if (msg.indexOf("\"action\":\"SLIDE_A\"") != -1) {
      triggerSlideA();
      Serial.println("[MQTT] Action: SLIDE_A");
    } else if (msg.indexOf("\"action\":\"PASS_B\"") != -1) {
      Serial.println("[MQTT] Action: PASS_B - letting box through");
    }

    scanState    = IDLE;
    lastScanTime = millis();
  }
}

// ============== WIFI (with reconnect) ==============
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] Reconnecting");
  WiFi.disconnect();
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed!");
  }
}

// ============== MQTT RECONNECT ==============
unsigned long lastMQTTReconnectAttempt = 0;
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

bool reconnectMQTT() {
  if (mqttClient.connected()) return true;
  unsigned long now = millis();
  if (now - lastMQTTReconnectAttempt < MQTT_RECONNECT_INTERVAL_MS) return false;
  lastMQTTReconnectAttempt = now;

  Serial.print("[MQTT] Connecting...");
  bool ok = mqttUser
    ? mqttClient.connect(mqttClientId, mqttUser, mqttPass)
    : mqttClient.connect(mqttClientId);

  if (ok) {
    char buf[64];
    snprintf(buf, sizeof(buf), "warehouse/%s/servo",      beltId); mqttClient.subscribe(buf);
    snprintf(buf, sizeof(buf), "warehouse/%s/scan/action", beltId); mqttClient.subscribe(buf);
    Serial.println("connected & subscribed");
  } else {
    Serial.printf("failed rc=%d\n", mqttClient.state());
  }
  return ok;
}

// ============== PUBLISH SCAN (frame embedded) ==============
void publishScanTrigger() {
  if (scanState != IDLE || !mqttClient.connected()) return;

  // Build a lightweight payload that includes an HTTP frame URL
  // The server will fetch the frame over HTTP instead of sending base64 via MQTT.
  currentScanId = String(millis());
  String espIp = WiFi.localIP().toString();
  String frameUrl = "http://" + espIp + "/frame";
  String payload = "{\"id\":\"" + currentScanId +
                   "\",\"belt_id\":\"" + beltId +
                   "\",\"frame_url\":\"" + frameUrl + "\"}";

  char topic[64];
  snprintf(topic, sizeof(topic), "warehouse/%s/scan", beltId);


  // Keep a larger buffer in case other messages are larger
  mqttClient.setBufferSize(20000);

  if (mqttClient.publish(topic, payload.c_str(), false)) {
    Serial.printf("[MQTT] Frame sent, scan ID: %s\n", currentScanId.c_str());
    scanState       = WAITING_RESPONSE;
    scanRequestTime = millis();
    lastScanTime    = millis();  // set ONLY on success
  } else {
    Serial.println("[MQTT] Publish FAILED (payload too large?)");
    // Don't update lastScanTime so we retry sooner
  }
}

// ============== CAMERA INIT ==============
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM; config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM; config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM; config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM; config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk  = XCLK_GPIO_NUM;
  config.pin_pclk  = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href  = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn  = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QVGA;
  config.jpeg_quality = 15;  // slightly lower = smaller payload
  config.fb_count     = 1;   // 1 buffer saves RAM
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed: 0x%x\n", err);
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 1);
    s->set_contrast(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_whitebal(s, 1);
  }
  Serial.println("[CAM] Ready");
  return true;
}

// ============== SETUP ==============
void setup() {
  Serial.begin(115200);
  delay(1000);

  sliderServo.attach(SERVO_PIN, 500, 2400);
  sliderServo.write(SERVO_RETRACTED);
  Serial.println("[SERVO] Ready on GPIO 13");

  // Initialize flash LED pin
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  ensureWiFi();

  // For HiveMQ Cloud TLS: allow insecure (no CA) quick-start. Replace with setCACert() in production.
  wifiClient.setInsecure();

  mqttClient.setServer(mqttServer, mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(20000);
  reconnectMQTT();

  cameraReady = initCamera();

  server.on("/",      HTTP_GET, []() { server.send(200, "text/plain", "ESP32-CAM Ready"); });
  server.on("/frame", HTTP_GET, handleFrame);
  server.begin();
  Serial.printf("[HTTP] http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("[SYSTEM] Ready");
}

// ============== LOOP ==============
void loop() {
  server.handleClient();
  ensureWiFi();
  reconnectMQTT();
  mqttClient.loop();
  updateServo();  // non-blocking servo tick

  unsigned long now = millis();

  // Timeout recovery
  if (scanState == WAITING_RESPONSE && (now - scanRequestTime) > SCAN_TIMEOUT_MS) {
    Serial.println("[WARN] Scan timeout - resetting");
    scanState    = IDLE;
    lastScanTime = millis();
  }

  // Trigger scan when idle and cooldown passed
  if (scanState == IDLE && cameraReady && (now - lastScanTime) >= SCAN_COOLDOWN_MS) {
    publishScanTrigger();
  }
}