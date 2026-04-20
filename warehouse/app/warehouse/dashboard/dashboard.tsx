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
  const [lastScan, setLastScan] = useState<QRScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<QRScanResult[]>([]);
  const videoRef = useRef<HTMLImageElement>(null);
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
                <span className={`w-2 h-2 rounded-full ${esp32Connected ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-xs text-gray-400">{esp32Connected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                placeholder="ESP32 IP (e.g., 192.168.1.100)"
                value={esp32Ip}
                onChange={(e) => setEsp32Ip(e.target.value)}
                className="flex-1 bg-gray-700 text-white text-sm px-3 py-2 rounded-md border border-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => esp32Connected ? disconnectEsp32() : connectToEsp32()}
                disabled={!esp32Ip}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  esp32Connected 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-blue-600 hover:bg-blue-700'
                } text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {esp32Connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
              {esp32Connected ? (
                <img
                  ref={videoRef as unknown as React.RefObject<HTMLImageElement>}
                  src={`http://${esp32Ip}/stream`}
                  alt="ESP32-CAM Stream"
                  className="w-full h-full object-cover"
                  onError={() => setEsp32Connected(false)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <svg className="w-16 h-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p>Enter ESP32 IP and click Connect</p>
                    <p className="text-xs mt-1">Stream URL: http://[IP]/stream</p>
                  </div>
                </div>
              )}
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
