export const metadata = {
  title: "Car – Smart Warehouse",
  description: "Vehicle / car fleet",
};

export default function CarPage() {
  return (
    <main style={{ padding: "28px 32px", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "#e6eef9" }}>Car</h1>
      <p style={{ margin: "0 0 24px", color: "#a9c8ee", lineHeight: 1.5 }}>
        Placeholder for car or AGV status, routes, and telemetry. Hook this page to your backend when ready.
      </p>
      <div
        style={{
          border: "1px dashed rgba(255,255,255,0.06)",
          borderRadius: 12,
          padding: 48,
          textAlign: "center",
          color: "#cfe8ff",
          background: "#0f2b4d",
        }}
      >
        No car / fleet integration wired yet.
      </div>
    </main>
  );
}
