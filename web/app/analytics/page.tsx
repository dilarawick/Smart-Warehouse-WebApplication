export const metadata = {
  title: "Analytics – Smart Warehouse",
  description: "Warehouse analytics and metrics",
};

export default function AnalyticsPage() {
  return (
    <main style={{ padding: "28px 32px", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Analytics</h1>
      <p style={{ margin: "0 0 24px", color: "#52525b", lineHeight: 1.5 }}>
        Placeholder for throughput, inventory trends, and device KPIs. Connect charts and APIs when ready.
      </p>
      <div
        style={{
          border: "1px dashed #d4d4d8",
          borderRadius: 12,
          padding: 48,
          textAlign: "center",
          color: "#71717a",
          background: "#fff",
        }}
      >
        No analytics integration wired yet.
      </div>
    </main>
  );
}
