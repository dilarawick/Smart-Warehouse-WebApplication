export const metadata = {
  title: "Robot arm – Smart Warehouse",
  description: "Robot arm controls",
};

export default function RobotArmPage() {
  return (
    <main style={{ padding: "28px 32px", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "#e6eef9" }}>Robot arm</h1>
      <p style={{ margin: "0 0 24px", color: "#a9c8ee", lineHeight: 1.5 }}>
        Placeholder for robot arm monitoring and control. Connect your hardware APIs here.
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
        No robot arm integration wired yet.
      </div>
    </main>
  );
}
