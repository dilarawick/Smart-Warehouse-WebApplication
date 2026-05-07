export type ServoCommand = {
  updatedAtMs: number;
  deviceId: string;
  angleDeg: number;
  label: "A" | "B" | "custom";
};

let lastServoCommand: ServoCommand | undefined;

export function setLastServoCommand(cmd: Omit<ServoCommand, "updatedAtMs"> & { updatedAtMs?: number }) {
  const angle = Number(cmd.angleDeg);
  lastServoCommand = {
    updatedAtMs: typeof cmd.updatedAtMs === "number" ? cmd.updatedAtMs : Date.now(),
    deviceId: String(cmd.deviceId ?? "unknown").slice(0, 64),
    angleDeg: Number.isFinite(angle) ? angle : 0,
    label: cmd.label ?? "custom",
  };
}

export function getLastServoCommand(): ServoCommand | undefined {
  return lastServoCommand;
}

