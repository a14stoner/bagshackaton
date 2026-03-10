export default function TokenLoading() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="hero">
        <div className="skeleton" style={{ height: 34, width: "40%" }} />
        <div className="metric-grid">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="metric-card">
              <div className="skeleton" style={{ height: 12, width: "60%" }} />
              <div className="skeleton" style={{ height: 26, width: "40%", marginTop: 10 }} />
            </div>
          ))}
        </div>
      </section>
      <section className="split-grid">
        <div className="panel">
          <div className="skeleton" style={{ height: 260 }} />
        </div>
        <div className="panel">
          <div className="skeleton" style={{ height: 260 }} />
        </div>
      </section>
    </div>
  );
}
