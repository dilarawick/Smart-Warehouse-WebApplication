#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

// ====== USER SETTINGS ======
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";

// Your Next.js backend endpoint.
// If you are NOT deploying, run Next.js locally and use:
//   http://<YOUR_PC_LAN_IP>:3000/api/qr/scan
// Example (your current PC IPv4 from ipconfig):
//   http://10.124.192.48:3000/api/qr/scan
//
// If you DO deploy to App Service, use:
//   https://<your-app>.azurewebsites.net/api/qr/scan
const char* UPLOAD_URL = "http://10.124.192.48:3000/api/qr/scan";

// Optional: if your server sets API_KEY, put the same value here. Leave empty to disable.
const char* API_KEY = "";

// Device label stored in DB
const char* DEVICE_ID = "esp32cam-01";

// ====== CAMERA PINS (AI Thinker) ======
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

#define FLASH_LED_PIN 4

static bool initCamera() {
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

  // Good starting point for QR readability vs upload size:
  config.frame_size = FRAMESIZE_VGA; // 640x480
  config.jpeg_quality = 10;          // lower = better quality, bigger file
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] init failed: 0x%x\n", err);
    return false;
  }
  return true;
}

static void connectWiFi() {
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
}

static bool postJpeg(const uint8_t* data, size_t len) {
  String url = String(UPLOAD_URL);
  const bool isHttps = url.startsWith("https://");
  const bool isHttp = url.startsWith("http://");
  if (!isHttps && !isHttp) {
    Serial.println("[HTTP] UPLOAD_URL must start with http:// or https://");
    return false;
  }

  // Parse host + path
  int hostStart = isHttps ? 8 : 7; // after https:// or http://
  int pathStart = url.indexOf('/', hostStart);
  String host = (pathStart == -1) ? url.substring(hostStart) : url.substring(hostStart, pathStart);
  String path = (pathStart == -1) ? "/" : url.substring(pathStart);

  int port = isHttps ? 443 : 80;
  String hostOnly = host;
  int colon = host.indexOf(':');
  if (colon != -1) {
    hostOnly = host.substring(0, colon);
    port = host.substring(colon + 1).toInt();
    if (port <= 0) port = isHttps ? 443 : 80;
  }

  WiFiClient* clientPtr = nullptr;
  WiFiClient client;
  WiFiClientSecure secureClient;
  if (isHttps) {
    secureClient.setInsecure(); // for production, validate TLS cert
    secureClient.setTimeout(15);
    clientPtr = &secureClient;
  } else {
    client.setTimeout(15);
    clientPtr = &client;
  }

  if (!clientPtr->connect(hostOnly.c_str(), port)) {
    Serial.println("[HTTP] connect failed");
    return false;
  }

  clientPtr->print(String("POST ") + path + " HTTP/1.1\r\n");
  clientPtr->print(String("Host: ") + hostOnly + "\r\n");
  clientPtr->print("Connection: close\r\n");
  clientPtr->print("Content-Type: image/jpeg\r\n");
  clientPtr->print(String("Content-Length: ") + String(len) + "\r\n");
  clientPtr->print(String("x-device-id: ") + DEVICE_ID + "\r\n");
  if (String(API_KEY).length() > 0) {
    clientPtr->print(String("x-api-key: ") + API_KEY + "\r\n");
  }
  clientPtr->print("\r\n");
  clientPtr->write(data, len);

  // Read status line
  String statusLine = clientPtr->readStringUntil('\n');
  statusLine.trim();
  Serial.print("[HTTP] ");
  Serial.println(statusLine);

  // Simple success check
  bool ok = statusLine.indexOf("200") != -1;
  while (clientPtr->connected()) {
    while (clientPtr->available()) clientPtr->read();
    delay(10);
  }
  clientPtr->stop();
  return ok;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!initCamera()) {
    Serial.println("[SYSTEM] camera init failed");
    while (true) delay(1000);
  }

  connectWiFi();
  Serial.println("[SYSTEM] ready");
}

void loop() {
  // Capture with brief flash for better QR contrast
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(250);
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb) {
    Serial.println("[CAM] capture failed");
    delay(2000);
    return;
  }

  bool ok = postJpeg(fb->buf, fb->len);
  esp_camera_fb_return(fb);

  Serial.println(ok ? "[SYSTEM] uploaded" : "[SYSTEM] upload failed");

  // Avoid spamming uploads; tune as needed
  delay(2500);
}

