export default function Loading() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="hero">
        <div className="skeleton" style={{ height: 34, width: "42%" }} />
        <div className="skeleton" style={{ height: 18, width: "70%", marginTop: 10 }} />
        <div className="metric-grid">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="metric-card">
              <div className="skeleton" style={{ height: 12, width: "60%" }} />
              <div className="skeleton" style={{ height: 26, width: "40%", marginTop: 10 }} />
            </div>
          ))}
        </div>
      </section>
      <section className="token-grid">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="token-card">
            <div className="skeleton" style={{ height: 20, width: "50%" }} />
            <div className="skeleton" style={{ height: 14, width: "80%", marginTop: 10 }} />
          </div>
        ))}
      </section>
    </div>
  );
}
