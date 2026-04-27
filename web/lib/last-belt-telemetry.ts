export type BeltTelemetry = {
  deviceId: string;
  updatedAt: string; // ISO
  lcdLine1: string;
  lcdLine2: string;
  temperatureC: number | null;
  humidityPct: number | null;
};

let lastTelemetry: BeltTelemetry | undefined;

export function setLastBeltTelemetry(input: Omit<BeltTelemetry, "updatedAt"> & { updatedAt?: string }) {
  lastTelemetry = {
    deviceId: String(input.deviceId ?? "unknown").slice(0, 64),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    lcdLine1: String(input.lcdLine1 ?? "").slice(0, 32),
    lcdLine2: String(input.lcdLine2 ?? "").slice(0, 32),
    temperatureC: input.temperatureC == null ? null : Number(input.temperatureC),
    humidityPct: input.humidityPct == null ? null : Number(input.humidityPct),
  };
}

export function getLastBeltTelemetry(): BeltTelemetry | undefined {
  return lastTelemetry;
}

