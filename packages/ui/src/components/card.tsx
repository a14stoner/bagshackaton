import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function Card(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "bags-card p-6",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}
