"use client";

import { useEffect, useMemo, useState } from "react";

export function Countdown({ targetAt }: { targetAt: string | null | undefined }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const text = useMemo(() => {
    if (!targetAt) {
      return "Unscheduled";
    }
    const targetTime = new Date(targetAt).getTime();
    if (!Number.isFinite(targetTime)) {
      return "Unscheduled";
    }
    const diff = Math.max(0, Math.floor((targetTime - now) / 1000));
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }, [targetAt, now]);

  return <span className="mono">{text}</span>;
}
