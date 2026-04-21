#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ESP32Servo.h>
#include "esp_camera.h"

// ============== WIFI CONFIG ==============
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// ============== MQTT CONFIG ==============
// HiveMQ Cloud credentials (from .env.local)
const char* mqttServer = "fd9d4523e84b4b22b1f3ff686ffbc123.s1.eu.hivemq.cloud";
const int mqttPort = 8883;  // SSL port for HiveMQ Cloud
const char* mqttUser = "Dilara";
const char* mqttPass = "Dilara@2005";
const char* beltId = "Belt-1";
const char* mqttClientId = "ESP32_CAM_SERVO_001";

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ============== SERVO CONFIG (GPIO 2) ==============
#define SERVO_PIN 2
Servo sliderServo;
const int SERVO_EXTENDED = 170;  // Push box to side (Category A)
const int SERVO_RETRACTED = 10;  // Original position (let box pass)
const int SERVO_DELAY_MS = 1000; // Time for servo to complete motion

// ============== CAMERA PINS (AI-Thinker ESP32-CAM) ==============
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

// ============== STATE ==============
bool cameraReady = false;
String lastScannedCode = "";
unsigned long lastScanTime = 0;
const unsigned long SCAN_COOLDOWN_MS = 2000;

// ============== DETERMINE CATEGORY ==============
// Parse QR code to determine category (A or B)
// Format: "BOX-A-001" = Category A (slide), "BOX-B-001" = Category B (pass)
void determineCategoryAndAction(const String& qrData, String& category, String& action) {
  String upper = qrData;
  upper.toUpperCase();
  
  if (upper.startsWith("BOX-A") || upper.startsWith("A-") || upper.indexOf("-A-") >= 0) {
    category = "A";
    action = "SLIDE_A";
  } else if (upper.startsWith("BOX-B") || upper.startsWith("B-") || upper.indexOf("-B-") >= 0) {
    category = "B";
    action = "PASS_B";
  } else {
    // Default: treat as unknown, let pass
    category = "UNKNOWN";
    action = "PASS_B";
  }
}

// ============== EXECUTE SERVO ACTION ==============
void executeServoAction(const String& action) {
  if (action == "SLIDE_A") {
    Serial.println("[SERVO] Pushing box to Category A...");
    sliderServo.write(SERVO_EXTENDED);
    delay(SERVO_DELAY_MS);
    sliderServo.write(SERVO_RETRACTED);
    Serial.println("[SERVO] Returned to start position");
  } else {
    Serial.println("[SERVO] Letting box pass to Category B (no action)");
  }
}

// ============== MQTT CALLBACK ==============
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.printf("[MQTT] Received - Topic: %s | Message: %s\n", topicStr.c_str(), message.c_str());

  // Handle servo commands from web app (manual override)
  if (topicStr.endsWith("/servo")) {
    if (message == "SLIDE_A") {
      executeServoAction("SLIDE_A");
    } else if (message == "PASS_B") {
      executeServoAction("PASS_B");
    } else if (message == "TEST") {
      // Test servo movement
      executeServoAction("SLIDE_A");
    }
  }
}

// ============== RECONNECT MQTT ==============
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    
    // Use HiveMQ Cloud credentials
    if (mqttClient.connect(mqttClientId, mqttUser, mqttPass)) {
      Serial.println("connected");
      
      String scanTopic = String("warehouse/") + beltId + "/scan";
      String servoTopic = String("warehouse/") + beltId + "/servo";
      
      mqttClient.subscribe(scanTopic.c_str());
      mqttClient.subscribe(servoTopic.c_str());
      
      Serial.printf("[MQTT] Subscribed: %s, %s\n", scanTopic.c_str(), servoTopic.c_str());
    } else {
      Serial.printf(" failed (rc=%d), retry in 5s...\n", mqttClient.state());
      delay(5000);
    }
  }
}

// ============== PUBLISH SCAN ==============
void publishScan(const String& boxId, const String& category, const String& action) {
  String topic = String("warehouse/") + beltId + "/scan";
  String payload = "{\"box_id\":\"" + boxId + "\",\"category\":\"" + category + "\",\"action\":\"" + action + "\",\"belt_id\":\"" + beltId + "\"}";
  
  mqttClient.publish(topic.c_str(), payload.c_str());
  Serial.printf("[MQTT] Published scan: %s\n", payload.c_str());
}

// ============== CAMERA INIT ==============
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
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
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 2;

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

  Serial.println("[CAM] Camera ready");
  return true;
}

// ============== QR DECODE (PLACEHOLDER) ==============
// In production: Use ZXing library to decode actual QR from camera frame
// This function simulates QR detection for testing
String decodeQRCode() {
  // TODO: Implement actual QR decoding using ZXing or similar library
  // 
  // Example with ZXing:
  //   #include <ZXing/ReadBarcode.h>
  //   using namespace ZXing;
  //   
  //   ImageView image(fb->buf, fb->width, fb->height, ImageFormat::Lum);
  //   auto results = ReadBarcodes(image);
  //   if (!results.empty() && results[0].isValid()) {
  //     return results[0].text().c_str();
  //   }
  
  // Simulate different box types appearing on conveyor
  // In real implementation: return "" if no QR found
  int r = random(0, 4);
  if (r == 0) return "BOX-A-001";
  if (r == 1) return "BOX-A-002";
  if (r == 2) return "BOX-B-001";
  return "BOX-B-002";
}

// ============== WIFI CONNECT ==============
void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(ssid);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection failed!");
  }
}

// ============== SETUP ==============
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("  ESP32-CAM QR Scanner + Servo Control");
  Serial.println("  Category A -> Slide to side");
  Serial.println("  Category B -> Let pass through");
  Serial.println("========================================");

  // Initialize servo at retracted position
  sliderServo.attach(SERVO_PIN, 500, 2400);
  sliderServo.write(SERVO_RETRACTED);
  delay(500);
  Serial.println("[SERVO] Initialized on GPIO 2");

  // Connect to WiFi
  connectWiFi();

  // Setup MQTT
  mqttClient.setServer(mqttServer, mqttPort);
  mqttClient.setCallback(mqttCallback);
  reconnectMQTT();

  // Initialize camera
  cameraReady = initCamera();
  if (!cameraReady) {
    Serial.println("[ERROR] Camera init failed!");
  }

  Serial.println("[SYSTEM] Ready - Scanning for QR codes...");
}

// ============== LOOP ==============
void loop() {
  // Maintain MQTT connection
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // Wait for cooldown
  unsigned long now = millis();
  if (!cameraReady || (now - lastScanTime) < SCAN_COOLDOWN_MS) {
    delay(100);
    return;
  }

  // Capture camera frame
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Frame capture failed");
    return;
  }

  // Decode QR code (placeholder - replace with ZXing in production)
  String qrData = decodeQRCode();
  
  esp_camera_fb_return(fb);

  if (qrData.length() == 0) {
    return;  // No QR code found
  }

  // Skip duplicate scans
  if (qrData == lastScannedCode && (now - lastScanTime) < 5000) {
    Serial.printf("[SCAN] Duplicate suppressed: %s\n", qrData.c_str());
    return;
  }

  // Determine category and action
  String category, action;
  determineCategoryAndAction(qrData, category, action);

  // Execute servo action
  executeServoAction(action);

  // Publish scan result to MQTT
  publishScan(qrData, category, action);

  Serial.printf("[SCAN] Box: %s | Category: %s | Action: %s\n", 
                qrData.c_str(), category.c_str(), action.c_str());

  lastScannedCode = qrData;
  lastScanTime = now;
  
  delay(500);
}