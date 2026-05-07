# Smart Warehouse IoT (ESP32‑CAM → Azure QR → Azure SQL)

This repo contains:

- `web/`: Next.js app (UI + API routes). The API accepts a JPEG, decodes a QR code server-side, and writes the decoded text to Azure SQL.
- `esp32/`: ESP32‑CAM Arduino sketch that captures a JPEG and uploads it to the Next.js backend.

## 1) Azure SQL setup

Run this SQL once in your Azure SQL Database:

```sql
CREATE TABLE dbo.QrScans (
  Id            INT IDENTITY(1,1) PRIMARY KEY,
  DeviceId      NVARCHAR(64) NOT NULL,
  QrText        NVARCHAR(2048) NOT NULL,
  ScannedAtUtc  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_QrScans_ScannedAtUtc ON dbo.QrScans(ScannedAtUtc DESC);
```

## 2) Next.js app (UI + Backend) — no deployment required

```bash
cd web
npm i
npm run dev
```

Copy `web/.env.local.example` to `web/.env.local` and fill:

```bash
SQL_CONNECTION_STRING=...
API_KEY=...
```

Open `http://localhost:3000`.

API endpoints (served by Next.js):

- `POST http://localhost:3000/api/qr/scan` (JPEG body, headers `x-api-key`, `x-device-id`)
- `GET  http://localhost:3000/api/qr/scans?limit=50`

### ESP32 → local PC backend

If you are **not deploying**, set the ESP32 `UPLOAD_URL` to your PC LAN IP (same Wi‑Fi):

- Example: `http://<your-host>:3000/api/qr/scan`

Your PC must allow inbound connections to port **3000** (Windows Firewall may prompt).

## 4) ESP32‑CAM

Open `esp32/esp32-cam-uploader.ino` in Arduino IDE.

Set:

- Wi‑Fi SSID/password
- `UPLOAD_URL` to your deployed Next.js endpoint: `https://<app>.azurewebsites.net/api/qr/scan`
- `API_KEY` to match the Next.js `API_KEY`

The sketch uploads `image/jpeg` and sends headers:

- `x-device-id`
- `x-api-key`
