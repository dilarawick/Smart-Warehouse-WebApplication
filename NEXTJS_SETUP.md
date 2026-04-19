# Next.js Setup for Smart Warehouse

Complete Next.js app code for the backend API and live dashboard.

## Project Initialization

```bash
npx create-next-app@latest warehouse --typescript --app
cd warehouse

npm install mssql
npm install -D @types/mssql
```

## Directory Structure

```
warehouse/
├── app/
│   ├── page.tsx                  # Live dashboard UI
│   ├── layout.tsx               # Root layout
│   └── api/
│       └── scans/route.ts       # GET for dashboard
├── lib/
│   ├── db.ts                    # Azure SQL connection pool
│   └── mqttSubscriber.ts        # MQTT subscriber
├── .env.local                   # (gitignored)
├── next.config.js
└── package.json
```

---

## 1. Database Connection Pool

**File:** `lib/db.ts`

```typescript
import sql from 'mssql';

const config: sql.config = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  port: parseInt(process.env.AZURE_SQL_PORT || '1433'),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMilliseconds: 30000,
  },
};

// Singleton pool across hot reloads
const globalWithSql = global as typeof global & { _sqlPool?: sql.ConnectionPool };

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!globalWithSql._sqlPool || !globalWithSql._sqlPool.connected) {
    globalWithSql._sqlPool = await new sql.ConnectionPool(config).connect();
  }
  return globalWithSql._sqlPool;
}
```

---

## 2. MQTT Subscriber
**File:** `lib/mqttSubscriber.ts`

```typescript
import mqtt from 'mqtt';
import { getPool } from './db';
import sql from 'mssql';

let started = false;

export function startMqttSubscriber() {
  if (started) return;
  started = true;

  const client = mqtt.connect(`mqtts://${process.env.MQTT_BROKER}`, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASSWORD,
    clientId: `nextjs-server-${Math.random().toString(16).slice(2)}`,
    rejectUnauthorized: false,
  });

  client.on('connect', () => {
    console.log('[MQTT] Connected to broker');
    client.subscribe('warehouse/+/scan');
  });

  client.on('message', async (topic, payload) => {
    try {
      const { box_id, belt_id = 'Belt-1' } = JSON.parse(payload.toString());
      const pool = await getPool();

      // Duplicate check — same box in last 60 seconds
      const dup = await pool.request()
        .input('box_id', sql.VarChar, box_id)
        .query(`
          SELECT 1 FROM box_scans
          WHERE box_id = @box_id
            AND scan_time > DATEADD(SECOND, -60, GETDATE())
        `);

      const status = dup.recordset.length > 0 ? 'duplicate' : 'ok';

      await pool.request()
        .input('box_id',      sql.VarChar, box_id)
        .input('belt_id',     sql.VarChar, belt_id)
        .input('status',      sql.VarChar, status)
        .input('raw_payload', sql.VarChar, payload.toString())
        .query(`
          INSERT INTO box_scans (box_id, belt_id, status, raw_payload)
          VALUES (@box_id, @belt_id, @status, @raw_payload)
        `);

      // ACK back to ESP32
      const ackTopic = topic.replace('/scan', '/scan/ack');
      client.publish(ackTopic, JSON.stringify({ status, box_id }));

      console.log(`[MQTT] Saved: ${box_id} → ${status}`);
    } catch (err) {
      console.error('[MQTT] Error:', err);
    }
  });

  client.on('error',     (err) => console.error('[MQTT] Broker error:', err));
  client.on('reconnect', ()    => console.log('[MQTT] Reconnecting...'));
}
```
---

## 3. GET `/api/scans` — Dashboard Polling

**File:** `app/api/scans/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { startMqttSubscriber } from '@/lib/mqttSubscriber';

startMqttSubscriber(); // starts once on first request

export async function GET() {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT TOP 100
        id,
        box_id,
        belt_id,
        status,
        raw_payload,
        ip_address,
        FORMAT(scan_time, 'yyyy-MM-dd HH:mm:ss') AS scan_time
      FROM box_scans
      ORDER BY scan_time DESC
    `);

    return NextResponse.json(result.recordset);
  } catch (error) {
    console.error('[scans GET]', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}
```

---

## 4. Live Dashboard UI

**File:** `app/page.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';

type Scan = {
  id: number;
  box_id: string;
  belt_id: string;
  status: 'ok' | 'duplicate' | 'error';
  scan_time: string;
  ip_address: string;
};

export default function Dashboard() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [lastSync, setLastSync] = useState('');

  const fetchScans = async () => {
    try {
      const res = await fetch('/api/scans');
      const data = await res.json();
      setScans(data);
      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch scans:', err);
    }
  };

  useEffect(() => {
    fetchScans();
    const interval = setInterval(fetchScans, 3000);
    return () => clearInterval(interval);
  }, []);

  const total = scans.length;
  const ok = scans.filter(s => s.status === 'ok').length;
  const dups = scans.filter(s => s.status === 'duplicate').length;
  const errors = scans.filter(s => s.status === 'error').length;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'ok': return 'bg-green-100 text-green-800';
      case 'duplicate': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-red-100 text-red-800';
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Smart Warehouse Dashboard
            </h1>
            <p className="text-sm text-gray-500">
              Conveyor Belt Scanner — Live Feed
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm bg-green-50 text-green-700 px-4 py-2 rounded-full">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Live · Belt 1
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Scans', value: total, color: 'text-gray-900' },
            { label: 'Successful', value: ok, color: 'text-green-700' },
            { label: 'Duplicates', value: dups, color: 'text-yellow-700' },
            { label: 'Errors', value: errors, color: 'text-red-700' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-lg p-4 shadow-sm border">
              <p className="text-xs text-gray-500 uppercase tracking-wide">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Scan Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="flex justify-between items-center px-5 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Scan Log</h2>
            <span className="text-xs text-gray-400">
              Last updated: {lastSync}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-5 py-3 text-left">Box ID</th>
                  <th className="px-5 py-3 text-left">Belt</th>
                  <th className="px-5 py-3 text-left">Time</th>
                  <th className="px-5 py-3 text-left">Device IP</th>
                  <th className="px-5 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {scans.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono font-medium">{s.box_id}</td>
                    <td className="px-5 py-3">{s.belt_id}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{s.scan_time}</td>
                    <td className="px-5 py-3 text-gray-500 font-mono text-xs">{s.ip_address}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadge(s.status)}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {scans.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-gray-400">
                      Waiting for scans from ESP32-CAM...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  );
}
```

---

## 5. Root Layout

**File:** `app/layout.tsx`

```tsx
export const metadata = {
  title: 'Smart Warehouse Dashboard',
  description: 'Real-time conveyor belt scanner feed',
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        {children}
      </body>
    </html>
  );
}
```

---

## 6. Environment Variables

**File:** `.env.local` (DO NOT COMMIT)

```env
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=warehouse
AZURE_SQL_USER=your-user
AZURE_SQL_PASSWORD=your-password
API_KEY=supersecret-key-change-this
MQTT_BROKER=your-cluster.hivemq.cloud
MQTT_USER=your-hivemq-user
MQTT_PASSWORD=your-hivemq-password
```

---

## 7. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

After deployment:

1. Copy your Vercel URL: `https://warehouse-xxx.vercel.app`
2. Update ESP32-CAM code: `const char* API_URL = "https://your-url/api/scan";`
3. In Vercel dashboard → Project Settings → Environment Variables, add all 6 variables from `.env.local`
4. Redeploy (or Vercel auto-detects changes)

---

## Azure SQL Firewall Rule

Allow Vercel to connect:

1. Azure Portal → Your SQL Server → Networking
2. Check: **"Allow Azure services and resources to access this server"**
3. Save

Or whitelist Vercel's outbound IP ranges (see Vercel docs).

---

## Test the API

```bash
# Test POST from terminal
curl -X POST https://your-app.vercel.app/api/scan \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"box_id":"TEST-001","belt_id":"Belt-1"}'

# Test GET
curl https://your-app.vercel.app/api/scans
```

---

## Notes

- Dashboard polls `/api/scans` every 3 seconds (adjust in `page.tsx`)
- Duplicate scans within 60 seconds are marked `"duplicate"` (adjust in API route)
- All times stored in UTC; displayed as formatted string
- API key auth is optional but recommended
- Azure SQL connection uses encryption (mandatory on Azure)

---

**Next:** Flash ESP32-CAM with updated `API_URL`, mount, and start scanning.
