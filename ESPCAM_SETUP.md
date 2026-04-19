# ESP32-CAM Setup Guide (Arduino IDE)

Complete instructions for flashing the ESP32-CAM scanner using Arduino IDE instead of PlatformIO.

## Prerequisites

1. **Arduino IDE** 2.x (latest) — https://www.arduino.cc/en/software
2. **ESP32 board support** — Install via Board Manager
3. **USB-to-Serial adapter** (if your ESP32-CAM doesn't have built-in USB)

---

## Step 1: Install ESP32 Board Support

1. Open Arduino IDE → File → Preferences
2. In "Additional Boards Manager URLs", add:
   ```
   https://dl.espressif.com/dl/package_esp32_index.json
   ```
3. Tools → Board → Boards Manager
4. Search "esp32" → Install "esp32 by Espressif Systems"

---

## Step 2: Install Required Libraries

In Arduino IDE → Tools → Manage Libraries:

| Library | Version |
|---------|---------|
| **ArduinoJson** | 7.x (by Bblanchon) |
| **ZXing** | (optional, see below) |

**Note on ZXing Library:** The official ZXing Arduino library is outdated. You have two options:

### Option A: Use Quirc (QR Codes Only)

Simpler, lighter (~50KB). Only scans QR codes, not barcodes.

1. Download ZBar/quirc: https://github.com/dlbeer/quirc
2. Extract `quirc.h` and `quirc.c` into your sketch folder
3. Modify `main.cpp` to use `quirc` instead of `ZXing`

### Option B: Use ZXing-Cpp via Manual Install (Recommended for QR + Barcodes)

1. Download ZXing-Cpp: https://github.com/nu-book/zxing-cpp
2. Rename the extracted folder to `zxing-cpp`
3. Place it in: `~/Arduino/libraries/` (create if missing)
4. Restart Arduino IDE

---

## Step 3: Select Board Settings

**Tools → Board:**
```
ESP32 Arduino → AI-Thinker ESP32-CAM
```

**Tools → Partition Scheme:**
```
Minimal SPIFFS (1.9MB APP)  ← Recommended
```
(Allocates enough flash for ZXing-Cpp + ArduinoJson + your code)

**Tools → Core Debug Level:**
```
None
```

---

## Step 4: Wiring

### Wiring Diagrams

| ESP32-CAM Pin | Function | Connection |
|---------------|----------|------------|
| 5V | Power | 5V 2A PSU (NOT 3.3V) |
| GND | Ground | PSU GND |
| U0R | Serial TX | USB-TTL RX |
| U0T | Serial RX | USB-TTL TX |
| GPIO0 | Boot mode | Must be **LOW** when flashing, then **HIGH** (floating) for runtime |
| GPIO4 | Flash LED | Onboard LED (output) |

**Important:** Many ESP32-CAM modules have a built-in voltage regulator. Power via the **5V pin**, not 3.3V. Camera needs 5V.

### Programming with USB-TTL

If your ESP32-CAM doesn't have built-in USB:

1. Connect USB-TTL adapter:
   - TX → U0R (GPIO3)
   - RX → U0T (GPIO2)
   - GND → GND
   - 5V → 5V
2. To enter flash mode: hold GPIO0 LOW, press RESET button (or power cycle), then release GPIO0

---

## Step 5: Configure Sketch

Open `esp32-cam-scanner.ino` in Arduino IDE and update:

```cpp
// WiFi credentials
#define WIFI_SSID     "YOUR_SSID"
#define WIFI_PASSWORD "YOUR_PASSWORD"

// Your Vercel-deployed Next.js API URL
#define API_URL       "https://your-app.vercel.app/api/scan"

// Optional API key (must match .env.local in Vercel)
#define API_KEY       "your-secret-key"

// Belt identifier
#define BELT_ID       "Belt-1"
```

**Camera pins** — already configured for AI-Thinker module in the sketch.

---

## Step 6: Flash Firmware

1. Select correct COM port (Tools → Port)
2. Click **Upload** (arrow button)
3. Wait for "Hard resetting via RTS pin..." message
4. Open Serial Monitor (115200 baud) to see logs

**Expected output:**
```
INFO: Connecting to WiFi...
INFO: WiFi connected. IP: 192.168.1.123
INFO: Camera initialized successfully
INFO: System ready. Starting scan loop...
```

---

## Step 7: Test Scan

1. Point camera at a QR code or barcode
2. Flash LED should blink twice (success)
3. Serial monitor should show:
   ```
   SCAN: Code detected - BOX-12345
   INFO: POST successful (HTTP 200)
   ```
4. Check Vercel function logs or Azure SQL table for new row

---

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| Camera init error 0x20002 | Invalid camera config/pins | Verify board selection matches your module |
| SPIFFS write error | Wrong partition scheme | Switch to "Minimal SPIFFS (1.9MB)" |
| "conn.* state CLOSED" | DB connection failed | Check Azure firewall, enable "Allow Azure services" |
| Duplicate codes | Too short cooldown | Increase `DUPLICATE_COOLDOWN_MS` to 5000 |
| Blank/no decode | Poor lighting | Adjust camera brightness/contrast, add external LED |
| ESP32 crashes after decode | Out of memory | Reduce frame size to `FRAMESIZE_QVGA`, not VGA |
| Can't connect WiFi | Wrong credentials | Serial monitor will show "." during connection attempt |

---

## Optimizing Scan Performance

### For Fast Conveyor Belts

```cpp
const int SCAN_INTERVAL_MS = 300;  // Scan every 300ms instead of 500
sensor->set_exposure_ctrl(sensor, 1); // Keep auto-exposure on for motion blur reduction
```

### For Low Light

```cpp
#define FLASH_LED_PIN 4  // Already defined in sketch
// The sketch automatically uses flash on each successful detection
// Add continuous low-power LED: set GPIO4 HIGH in setup() for constant illumination
```

### For Small Barcodes

```cpp
config.frame_size = FRAMESIZE_VGA;  // 640x480 — more detail
sensor->set_sharpness(sensor, 3);   // Increase edge enhancement
```

---

## Production Deployment Checklist

- [ ] Change default passwords / API key
- [ ] Set `API_KEY` in Vercel env vars and in sketch
- [ ] Update `BELT_ID` if using multiple belts
- [ ] Adjust `DUPLICATE_COOLDOWN_MS` for your conveyor speed
- [ ] Secure power supply (5V 2A regulated, not USB)
- [ ] Mount camera enclosure to protect from dust
- [ ] Add physical reset button (GPIO0 to GND momentary)
- [ ] Verify Azure SQL connection pool size sufficient for your load

---

## Alternative: Server-Side Decoding (No Local Library)

If ZXing-Cpp/Quirc won't fit in flash:

1. Comment out `decodeBarcode()` call in `loop()`
2. Instead, capture frame and send **base64-encoded JPEG** directly to API
3. API decodes image server-side (Node.js with `@zxing/library`)

**Pros:** No heavy decoding libraries on ESP32.  
**Cons:** Larger HTTP payload (~5-10KB per scan), more bandwidth, more latency.

Contact me if you need that variant.

---

**Questions?** Check `README.md` for full architecture and cost breakdown.
