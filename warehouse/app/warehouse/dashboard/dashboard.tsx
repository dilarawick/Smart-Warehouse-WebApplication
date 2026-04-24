'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  username: string;
  role: string;
}

interface Scan {
  id: number;
  box_id: string;
  product_id: string | null;
  product_name: string | null;
  category: string | null;
  belt_id: string;
  status: string;
  scan_time: string;
  raw_payload?: string;
}

interface ScanEvent {
  data: string;
  timestamp: Date;
  status?: string;
  product_name?: string;
  category?: string;
  imageSrc?: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const mqttClientRef = useRef<any | null>(null);
  const [lastScan, setLastScan] = useState<ScanEvent | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanEvent[]>([]);
  const router = useRouter();

  const fetchScans = useCallback(async () => {
    try {
      const res = await fetch('/api/scans');
      if (res.ok) {
        const data = await res.json();
        setScans(data);
      }
    } catch (err) {
      console.error('Failed to fetch scans:', err);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!loading) {
      fetchScans();
      const interval = setInterval(fetchScans, 3000);
      return () => clearInterval(interval);
    }
  }, [loading, fetchScans]);

  // MQTT over WebSockets: listen for scan events from server
  useEffect(() => {
    let mounted = true;
    let client: any = null;

    async function startMqtt() {
      try {
        const mqttModule = await import('mqtt');
        const mqtt = mqttModule.default || mqttModule;
        const host = process.env.NEXT_PUBLIC_MQTT_BROKER || 'broker.hivemq.com';
        const protocol = process.env.NEXT_PUBLIC_MQTT_WS_PROTOCOL || 'wss';
        const port = process.env.NEXT_PUBLIC_MQTT_WS_PORT || '8884';
        const path = process.env.NEXT_PUBLIC_MQTT_WS_PATH || '/mqtt';
        const url = `${protocol}://${host}:${port}${path}`;
        const opts: any = { clientId: `web-dashboard-${Math.random().toString(16).slice(2)}` };
        if (process.env.NEXT_PUBLIC_MQTT_USER) opts.username = process.env.NEXT_PUBLIC_MQTT_USER;
        if (process.env.NEXT_PUBLIC_MQTT_PASSWORD) opts.password = process.env.NEXT_PUBLIC_MQTT_PASSWORD;
        client = mqtt.connect(url, opts);
        mqttClientRef.current = client;

        client.on('connect', () => {
          if (!mounted) return;
          setMqttConnected(true);
          console.log('[MQTT] Dashboard connected');
          client.subscribe('warehouse/+/scan', { qos: 0 });
          client.subscribe('warehouse/+/scan/ack', { qos: 0 });
        });

        client.on('message', async (topic: string, payload: Uint8Array) => {
          if (!mounted) return;
          try {
            const msg = payload.toString();
            let data: any;
            try { data = JSON.parse(msg); } catch { data = { raw: msg }; }

            // Handle scan trigger from ESP32 (contains image)
            if (topic.includes('/scan') && !topic.includes('/scan/ack') && !topic.includes('/scan/action')) {
              setScanMessage('Processing image...');
              setScanCount(c => c + 1);

              // Prefer inline base64 when available (works over https and avoids network/proxy issues)
              if (data.frame_base64 || data.image_base64 || data.image) {
                const b64 = data.frame_base64 || data.image_base64 || data.image;
                setPreviewSrc(`data:image/jpeg;base64,${b64}`);
              } else if (data.frame_url) {
                const sep = data.frame_url.includes('?') ? '&' : '?';
                setPreviewSrc(`${data.frame_url}${sep}ts=${Date.now()}`);
              }
              return;
            }

            // Handle server ack (QR decoded, saved to DB)
            if (topic.includes('/scan/ack')) {
              const status = data.status || 'unknown';
              const boxId = data.box_id || 'unknown';
              const productName = data.product_name || '';
              const category = data.category || '';

              if (status === 'ok' || status === 'duplicate') {
                setScanMessage(`${status.toUpperCase()}: ${boxId}${productName ? ` (${productName})` : ''}`);
                const event: ScanEvent = {
                  data: boxId,
                  timestamp: new Date(),
                  status,
                  product_name: productName,
                  category,
                };
                setLastScan(event);
                setScanHistory(prev => [event, ...prev].slice(0, 50));
              } else {
                setScanMessage(`No QR detected`);
              }

              fetchScans();
              return;
            }
          } catch (err) {
            console.error('[MQTT] Dashboard message error', err);
          }
        });

        client.on('error', (err: any) => console.error('[MQTT] Dashboard error', err));
        client.on('close', () => { if (mounted) setMqttConnected(false); });
      } catch (err) {
        console.error('[MQTT] Dashboard failed to load', err);
      }
    }

    startMqtt();

    return () => {
      mounted = false;
      try { mqttClientRef.current?.end(true); } catch {}
    };
  }, [fetchScans]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-300">Loading dashboard...</p>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const todayScans = scans.filter(s => s.scan_time.startsWith(today));
  const stats = [
    { label: 'Scanned today', value: todayScans.length },
    { label: 'Successful', value: todayScans.filter(s => s.status === 'ok').length },
    { label: 'Duplicates', value: todayScans.filter(s => s.status === 'duplicate').length },
    { label: 'Errors', value: todayScans.filter(s => s.status === 'error').length },
  ];

  const liveFeed = scans.slice(0, 5);
  const logRows = scans.slice(0, 8);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200">
      <header className="border-b border-gray-800">
        <div className="mx-auto max-w-7xl px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              <span className="inline-block h-9 w-9 rounded-md bg-blue-600" />
              Smart Warehouse
            </h1>
            <p className="text-sm text-gray-400">Conveyor belt — ESP32-CAM + Server QR Scanner</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="rounded-full bg-gray-800 px-3 py-1 text-sm text-green-300">Live · Belt 1</div>
            <div className="text-sm text-gray-400">{user?.username}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg bg-gray-800 p-6 shadow">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">{s.label}</div>
                <div className="text-sm text-gray-400">&nbsp;</div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div className="text-3xl font-bold text-white">{s.value}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="rounded-lg bg-gray-800 p-6 shadow lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-100">ESP32-CAM LIVE VIEW</h2>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-xs text-gray-400">{mqttConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
              <div className="flex-1 text-sm text-gray-400">Server decodes QR → saves to Azure SQL → publishes ack</div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      setScanMessage('Decoding...');
                      const body: any = {};
                      if (previewSrc && previewSrc.startsWith('data:')) {
                        body.image_base64 = previewSrc.split(',')[1];
                      } else if (previewSrc) {
                        // pass the URL directly
                        body.frame_url = previewSrc.split('?')[0];
                      }
                      body.belt_id = 'Belt-1';
                      const res = await fetch('/api/decode', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                      });
                      const data = await res.json();
                      if (data?.success) {
                        setScanMessage(`DECODED: ${data.qr_data}`);
                        const event = { data: data.qr_data, timestamp: new Date(), status: 'ok', product_name: null, category: null };
                        setLastScan(event);
                        setScanHistory(prev => [event, ...prev].slice(0,50));
                      } else {
                        // Display the exact cause (DB save failed, No QR found, etc)
                        setScanMessage(data?.error ? `Error: ${data.error}` : `Decode failed`);
                      }
                    } catch (err) {
                      console.error('Decode API error', err);
                      setScanMessage('Decode error - Check console');
                    }
                  }}
                  className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
                >
                  Decode Now
                </button>
              </div>
            </div>

            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 px-6">
                {previewSrc ? (
                  <>
                    <img src={previewSrc} alt="Latest capture" className="object-cover w-full h-full" />
                    {scanMessage ? (
                      <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 text-sm text-white px-2 py-1 rounded">{scanMessage}</div>
                    ) : null}
                  </>
                ) : lastScan ? (
                  <div className="text-center">
                    <div className="text-xs text-green-400 mb-1">Last Scanned</div>
                    <div className="text-xl font-mono text-green-300 break-all">{lastScan.data}</div>
                    <div className="text-xs text-gray-400 mt-2">{lastScan.timestamp.toLocaleTimeString()}</div>
                  </div>
                ) : (
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V4a4 4 0 018 0v3" />
                    </svg>
                    <p>No scans yet</p>
                    <p className="text-xs mt-1">Waiting for ESP32-CAM to send images via MQTT</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-gray-800 p-6 shadow lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-gray-100">SCAN RESULTS</h2>
            {lastScan ? (
              <div className="space-y-4">
                <div className={`p-4 border rounded-lg ${lastScan.status === 'ok' ? 'bg-green-900/30 border-green-700' : lastScan.status === 'duplicate' ? 'bg-yellow-900/30 border-yellow-700' : 'bg-red-900/30 border-red-700'}`}>
                  <div className="text-xs text-gray-400 mb-1">Last Result</div>
                  <div className="text-xl font-mono text-green-300 break-all">{lastScan.data}</div>
                  {lastScan.product_name && <div className="text-sm text-gray-300 mt-1">{lastScan.product_name}</div>}
                  {lastScan.category && <div className="text-sm text-gray-300">Category: {lastScan.category}</div>}
                  <div className="text-xs text-gray-400 mt-2">
                    Status: {lastScan.status?.toUpperCase()} · {lastScan.timestamp.toLocaleTimeString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400 mb-2">Scan History</div>
                  <div className="space-y-2 max-h-32 overflow-auto">
                    {scanHistory.map((scan, idx) => (
                      <div key={idx} className="flex justify-between text-sm bg-gray-700/50 p-2 rounded">
                        <span className="font-mono text-gray-300 truncate">{scan.data}</span>
                        <span className="text-gray-500">{scan.timestamp.toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-400">No QR codes scanned yet</p>
            )}
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="rounded-lg bg-gray-800 p-6 shadow">
              <h2 className="mb-4 text-lg font-semibold text-gray-100">LIVE SCAN FEED</h2>
              <div className="space-y-4">
                {liveFeed.length === 0 ? (
                  <p className="text-gray-400">No scans yet</p>
                ) : (
                  liveFeed.map((f) => (
                    <div key={f.id} className="flex items-center justify-between border-b border-gray-700 pb-3">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-md bg-gray-700 flex items-center justify-center">
                          <div className="h-6 w-6 rounded-sm bg-blue-400" />
                        </div>
                        <div>
                          <div className="font-medium text-white">{f.box_id}</div>
                          <div className="text-xs text-gray-400">{f.scan_time} · {f.belt_id}</div>
                        </div>
                      </div>
                      <div>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs ${
                          f.status === 'ok' ? 'bg-green-900/40 text-green-300' :
                          f.status === 'duplicate' ? 'bg-yellow-900/40 text-yellow-300' :
                          'bg-red-900/40 text-red-300'
                        }`}>{f.status.toUpperCase()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="rounded-lg bg-gray-800 p-6 shadow h-full">
              <h2 className="mb-4 text-lg font-semibold text-gray-100">BOX SCAN LOG</h2>
              <div className="max-h-64 overflow-auto">
                <table className="w-full table-auto text-left">
                  <thead className="text-sm text-gray-400">
                    <tr>
                      <th className="pb-2">Box ID</th>
                      <th className="pb-2">Time</th>
                      <th className="pb-2">Belt</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {logRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-gray-400">No scan logs</td>
                      </tr>
                    ) : (
                      logRows.map((r, idx) => (
                        <tr key={idx} className="border-t border-gray-700">
                          <td className="py-2">{r.box_id}</td>
                          <td className="py-2 text-gray-400">{r.scan_time}</td>
                          <td className="py-2 text-gray-400">{r.belt_id}</td>
                          <td className="py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs ${
                              r.status === 'ok' ? 'bg-green-900/40 text-green-300' :
                              r.status === 'duplicate' ? 'bg-yellow-900/40 text-yellow-300' :
                              'bg-red-900/40 text-red-300'
                            }`}>{r.status.toUpperCase()}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
