import { readFileSync, writeFileSync } from "node:fs";

type RawEndpoint = {
  address: string;
  type: string;
  "sends-to": string | number;
  "receives-from": string | number;
  "packets-per-tick": string | number;
  hackable: string | boolean;
};

type ParsedPacketRate = {
  raw: string;
  mode: "none" | "fraction" | "unknown" | "text";
  numerator?: number;
  denominator?: number;
  approximate?: boolean;
};

type NormalizedEndpoint = {
  address: string;
  type: string;
  hackable: boolean | null;
  sends_to: string[];
  replies_to: string[];
  receives_from: string[];
  packets_per_tick: ParsedPacketRate;
  raw: {
    sends_to: string;
    receives_from: string;
  };
};

const ADDRESS_PATTERN =
  /(?<![\d*])(?:\d+|\*)\.(?:\d+|\*)\.(?:\d+|\*)\.(?:\d+|\*)(?![\d*])/g;

function toRawString(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function parseHackable(value: string | boolean): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  const v = value.trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

function extractAddresses(value: string): string[] {
  const matches = value.match(ADDRESS_PATTERN) ?? [];
  return [...new Set(matches)];
}

function parseSendAndReplyTargets(rawSends: string): { sendsTo: string[]; repliesTo: string[] } {
  const lower = rawSends.toLowerCase();
  const marker = "replies to";
  const markerIndex = lower.indexOf(marker);
  if (markerIndex < 0) {
    return {
      sendsTo: extractAddresses(rawSends),
      repliesTo: [],
    };
  }

  const beforeReplies = rawSends.slice(0, markerIndex).replace(/sends to\s*/i, "").replace(/\band\s*$/i, "");
  return {
    sendsTo: extractAddresses(beforeReplies),
    repliesTo: extractAddresses(rawSends.slice(markerIndex + marker.length).trim()),
  };
}

function parsePacketsPerTick(value: string | number): ParsedPacketRate {
  const raw = toRawString(value);
  if (raw === "0") {
    return { raw, mode: "none", numerator: 0, denominator: 1 };
  }
  if (raw === "?") {
    return { raw, mode: "unknown" };
  }

  const m = raw.match(/^(~)?\s*(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    return {
      raw,
      mode: "fraction",
      approximate: Boolean(m[1]),
      numerator: Number(m[2]),
      denominator: Number(m[3]),
    };
  }

  return { raw, mode: "text" };
}

function normalizeEndpoint(row: RawEndpoint): NormalizedEndpoint {
  const sendsRaw = toRawString(row["sends-to"]);
  const receivesRaw = toRawString(row["receives-from"]);
  const parsedTargets = parseSendAndReplyTargets(sendsRaw);

  return {
    address: row.address,
    type: row.type,
    hackable: parseHackable(row.hackable),
    sends_to: parsedTargets.sendsTo,
    replies_to: parsedTargets.repliesTo,
    receives_from: extractAddresses(receivesRaw),
    packets_per_tick: parsePacketsPerTick(row["packets-per-tick"]),
    raw: {
      sends_to: sendsRaw,
      receives_from: receivesRaw,
    },
  };
}

function main(): void {
  const rawJson = readFileSync("data.json", "utf8");
  const rows = JSON.parse(rawJson) as RawEndpoint[];
  const endpoints = rows.map(normalizeEndpoint);

  const out = {
    source_file: "data.json",
    generated_at: new Date().toISOString(),
    count: endpoints.length,
    endpoints,
  };

  writeFileSync("data.normalized.json", `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`Wrote data.normalized.json (${endpoints.length} endpoints)`);
}

main();
