"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel">
      <h2 className="section-title">Something went wrong</h2>
      <p className="muted">The dashboard could not load the requested data.</p>
      <button type="button" className="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
