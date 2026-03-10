import { Card } from "./card";

export function Stat(props: { label: string; value: string; hint?: string }) {
  return (
    <Card className="min-h-32">
      <p className="text-sm font-semibold tracking-[-0.01em] text-neutral-500">{props.label}</p>
      <p className="mt-4 text-3xl font-bold tracking-[-0.04em] text-neutral-950">{props.value}</p>
      {props.hint ? <p className="mt-3 text-sm leading-6 text-neutral-500">{props.hint}</p> : null}
    </Card>
  );
}
