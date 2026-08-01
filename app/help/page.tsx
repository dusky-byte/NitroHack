import Link from "next/link";

export default function HelpPage() {
  return (
    <div style={{ padding: "80px 40px", maxWidth: "800px", margin: "0 auto", color: "var(--text-primary)", fontFamily: "var(--font-ui)" }}>
      <header style={{ marginBottom: "40px", borderBottom: "1px solid var(--border-dim)", paddingBottom: "20px" }}>
        <h1 style={{ fontSize: "32px", color: "var(--accent-bright)", textShadow: "0 0 14px rgba(34, 211, 238, 0.7)" }}>UltraTouch Setup & Help</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "10px" }}>Learn how to connect devices and use gestures.</p>
      </header>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "24px", color: "var(--text-secondary)", marginBottom: "16px" }}>1. Connecting an Android Device (ADB)</h2>
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "12px", color: "var(--text-primary)" }}>
          <li><strong style={{ color: "var(--accent)" }}>Step 1:</strong> Enable Developer Options on your Android device by tapping the "Build Number" 7 times in Settings &gt; About Phone.</li>
          <li><strong style={{ color: "var(--accent)" }}>Step 2:</strong> Go to Settings &gt; Developer Options and enable <strong>USB Debugging</strong>.</li>
          <li><strong style={{ color: "var(--accent)" }}>Step 3:</strong> Connect your device to your computer via USB (or wireless ADB).</li>
          <li><strong style={{ color: "var(--accent)" }}>Step 4:</strong> Authorize the computer on your phone when prompted.</li>
          <li><strong style={{ color: "var(--accent)" }}>Step 5:</strong> Check the "Devices" tab in UltraTouch. Your device should now appear!</li>
        </ul>
      </section>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "24px", color: "var(--text-secondary)", marginBottom: "16px" }}>2. Hand Gestures</h2>
        <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: "16px", background: "var(--bg-glass)", border: "1px solid var(--border-dim)", borderRadius: "var(--radius-md)" }}>
            <h3 style={{ color: "var(--success)" }}><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>pan_tool</span> Open Palm</h3>
            <p style={{ fontSize: "14px", marginTop: "8px", color: "var(--text-muted)" }}>Neutral state. Used for hovering over panels or aiming the pointer.</p>
          </div>
          <div style={{ padding: "16px", background: "var(--bg-glass)", border: "1px solid var(--border-dim)", borderRadius: "var(--radius-md)" }}>
            <h3 style={{ color: "var(--error)" }}><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>front_hand</span> Closed Fist</h3>
            <p style={{ fontSize: "14px", marginTop: "8px", color: "var(--text-muted)" }}>Drag. Close your fist and move to pan left/right between main panels.</p>
          </div>
          <div style={{ padding: "16px", background: "var(--bg-glass)", border: "1px solid var(--border-dim)", borderRadius: "var(--radius-md)" }}>
            <h3 style={{ color: "var(--warning)" }}><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>touch_app</span> Pointing</h3>
            <p style={{ fontSize: "14px", marginTop: "8px", color: "var(--text-muted)" }}>Select. Point your index finger to interact with buttons or toggle devices.</p>
          </div>
          <div style={{ padding: "16px", background: "var(--bg-glass)", border: "1px solid var(--border-dim)", borderRadius: "var(--radius-md)" }}>
            <h3 style={{ color: "var(--accent)" }}><span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>pinch</span> Pinch</h3>
            <p style={{ fontSize: "14px", marginTop: "8px", color: "var(--text-muted)" }}>Zoom. Pinch index and thumb together to drill into detailed data views.</p>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: "60px", textAlign: "center" }}>
        <Link href="/" style={{ 
          display: "inline-block", 
          padding: "12px 24px", 
          background: "var(--bg-card)", 
          border: "1px solid var(--accent)", 
          borderRadius: "var(--radius-md)", 
          color: "var(--text-primary)", 
          textDecoration: "none",
          fontWeight: 600,
          boxShadow: "0 0 16px rgba(34, 211, 238, 0.2)"
        }}>
          <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '8px' }}>arrow_back</span> Return to UltraTouch Hub
        </Link>
      </footer>
    </div>
  );
}
