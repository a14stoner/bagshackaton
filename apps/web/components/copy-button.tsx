"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="button copy-btn"
      onClick={async () => {
        try {
          const clipboard = (globalThis as any)?.navigator?.clipboard;
          if (!clipboard?.writeText) {
            return;
          }
          await clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
      title="Copy address"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
