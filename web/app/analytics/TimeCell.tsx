"use client";

export function TimeCell({ iso }: { iso: string }) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <span>{iso}</span>;

  const local = d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Keep the source UTC value visible on hover.
  return <span title={`UTC: ${d.toISOString()}`}>{local}</span>;
}

