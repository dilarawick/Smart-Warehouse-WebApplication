#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"
#include <PubSubClient.h>

// ========== WiFi ==========
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";

// ========== MQTT ==========
const char* MQTT_SERVER = "broker.hivemq.com";
const int MQTT_PORT = 1883;

WiFiClient espClient;
PubSubClient client(espClient);

// ========== Camera ==========
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

#define FLASH_LED_PIN 4

WebServer server(80);

// ========== STATE ==========
unsigned long lastPublish = 0;

// ========== MQTT CONNECT ==========
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.println("Connecting to MQTT...");
    if (client.connect("ESP32-CAM-WAREHOUSE")) {
      Serial.println("MQTT Connected");

      client.subscribe("warehouse/control");
    } else {
      delay(2000);
    }
  }
}

// ========== STREAM HANDLER ==========
void handleStream() {
  WiFiClient client = server.client();

  String response = "HTTP/1.1 200 OK\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  server.sendContent(response);

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) break;

    response = "--frame\r\nContent-Type: image/jpeg\r\n\r\n";
    server.sendContent(response);
    client.write(fb->buf, fb->len);
    server.sendContent("\r\n");

    esp_camera_fb_return(fb);
    delay(50);
  }
}

// ========== ROOT ==========
void handleRoot() {
  String html = "<h2>ESP32-CAM Smart Warehouse</h2>";
  html += "<p>Stream: /stream</p>";
  html += "<p>IP: " + WiFi.localIP().toString() + "</p>";
  server.send(200, "text/html", html);
}

// ========== CAMERA INIT ==========
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
  config.frame_size = FRAMESIZE_SVGA;
  config.jpeg_quality = 12;
  config.fb_count = 2;

  return esp_camera_init(&config) == ESP_OK;
}

// ========== EDGE AI SIMULATION ==========
String classifyBox() {
  // Simulated "edge intelligence"
  int val = random(0, 100);

  if (val < 50) return "A";
  else return "B";
}

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);

  pinMode(FLASH_LED_PIN, OUTPUT);

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected");
  Serial.println(WiFi.localIP());

  // MQTT
  client.setServer(MQTT_SERVER, MQTT_PORT);

  // Camera
  if (!initCamera()) {
    Serial.println("Camera Failed!");
    return;
  }

  // Web server
  server.on("/", handleRoot);
  server.on("/stream", handleStream);
  server.begin();

  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(200);
  digitalWrite(FLASH_LED_PIN, LOW);
}

// ========== LOOP ==========
void loop() {
  server.handleClient();

  if (!client.connected()) reconnectMQTT();
  client.loop();

  // publish every 3 seconds
  if (millis() - lastPublish > 3000) {
    lastPublish = millis();

    String category = classifyBox();

    Serial.println("Detected: " + category);

    // MAIN MQTT OUTPUT (to warehouse system)
    client.publish("warehouse/scan", category.c_str());

    // STATUS FEED (for dashboard)
    client.publish("warehouse/status", "CAM_ACTIVE");
  }
}