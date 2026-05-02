export type PacketLabelMode = "hide" | "ips" | "ipsSubject";

const CYCLE_ORDER: PacketLabelMode[] = ["hide", "ips", "ipsSubject"];

export function isPacketLabelMode(value: unknown): value is PacketLabelMode {
  return value === "hide" || value === "ips" || value === "ipsSubject";
}

/** Migrate from persisted builder page state (`packetLabelMode` or legacy `showPacketIps`). */
export function parsePacketLabelModeFromPageState(parsed: {
  packetLabelMode?: unknown;
  showPacketIps?: unknown;
}): PacketLabelMode {
  if (isPacketLabelMode(parsed.packetLabelMode)) return parsed.packetLabelMode;
  if (parsed.showPacketIps === false) return "hide";
  return "ipsSubject";
}

export function parsePacketLabelModeFromStorage(raw: string | null): PacketLabelMode {
  const v = raw?.trim();
  if (isPacketLabelMode(v)) return v;
  return "ipsSubject";
}

export function nextPacketLabelMode(mode: PacketLabelMode): PacketLabelMode {
  const i = CYCLE_ORDER.indexOf(mode);
  return CYCLE_ORDER[(i >= 0 ? i + 1 : 0) % CYCLE_ORDER.length]!;
}

/** Button caption for the action taken on the next click (same pattern as the old Show/Hide IPs toggle). */
export function packetLabelToggleButtonText(mode: PacketLabelMode): string {
  switch (mode) {
    case "hide":
      return "Show IPs";
    case "ips":
      return "Show subjects";
    case "ipsSubject":
      return "Hide labels";
  }
}
