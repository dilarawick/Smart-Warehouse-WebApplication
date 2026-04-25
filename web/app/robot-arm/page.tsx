export const metadata = {
  title: "Robot arm – Smart Warehouse",
  description: "Robot arm controls",
};

export default function RobotArmPage() {
  return (
    <main style={{ padding: "28px 32px", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Robot arm</h1>
      <p style={{ margin: "0 0 24px", color: "#52525b", lineHeight: 1.5 }}>
        Placeholder for robot arm monitoring and control. Connect your hardware APIs here.
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
        No robot arm integration wired yet.
      </div>
    </main>
  );
}
