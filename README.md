# Smart Warehouse Web Application

A complete warehouse management system featuring an ESP32-CAM conveyor belt scanner that reads QR/barcodes and stores scan data in Azure SQL Database, with a real-time Next.js dashboard.

## Architecture

```text
ESP32-CAM → MQTT Broker → Next.js Subscriber → Azure SQL DB ← Live Dashboard Polling
    ↓             ↓
  Captures      Message
  image         Broker
    ↓             ↓
Decodes QR/     MQTT
barcode       Listener
    ↓             ↓
Publish       Stores in
scan to       database
topic             ↓
    ↓         Dashboard
LED Flash     updates every
on ACK        3 seconds
```

## Quick Start

### 1. Azure SQL Database Setup

```sql
-- Run in Azure Portal's Query Editor or SQL Server Management Studio
CREATE TABLE box_scans (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    box_id       VARCHAR(100) NOT NULL,
    scan_time    DATETIME2 DEFAULT GETDATE(),
    belt_id      VARCHAR(50) DEFAULT 'Belt-1',
    status       VARCHAR(20) DEFAULT 'ok', -- ok | duplicate | error
    raw_payload  VARCHAR(255),
    ip_address   VARCHAR(45)
);

-- Optional: Index for faster duplicate checks
CREATE INDEX idx_box_time ON box_scans(box_id, scan_time);
```

### 2. Next.js Backend & Frontend

```bash
# Create Next.js app
npx create-next-app@latest warehouse --typescript --app
cd warehouse

# Install MSSQL and MQTT drivers
npm install mssql mqtt
npm install -D @types/mssql

# Create files: lib/db.ts, lib/mqttSubscriber.ts, 
# app/api/scans/route.ts, app/page.tsx
# (see NEXTJS_SETUP.md for complete code)

# Run server (MQTT starts automatically)
npm run dev
```

Environment variables (set in Vercel dashboard):

| Variable | Description |
|----------|-------------|
| `AZURE_SQL_SERVER` | your-server.database.windows.net |
| `AZURE_SQL_DATABASE` | warehouse (or your DB name) |
| `AZURE_SQL_USER` | your-sql-admin-user |
| `AZURE_SQL_PASSWORD` | your-password |
| `MQTT_BROKER` | your-cluster.hivemq.cloud |
| `MQTT_USER` | your-hivemq-user |
| `MQTT_PASSWORD` | your-hivemq-password |

### 3. ESP32-CAM Firmware (PlatformIO)

1. Install [PlatformIO IDE](https://platformio.org/install) (VSCode extension)

2. Create new PlatformIO project:
   ```
   pio project init --board esp32cam --board-upload-port /dev/cu.SLAB_USBtoUART
   ```

3. Install libraries:
   ```
   pio lib install "ArduinoJson@^7.0.0"
   pio lib install "ZXing"
   ```

4. Copy `src/main.cpp` and `platformio.ini` from this repo

5. Configure WiFi & MQTT in `esp32-cam-scanner.ino`:
   ```cpp
   const char* WIFI_SSID = "YOUR_SSID";
   const char* WIFI_PASSWORD = "YOUR_PASS";
   const char* MQTT_BROKER = "your-cluster.hivemq.cloud";
   const int MQTT_PORT = 8883;
   ```

6. Flash:
   ```bash
   pio run -t upload
   pio run -t monitor
   ```

**Arduino IDE:** See `ESPCAM_SETUP.md` for manual installation steps.

### 4. Azure SQL Firewall

Azure Portal → SQL Server → Networking:
- Enable **"Allow Azure services and resources to access this server"**
- Or add Vercel's outbound IP ranges

### 5. Mount ESP32-CAM

- Position camera directly above conveyor (30-50cm height)
- Use flash LED (GPIO4) for consistent lighting
- Power: **5V 2A** minimum (camera needs 5V)
- GPIO0 must be HIGH (floating) during normal operation

## Configuration Tuning

```cpp
// Scan frequency
const int SCAN_INTERVAL_MS = 500;          // Check every 500ms
const int DUPLICATE_COOLDOWN_MS = 3000;    // Ignore repeats for 3s

// Camera
sensor->set_brightness(sensor, 1);  // -2 to +2
sensor->set_contrast(sensor, 1);    // -2 to +2
config.frame_size = FRAMESIZE_QVGA; // 320x240 (fast)
// config.frame_size = FRAMESIZE_VGA; // 640x480 (accurate)
```

## API Reference

## MQTT Usage
ESP32 publishes JSON payloads to `warehouse/<belt_id>/scan`.
Next.js subscribes to this topic and writes the scan into the DB.
The Subscriber also publishes an ACK to `warehouse/<belt_id>/scan/ack` which the ESP32 receives to flash its LED.

**MQTT Scan Payload:**
```json
{
  "box_id": "BOX-12345",
  "belt_id": "Belt-1",
  "raw_payload": "BOX-12345",
  "device_ip": "192.168.1.100"
}
```

### GET `/api/scans`

Polled by dashboard every 3s. Returns array of all scan records.

## File Structure

```
warehouse-app/           (Next.js app - separate)
├── app/
│   ├── page.tsx         ← Dashboard UI
│   └── api/
│       ├── scan/route.ts
│       └── scans/route.ts
├── lib/
│   ├── db.ts            ← Azure SQL pool
│   └── mqttSubscriber.ts ← MQTT ingest logic
└── .env.local

esp32-cam-project/       (ESP32 firmware)
├── src/
│   └── main.cpp         ← Scanner (this folder)
├── platformio.ini       ← Dependencies
└── partitions.csv       ← Flash layout
```

## Cost Estimate

| Resource | Tier | Monthly Cost |
|----------|------|--------------|
| Azure SQL DB | Basic (5 DTU) | ~$5 |
| Vercel (Next.js) | Hobby | $0 |
| ESP32-CAM power | 5V 1A | ~$1-2 |

**Total: ~$5/month**

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera init error 0x20002 | GPIO0 must be HIGH at runtime |
| POST timeouts | Enable Azure firewall rule |
| Duplicate scans | Increase `DUPLICATE_COOLDOWN_MS` |
| Poor scan rate | Add flash LED, ensure code in focus |
| Memory crashes | Use `FRAMESIZE_QVGA`, not VGA |

---

Built with ESP32, ZXing-Cpp, Next.js, Azure SQL.
