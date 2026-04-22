'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import jsQR from 'jsqr';

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

interface QRScanResult {
  data: string;
  timestamp: Date;
  product_name?: string;
  category?: string;
}

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [esp32Ip, setEsp32Ip] = useState('');
  const [esp32Connected, setEsp32Connected] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const mqttClientRef = useRef<any | null>(null);

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

  const reconnectMqtt = useCallback(async () => {
    try {
      mqttClientRef.current?.end(true);
      const mqtt = await import('mqtt');
      const host = process.env.NEXT_PUBLIC_MQTT_BROKER || 'broker.hivemq.com';
      const protocol = process.env.NEXT_PUBLIC_MQTT_WS_PROTOCOL || 'wss';
      const port = process.env.NEXT_PUBLIC_MQTT_WS_PORT || '8884';
      const path = process.env.NEXT_PUBLIC_MQTT_WS_PATH || '/mqtt';
      const url = `${protocol}://${host}:${port}${path}`;
      const opts: any = { clientId: `web-client-${Math.random().toString(16).slice(2)}` };
      if (process.env.NEXT_PUBLIC_MQTT_USER) opts.username = process.env.NEXT_PUBLIC_MQTT_USER;
      if (process.env.NEXT_PUBLIC_MQTT_PASSWORD) opts.password = process.env.NEXT_PUBLIC_MQTT_PASSWORD;

      const client = mqtt.connect(url, opts);
      mqttClientRef.current = client;

      client.on('connect', () => {
        setMqttConnected(true);
        client.subscribe('warehouse/+/scan', { qos: 0 });
      });

      client.on('message', (topic: string, payload: Uint8Array) => {
        try {
          const msg = payload.toString();
          let data: any = msg;
          try { data = JSON.parse(msg); } catch {}
          const display = typeof data === 'string' ? data : (data.box_id || JSON.stringify(data));
          // If message contains a frame_url or inline image, set preview immediately
          if (data && typeof data === 'object') {
            if (data.frame_url) {
              const sep = data.frame_url.includes('?') ? '&' : '?';
              setPreviewSrc(`${data.frame_url}${sep}ts=${Date.now()}`);
            } else if (data.image || data.image_base64 || data.frame_base64) {
              const b64 = data.image || data.image_base64 || data.frame_base64;
              setPreviewSrc(`data:image/jpeg;base64,${b64}`);
            }
          }
          const scan: QRScanResult = { data: display, timestamp: new Date(), product_name: data.product_name, category: data.category };
          setLastScan(scan);
          setScanHistory((s) => [scan, ...s].slice(0, 50));
          fetchScans();
        } catch (err) {
          console.error('MQTT message handling error', err);
        }
      });

      client.on('error', (err: any) => console.error('[MQTT] error', err));
      client.on('close', () => setMqttConnected(false));
    } catch (err) {
      console.error('reconnectMqtt failed', err);
    }
  }, [fetchScans]);
  const [lastScan, setLastScan] = useState<QRScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<QRScanResult[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const router = useRouter();

  // Derive latest captured image (if any) from fetched scans
  const latestRaw = scans.length > 0 ? scans[0].raw_payload : null;
  let latestImageSrc: string | null = null;
  if (latestRaw) {
    try {
      const parsed = typeof latestRaw === 'string' ? JSON.parse(latestRaw) : latestRaw;
      if (parsed.image) {
        latestImageSrc = `data:image/jpeg;base64,${parsed.image}`;
      } else if (parsed.frame_base64) {
        latestImageSrc = `data:image/jpeg;base64,${parsed.frame_base64}`;
      } else if (parsed.frame_url) {
        const sep = parsed.frame_url.includes('?') ? '&' : '?';
        latestImageSrc = `${parsed.frame_url}${sep}ts=${Date.now()}`;
      } else if (parsed.image_base64) {
        latestImageSrc = `data:image/jpeg;base64,${parsed.image_base64}`;
      }
    } catch (err) {
      // ignore parse errors
    }
  }

  

  const submitScan = useCallback(async (data: string) => {
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        body: JSON.stringify({ qr_data: data, belt_id: 'Belt-Web', source_id: 'web-scanner' }),
        headers: { 'Content-Type': 'application/json' },
      });
      return res.json();
    } catch (err) {
      console.error('Failed to submit scan:', err);
    }
  }, []);

  const connectToEsp32 = useCallback(() => {
    // retained for backward-compat UX but we do not recommend connecting directly to ESP32
    if (!esp32Ip) return;
    const url = `http://${esp32Ip}/stream`;
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play();
        setEsp32Connected(true);
      };
      videoRef.current.onerror = () => {
        setEsp32Connected(false);
      };
    }
  }, [esp32Ip]);

  const disconnectEsp32 = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.src = '';
      videoRef.current.pause();
    }
    setEsp32Connected(false);
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

  // MQTT over WebSockets: subscribe to scans and update UI live
  useEffect(() => {
    let mounted = true;
    let client: any = null;

    async function startMqtt() {
      try {
const mqttModule = await import('mqtt');
        const mqtt = mqttModule.default || mqttModule;
        // build broker URL from public env vars (set NEXT_PUBLIC_MQTT_BROKER, NEXT_PUBLIC_MQTT_USER, NEXT_PUBLIC_MQTT_PASSWORD)
        const host = process.env.NEXT_PUBLIC_MQTT_BROKER || 'broker.hivemq.com';
        const protocol = process.env.NEXT_PUBLIC_MQTT_WS_PROTOCOL || 'wss';
        const port = process.env.NEXT_PUBLIC_MQTT_WS_PORT || '8884';
        const path = process.env.NEXT_PUBLIC_MQTT_WS_PATH || '/mqtt';
        const url = `${protocol}://${host}:${port}${path}`;
        const opts: any = { clientId: `web-client-${Math.random().toString(16).slice(2)}` };
        if (process.env.NEXT_PUBLIC_MQTT_USER) opts.username = process.env.NEXT_PUBLIC_MQTT_USER;
        if (process.env.NEXT_PUBLIC_MQTT_PASSWORD) opts.password = process.env.NEXT_PUBLIC_MQTT_PASSWORD;
        client = mqtt.connect(url, opts);
        mqttClientRef.current = client;

        client.on('connect', () => {
          if (!mounted) return;
          setMqttConnected(true);
          console.log('[MQTT] Connected to broker');
          // subscribe to all scan topics using multi-level wildcard #
          client.subscribe('warehouse/+/scan/#', { qos: 0 });
          console.log('[MQTT] Subscribed to warehouse/+/scan/#');
        });

        client.on('message', async (topic: string, payload: Uint8Array) => {
          if (!mounted) return;
          try {
            const msg = payload.toString();
            const topicStr = topic;
            console.log('[MQTT MSG]', topicStr, '->', msg.substring(0, 100));
            
            // Handle scan trigger from ESP32
            if (topicStr.includes('/scan/trigger')) {
              let trigger: any = { belt_id: 'Belt-1' };
              try { trigger = JSON.parse(msg); } catch {}

              const publishAction = async (action: string, qrData?: string) => {
                const responseTopic = `warehouse/${trigger.belt_id}/scan/action`;
                const responsePayload = JSON.stringify({ id: trigger.id, action, qr_data: qrData || 'unknown' });
                client.publish(responseTopic, responsePayload);
                console.log('[MQTT] Published action:', action, 'to', responseTopic);
              };

              try {
                // If payload contains base64 image, decode it directly in browser
                const base64 = trigger.frame_base64 || trigger.image_base64 || trigger.image;
                if (base64) {
                  try {
                    const dataUrl = `data:image/jpeg;base64,${base64}`;
                    const res = await fetch(dataUrl);
                    const blob = await res.blob();
                    const imgBitmap = await createImageBitmap(blob);
                    const canvas = document.createElement('canvas');
                    canvas.width = imgBitmap.width;
                    canvas.height = imgBitmap.height;
                    const ctx = canvas.getContext('2d')!;
                    ctx.drawImage(imgBitmap, 0, 0);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const qr = jsQR(imageData.data, canvas.width, canvas.height);
                    let action = 'PASS_B';
                    if (qr && qr.data) {
                      const qrUpper = qr.data.toUpperCase();
                      if (qrUpper.startsWith('A') || qrUpper.includes('-A-') || qrUpper.includes(':A')) {
                        action = 'SLIDE_A';
                      }
                      console.log('[QR] Decoded from base64:', qr.data, '->', action);
                      await publishAction(action, qr.data);
                    } else {
                      console.log('[QR] No QR detected in base64 -> default PASS_B');
                      await publishAction('PASS_B');
                    }
                    return;
                  } catch (err) {
                    console.error('[QR] Base64 decode error:', err);
                    await publishAction('PASS_B');
                    return;
                  }
                }

                // If frame_url / esp_ip available, fetch image from device
                const espIp = trigger.esp_ip || (trigger.frame_url ? null : null);
                if (trigger.frame_url || espIp) {
                  const fetchUrl = trigger.frame_url || (espIp ? `http://${espIp}/frame` : null);
                  if (fetchUrl) {
                    try {
                      const res = await fetch(fetchUrl);
                      const blob = await res.blob();
                      const imgBitmap = await createImageBitmap(blob);
                      const canvas = document.createElement('canvas');
                      canvas.width = imgBitmap.width;
                      canvas.height = imgBitmap.height;
                      const ctx = canvas.getContext('2d')!;
                      ctx.drawImage(imgBitmap, 0, 0);
                      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                      const qr = jsQR(imageData.data, canvas.width, canvas.height);
                      let action = 'PASS_B';
                      if (qr && qr.data) {
                        const qrUpper = qr.data.toUpperCase();
                        if (qrUpper.startsWith('A') || qrUpper.includes('-A-') || qrUpper.includes(':A')) {
                          action = 'SLIDE_A';
                        }
                        console.log('[QR] Decoded from frame_url:', qr.data, '->', action);
                        await publishAction(action, qr.data);
                      } else {
                        console.log('[QR] No QR detected from frame_url -> default PASS_B');
                        await publishAction('PASS_B');
                      }
                      return;
                    } catch (err) {
                      console.error('[QR] Fetch/frame decode error:', err);
                      await publishAction('PASS_B');
                      return;
                    }
                  }
                }

                // Fallback: cannot decode image, send PASS_B to unblock ESP
                await publishAction('PASS_B');
              } catch (err) {
                console.error('[QR] Unexpected error:', err);
                await publishAction('PASS_B');
              }
              return;
            }
            
            // Handle scan messages
            let data: any = msg;
            try { data = JSON.parse(msg); } catch {}

            // Set preview immediately if frame URL or inline image present
            if (data && typeof data === 'object') {
              if (data.frame_url) {
                const sep = data.frame_url.includes('?') ? '&' : '?';
                setPreviewSrc(`${data.frame_url}${sep}ts=${Date.now()}`);
              } else if (data.image || data.image_base64 || data.frame_base64) {
                const b64 = data.image || data.image_base64 || data.frame_base64;
                setPreviewSrc(`data:image/jpeg;base64,${b64}`);
              }
            }

            const display = typeof data === 'string' ? data : (data.box_id || JSON.stringify(data));
            const scan: QRScanResult = { data: display, timestamp: new Date(), product_name: data.product_name, category: data.category };
            setLastScan(scan);
            setScanHistory((s) => [scan, ...s].slice(0, 50));
            // refresh server-side scans table
            fetchScans();
          } catch (err) {
            console.error('MQTT message handling error', err);
          }
        });

        client.on('error', (err: any) => console.error('[MQTT] error', err));
        client.on('close', () => { if (mounted) setMqttConnected(false); });
      } catch (err) {
        console.error('Failed to load mqtt client', err);
      }
    }

    startMqtt();

    return () => {
      mounted = false;
      try { mqttClientRef.current?.end(true); } catch {}
    };
  }, [fetchScans]);

  useEffect(() => {
    return () => { disconnectEsp32(); };
  }, [disconnectEsp32]);

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
            <p className="text-sm text-gray-400">Conveyor belt — Web + ESP32-CAM scanner</p>
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
              <h2 className="text-lg font-semibold text-gray-100">ESP32-CAM STREAM</h2>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-xs text-gray-400">{mqttConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
              <div className="flex-1 text-sm text-gray-400">MQTT status: {mqttConnected ? 'Connected' : 'Disconnected'}</div>
              <button
                onClick={() => {
                  if (mqttConnected) {
                    try { mqttClientRef.current?.end(true); } catch {}
                    setMqttConnected(false);
                  } else {
                    reconnectMqtt();
                  }
                }}
                className={`px-4 py-2 rounded-md text-sm font-medium ${mqttConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'} text-white transition-colors`}
              >
                {mqttConnected ? 'Disconnect MQTT' : 'Connect MQTT'}
              </button>
            </div>

            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 px-6">
                {(previewSrc || latestImageSrc) ? (
                  <img src={previewSrc || latestImageSrc || ''} alt="Latest capture" className="object-contain w-full h-full" />
                ) : lastScan ? (
                  <div className="text-center">
                    <div className="text-xs text-green-400 mb-1">Last MQTT Scan</div>
                    <div className="text-xl font-mono text-green-300 break-all">{lastScan.data}</div>
                    <div className="text-xs text-gray-400 mt-2">{lastScan.timestamp.toLocaleTimeString()}</div>
                  </div>
                ) : (
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V4a4 4 0 018 0v3" />
                    </svg>
                    <p>No live MQTT scans yet</p>
                    <p className="text-xs mt-1">This dashboard connects to the MQTT broker via WebSockets. Do not connect directly to the ESP32 device IP from the browser.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-gray-800 p-6 shadow lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-gray-100">SCANNED QR DATA</h2>
            {lastScan ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                  <div className="text-xs text-green-400 mb-1">Last Scanned</div>
                  <div className="text-xl font-mono text-green-300 break-all">{lastScan.data}</div>
                  <div className="text-xs text-gray-400 mt-2">
                    {lastScan.timestamp.toLocaleTimeString()}
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
