'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type User = {
  id: number;
  username: string;
  role: string;
};

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
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const router = useRouter();

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.authenticated) {
          setUser(data.user);
        } else {
          // Redirect to login if not authenticated
          router.push('/login');
        }
      } catch (err) {
        console.error('Failed to fetch user:', err);
        router.push('/login');
      } finally {
        setLoadingUser(false);
      }
    };
    fetchUser();
  }, [router]);

  // Fetch scans
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScans();
    const interval = setInterval(fetchScans, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  // Show loading while checking auth
  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // If no user, shouldn't render due to redirect, but as fallback:
  if (!user) {
    return null;
  }

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

        {/* Header with Auth */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Smart Warehouse Dashboard
            </h1>
            <p className="text-sm text-gray-500">
              Conveyor Belt Scanner — Live Feed
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm bg-green-50 text-green-700 px-4 py-2 rounded-full">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Live · Belt 1
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Logged in as <strong>{user.username}</strong></span>
              <button
                onClick={handleLogout}
                className="rounded-md bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 transition-colors"
              >
                Logout
              </button>
            </div>
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
