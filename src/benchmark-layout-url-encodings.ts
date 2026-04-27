import { brotliCompressSync, constants, gunzipSync, gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Table from "cli-table3";

type JsonValue = unknown;

type BuilderState = {
  version: number;
  nextId: number;
  entities: Array<{
    id: string;
    groupId: string;
    templateType: string;
    layer: string;
    segmentIndex: number;
    x: number;
    y: number;
    settings: Record<string, string>;
    isStatic?: boolean;
  }>;
  links: Array<{
    id: string;
    groupId: string;
    fromEntityId: string;
    fromPort: number;
    toEntityId: string;
    toPort: number;
    fromSegmentIndex?: number;
    toSegmentIndex?: number;
    sameLayerSegmentDelta?: number;
    crossLayerBlockSlot?: number;
    voidBandInnerOuterCrossLayer?: boolean;
  }>;
};

type BenchmarkVariant = {
  name: string;
  payload: JsonValue;
  decode?: (payload: JsonValue) => BuilderState;
};

function omitNextIdFromPayload<T extends JsonValue>(payload: T): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const p = payload as Record<string, JsonValue>;
  const { n: _n, ...rest } = p;
  return rest as T;
}

const DEFAULT_TEMP_PATH = "web/src/builder/temp.txt";

const templateCode = new Map<string, number>([
  ["endpoint", 0],
  ["relay", 1],
  ["hub", 2],
  ["filter", 3],
  ["text", 4],
]);

const layerCode = new Map<string, number>([
  ["outer64", 0],
  ["middle16", 1],
  ["inner4", 2],
  ["core1", 3],
]);

const rotationCode = new Map<string, number>([
  ["clockwise", 0],
  ["counterclockwise", 1],
]);

const addressFieldCode = new Map<string, number>([
  ["source", 0],
  ["destination", 1],
]);

const operationCode = new Map<string, number>([
  ["equal", 0],
  ["differ", 1],
]);

const actionCode = new Map<string, number>([
  ["send_back", 0],
  ["drop", 1],
  ["pass", 2],
]);

const collisionCode = new Map<string, number>([
  ["send_back_outbound", 0],
  ["drop", 1],
  ["pass", 2],
]);

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toBase58Btc(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const b of bytes) value = (value << 8n) + BigInt(b);
  let out = "";
  while (value > 0n) {
    const rem = Number(value % 58n);
    out = alphabet[rem] + out;
    value /= 58n;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  if (leadingZeros > 0) out = "1".repeat(leadingZeros) + out;
  return out || "1";
}

function toBase32HexNoPad(bytes: Uint8Array): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUV";
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

function fromBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function encodeBaseN(bytes: Uint8Array, alphabet: string): string {
  if (bytes.length === 0) return "";
  const base = BigInt(alphabet.length);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) + BigInt(b);
  let out = "";
  while (value > 0n) {
    const rem = Number(value % base);
    out = alphabet[rem] + out;
    value /= base;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  if (leadingZeros > 0) out = alphabet[0]!.repeat(leadingZeros) + out;
  return out || alphabet[0]!;
}

// RFC3986 unreserved set (safe in query without percent encoding).
const BASE66_UNRESERVED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~";
const BASE62_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE85_URI_MIXED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
const BASE91_PRINTABLE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"'";

type TextEncoding = "base64url" | "base58btc" | "base32hex" | "base66u" | "base62" | "base85u" | "base91";

function encodeBytesForUrl(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === "base91") return encodeBaseN(bytes, BASE91_PRINTABLE);
  if (encoding === "base85u") return encodeBaseN(bytes, BASE85_URI_MIXED);
  if (encoding === "base66u") return encodeBaseN(bytes, BASE66_UNRESERVED);
  if (encoding === "base62") return encodeBaseN(bytes, BASE62_ALNUM);
  if (encoding === "base58btc") return toBase58Btc(bytes);
  if (encoding === "base32hex") return toBase32HexNoPad(bytes);
  return toBase64Url(bytes);
}

function brotli11Bytes(text: string): Uint8Array {
  return brotliCompressSync(text, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
}

function linkLenForPayloadText(linkPrefix: string, payloadText: string): number {
  return linkPrefix.length + encodeURIComponent(payloadText).length;
}

function brotliBase66LinkLen(text: string, linkPrefix: string): number {
  const payload = encodeBytesForUrl(brotli11Bytes(text), "base66u");
  return linkLenForPayloadText(linkPrefix, payload);
}

function bestGzipBase64LinkLen(text: string, linkPrefix: string): number {
  const gzipDefault = encodeBytesForUrl(gzipSync(text), "base64url");
  const gzip9 = encodeBytesForUrl(gzipSync(text, { level: 9 }), "base64url");
  return Math.min(linkLenForPayloadText(linkPrefix, gzipDefault), linkLenForPayloadText(linkPrefix, gzip9));
}

function extractLayoutToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Input file is empty.");
  if (!trimmed.includes("layout=")) return trimmed;
  try {
    return new URL(trimmed).searchParams.get("layout") ?? trimmed;
  } catch {
    return trimmed;
  }
}

function detectLayoutLinkPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes("layout=")) return "?layout=";
  const marker = "layout=";
  const idx = trimmed.indexOf(marker);
  if (idx < 0) return "?layout=";
  return trimmed.slice(0, idx + marker.length);
}

function decodeLayoutTokenToState(token: string): BuilderState {
  const json = gunzipSync(fromBase64Url(token)).toString("utf8");
  return JSON.parse(json) as BuilderState;
}

function compactJsonLength(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function transformShortKeysOnly(state: BuilderState): JsonValue {
  return {
    v: state.version,
    n: state.nextId,
    e: state.entities.map((e) => ({
      i: e.id,
      g: e.groupId,
      t: e.templateType,
      l: e.layer,
      s: e.segmentIndex,
      x: e.x,
      y: e.y,
      z: e.settings,
      q: e.isStatic ? 1 : undefined,
    })),
    k: state.links.map((l) => ({
      i: l.id,
      g: l.groupId,
      f: l.fromEntityId,
      p: l.fromPort,
      t: l.toEntityId,
      r: l.toPort,
      a: l.fromSegmentIndex,
      b: l.toSegmentIndex,
      d: l.sameLayerSegmentDelta,
      c: l.crossLayerBlockSlot,
      v: l.voidBandInnerOuterCrossLayer ? 1 : undefined,
    })),
  };
}

function decodeShortKeysOnly(payload: JsonValue): BuilderState {
  const p = payload as any;
  const entities = (p.e as any[]).map((e, i) => ({
    id: e.i ?? `e${i + 1}`,
    groupId: e.g ?? e.i ?? `e${i + 1}`,
    templateType: e.t,
    layer: e.l,
    segmentIndex: e.s,
    x: e.x,
    y: e.y,
    settings: e.z ?? {},
    ...(e.q === 1 ? { isStatic: true } : {}),
  }));
  const links = (p.k as any[]).map((l, i) => ({
    id: l.i ?? `l${i + 1}`,
    groupId: l.g ?? l.i ?? `l${i + 1}`,
    fromEntityId: l.f,
    fromPort: l.p,
    toEntityId: l.t,
    toPort: l.r,
    ...(l.a !== undefined ? { fromSegmentIndex: l.a } : {}),
    ...(l.b !== undefined ? { toSegmentIndex: l.b } : {}),
    ...(l.d !== undefined ? { sameLayerSegmentDelta: l.d } : {}),
    ...(l.c !== undefined ? { crossLayerBlockSlot: l.c } : {}),
    ...(l.v === 1 ? { voidBandInnerOuterCrossLayer: true } : {}),
  }));
  return { version: p.v ?? 1, nextId: p.n ?? entities.length + links.length + 1, entities, links };
}

function transformTupleRows(state: BuilderState): JsonValue {
  return {
    v: state.version,
    n: state.nextId,
    e: state.entities.map((e) => [
      e.id,
      e.groupId,
      e.templateType,
      e.layer,
      e.segmentIndex,
      e.x,
      e.y,
      e.settings,
      e.isStatic ? 1 : 0,
    ]),
    l: state.links.map((l) => [
      l.id,
      l.groupId,
      l.fromEntityId,
      l.fromPort,
      l.toEntityId,
      l.toPort,
      l.fromSegmentIndex ?? null,
      l.toSegmentIndex ?? null,
      l.sameLayerSegmentDelta ?? null,
      l.crossLayerBlockSlot ?? null,
      l.voidBandInnerOuterCrossLayer ? 1 : 0,
    ]),
  };
}

function decodeTupleRows(payload: JsonValue): BuilderState {
  const p = payload as any;
  const entities = (p.e as any[]).map((e, i) => ({
    id: e[0] ?? `e${i + 1}`,
    groupId: e[1] ?? e[0] ?? `e${i + 1}`,
    templateType: e[2],
    layer: e[3],
    segmentIndex: e[4],
    x: e[5],
    y: e[6],
    settings: e[7] ?? {},
    ...(e[8] === 1 ? { isStatic: true } : {}),
  }));
  const links = (p.l as any[]).map((l, i) => ({
    id: l[0] ?? `l${i + 1}`,
    groupId: l[1] ?? l[0] ?? `l${i + 1}`,
    fromEntityId: l[2],
    fromPort: l[3],
    toEntityId: l[4],
    toPort: l[5],
    ...(l[6] !== null && l[6] !== undefined ? { fromSegmentIndex: l[6] } : {}),
    ...(l[7] !== null && l[7] !== undefined ? { toSegmentIndex: l[7] } : {}),
    ...(l[8] !== null && l[8] !== undefined ? { sameLayerSegmentDelta: l[8] } : {}),
    ...(l[9] !== null && l[9] !== undefined ? { crossLayerBlockSlot: l[9] } : {}),
    ...(l[10] === 1 ? { voidBandInnerOuterCrossLayer: true } : {}),
  }));
  return { version: p.v ?? 1, nextId: p.n ?? entities.length + links.length + 1, entities, links };
}

function templatePortCountForSchema(templateType: string): number {
  if (templateType === "text") return 0;
  if (templateType === "endpoint") return 1;
  if (templateType === "relay" || templateType === "filter") return 2;
  return 3;
}

function isStaticEndpointLikeId(id: string): boolean {
  return id.startsWith("ol-ep-");
}

function encodeSettingsWithDict(settings: Record<string, string>, dict: Map<string, number>, arr: string[]): JsonValue {
  const out: Array<[number, number]> = [];
  for (const [k, v] of Object.entries(settings)) {
    const key = `${k}\u0000${v}`;
    let idx = dict.get(key);
    if (idx === undefined) {
      idx = arr.length;
      arr.push(key);
      dict.set(key, idx);
    }
    out.push([idx, 1]);
  }
  return out;
}

function transformIndexedDense(state: BuilderState, opts: { removeDefaults: boolean; enumInts: boolean }): JsonValue {
  const idToIndex = new Map<string, number>();
  state.entities.forEach((e, idx) => idToIndex.set(e.id, idx));

  const settingsDict = new Map<string, number>();
  const settingsItems: string[] = [];

  const entities = state.entities.map((e) => {
    const t = opts.enumInts ? (templateCode.get(e.templateType) ?? e.templateType) : e.templateType;
    const l = opts.enumInts ? (layerCode.get(e.layer) ?? e.layer) : e.layer;
    const row: Array<JsonValue> = [t as JsonValue, l as JsonValue, e.segmentIndex, e.x, e.y];
    const hasSettings = Object.keys(e.settings).length > 0;
    if (!opts.removeDefaults || hasSettings) {
      row.push(encodeSettingsWithDict(e.settings, settingsDict, settingsItems));
    }
    if (!opts.removeDefaults || e.isStatic === true) {
      row.push(e.isStatic ? 1 : 0);
    }
    return row;
  });

  const links = state.links.map((l) => {
    const from = idToIndex.get(l.fromEntityId);
    const to = idToIndex.get(l.toEntityId);
    const fromRef: JsonValue = from === undefined ? l.fromEntityId : from;
    const toRef: JsonValue = to === undefined ? l.toEntityId : to;
    const row: Array<JsonValue> = [fromRef, l.fromPort, toRef, l.toPort];
    const optional: Array<number | null> = [
      l.fromSegmentIndex ?? null,
      l.toSegmentIndex ?? null,
      l.sameLayerSegmentDelta ?? null,
      l.crossLayerBlockSlot ?? null,
      l.voidBandInnerOuterCrossLayer ? 1 : null,
    ];
    if (!opts.removeDefaults) {
      row.push(...optional);
      return row;
    }
    while (optional.length > 0 && optional[optional.length - 1] === null) optional.pop();
    row.push(...optional);
    return row;
  });

  return {
    v: state.version,
    n: state.nextId,
    f: {
      e: ["type", "layer", "segmentIndex", "x", "y", "settings?", "isStatic?"],
      l: ["fromIdx", "fromPort", "toIdx", "toPort", "fromSeg?", "toSeg?", "delta?", "slot?", "void?"],
    },
    d: settingsItems,
    e: entities,
    l: links,
  };
}

function decodeIndexedDense(payload: JsonValue): BuilderState {
  const p = payload as any;
  const settingsItems = (p.d ?? []) as string[];
  const entities = (p.e as any[]).map((row, i) => {
    const typeRaw = row[0];
    const layerRaw = row[1];
    const templateType = typeof typeRaw === "number" ? [...templateCode.entries()].find((x) => x[1] === typeRaw)?.[0] : typeRaw;
    const layer = typeof layerRaw === "number" ? [...layerCode.entries()].find((x) => x[1] === layerRaw)?.[0] : layerRaw;
    const settingsRefs = Array.isArray(row[5]) ? row[5] : [];
    const settings: Record<string, string> = {};
    for (const refPair of settingsRefs) {
      const ref = Array.isArray(refPair) ? refPair[0] : refPair;
      const s = settingsItems[ref];
      if (typeof s !== "string") continue;
      const split = s.indexOf("\u0000");
      if (split <= 0) continue;
      settings[s.slice(0, split)] = s.slice(split + 1);
    }
    return {
      id: `e${i + 1}`,
      groupId: `e${i + 1}`,
      templateType: templateType ?? "endpoint",
      layer: layer ?? "outer64",
      segmentIndex: row[2] ?? 0,
      x: row[3] ?? 0,
      y: row[4] ?? 0,
      settings,
      ...(row[6] === 1 ? { isStatic: true } : {}),
    };
  });
  const links = (p.l as any[]).map((row, i) => {
    const fromRef = row[0];
    const toRef = row[2];
    const fromEntityId = typeof fromRef === "number" ? `e${fromRef + 1}` : String(fromRef);
    const toEntityId = typeof toRef === "number" ? `e${toRef + 1}` : String(toRef);
    return {
      id: `l${i + 1}`,
      groupId: `l${i + 1}`,
      fromEntityId,
      fromPort: row[1] ?? 0,
      toEntityId,
      toPort: row[3] ?? 0,
      ...(row[4] !== null && row[4] !== undefined ? { fromSegmentIndex: row[4] } : {}),
      ...(row[5] !== null && row[5] !== undefined ? { toSegmentIndex: row[5] } : {}),
      ...(row[6] !== null && row[6] !== undefined ? { sameLayerSegmentDelta: row[6] } : {}),
      ...(row[7] !== null && row[7] !== undefined ? { crossLayerBlockSlot: row[7] } : {}),
      ...(row[8] === 1 ? { voidBandInnerOuterCrossLayer: true } : {}),
    };
  });
  return { version: p.v ?? 1, nextId: p.n ?? entities.length + links.length + 1, entities, links };
}

function pushDict(dict: Map<string, number>, arr: string[], value: string): number {
  let idx = dict.get(value);
  if (idx === undefined) {
    idx = arr.length;
    arr.push(value);
    dict.set(value, idx);
  }
  return idx;
}

function numOr(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function transformTypedSettingsLinkOpcodes(state: BuilderState): JsonValue {
  const idToIndex = new Map<string, number>();
  state.entities.forEach((e, i) => idToIndex.set(e.id, i));

  const strDict = new Map<string, number>();
  const strings: string[] = [];

  const entities = state.entities.map((e) => {
    const t = templateCode.get(e.templateType) ?? 0;
    const l = layerCode.get(e.layer) ?? 0;
    const row: Array<JsonValue> = [t, l, e.segmentIndex, e.x, e.y];

    if (e.templateType === "endpoint") {
      const address = e.settings.address ?? "0.0.0.0";
      if (address !== "0.0.0.0") row.push([pushDict(strDict, strings, address)]);
    } else if (e.templateType === "relay") {
      const angle = ((numOr(e.settings.angle, 0) % 360) + 360) % 360;
      row.push([Math.floor(angle / 90) % 4]);
    } else if (e.templateType === "hub") {
      const rot = rotationCode.get(e.settings.rotation ?? "clockwise") ?? 0;
      const face = (((numOr(e.settings.faceAngle, 0) % 360) + 360) % 360) / 30;
      row.push([rot, Math.floor(face) % 12]);
    } else if (e.templateType === "text") {
      const label = e.settings.label ?? "";
      const w = numOr(e.settings.widthTiles, 2);
      const h = numOr(e.settings.heightTiles, 2);
      row.push([pushDict(strDict, strings, label), w, h]);
    } else if (e.templateType === "filter") {
      const opPort = numOr(e.settings.operatingPort, 0);
      const af = pushDict(strDict, strings, e.settings.addressField ?? "destination");
      const op = pushDict(strDict, strings, e.settings.operation ?? "differ");
      const mask = pushDict(strDict, strings, e.settings.mask ?? "*.*.*.*");
      const action = pushDict(strDict, strings, e.settings.action ?? "send_back");
      const coll = pushDict(strDict, strings, e.settings.collisionHandling ?? "drop_inbound");
      row.push([opPort, af, op, mask, action, coll]);
    }

    if (e.isStatic === true) row.push(1);
    return row;
  });

  // Link opcodes:
  // 0: base [f,fp,t,tp,0]
  // 1: same-entity pin [f,fp,t,tp,1,fromSeg,toSeg]
  // 2: same-layer delta [f,fp,t,tp,2,delta]
  // 3: cross-layer slot [f,fp,t,tp,3,slot,void]
  const links = state.links.map((l) => {
    const from = idToIndex.get(l.fromEntityId);
    const to = idToIndex.get(l.toEntityId);
    const fromRef: JsonValue = from === undefined ? l.fromEntityId : from;
    const toRef: JsonValue = to === undefined ? l.toEntityId : to;

    if (l.fromSegmentIndex !== undefined && l.toSegmentIndex !== undefined) {
      return [fromRef, l.fromPort, toRef, l.toPort, 1, l.fromSegmentIndex, l.toSegmentIndex];
    }
    if (l.sameLayerSegmentDelta !== undefined) {
      return [fromRef, l.fromPort, toRef, l.toPort, 2, l.sameLayerSegmentDelta];
    }
    if (l.crossLayerBlockSlot !== undefined || l.voidBandInnerOuterCrossLayer === true) {
      return [fromRef, l.fromPort, toRef, l.toPort, 3, l.crossLayerBlockSlot ?? 0, l.voidBandInnerOuterCrossLayer ? 1 : 0];
    }
    return [fromRef, l.fromPort, toRef, l.toPort, 0];
  });

  return {
    v: 3,
    n: state.nextId,
    s: strings,
    e: entities,
    l: links,
  };
}

function decodeTypedSettingsLinkOpcodes(payload: JsonValue): BuilderState {
  const p = payload as any;
  const strings = (p.s ?? []) as string[];
  const entities = (p.e as any[]).map((row, i) => {
    const t = [...templateCode.entries()].find((x) => x[1] === row[0])?.[0] ?? "endpoint";
    const l = [...layerCode.entries()].find((x) => x[1] === row[1])?.[0] ?? "outer64";
    const settings: Record<string, string> = {};
    const settingsPayload = row[5];
    if (Array.isArray(settingsPayload)) {
      if (t === "endpoint") {
        const idx = settingsPayload[0];
        if (typeof idx === "number") settings.address = strings[idx] ?? "0.0.0.0";
      } else if (t === "relay") {
        const code = settingsPayload[0] ?? 0;
        settings.angle = String((code % 4) * 90);
      } else if (t === "hub") {
        settings.rotation = [...rotationCode.entries()].find((x) => x[1] === (settingsPayload[0] ?? 0))?.[0] ?? "clockwise";
        settings.faceAngle = String(((settingsPayload[1] ?? 0) % 12) * 30);
      } else if (t === "text") {
        const labelIdx = settingsPayload[0];
        settings.label = typeof labelIdx === "number" ? (strings[labelIdx] ?? "") : "";
        settings.widthTiles = String(settingsPayload[1] ?? 2);
        settings.heightTiles = String(settingsPayload[2] ?? 2);
      } else if (t === "filter") {
        settings.operatingPort = String(settingsPayload[0] ?? 0);
        const afIdx = settingsPayload[1];
        settings.addressField = typeof afIdx === "number" ? (strings[afIdx] ?? "destination") : "destination";
        const opIdx = settingsPayload[2];
        settings.operation = typeof opIdx === "number" ? (strings[opIdx] ?? "differ") : "differ";
        const maskIdx = settingsPayload[3];
        settings.mask = typeof maskIdx === "number" ? (strings[maskIdx] ?? "*.*.*.*") : "*.*.*.*";
        const actionIdx = settingsPayload[4];
        settings.action = typeof actionIdx === "number" ? (strings[actionIdx] ?? "send_back") : "send_back";
        const collIdx = settingsPayload[5];
        settings.collisionHandling = typeof collIdx === "number" ? (strings[collIdx] ?? "drop_inbound") : "drop_inbound";
      }
    }
    return {
      id: `e${i + 1}`,
      groupId: `e${i + 1}`,
      templateType: t,
      layer: l,
      segmentIndex: row[2] ?? 0,
      x: row[3] ?? 0,
      y: row[4] ?? 0,
      settings,
      ...(row[6] === 1 ? { isStatic: true } : {}),
    };
  });
  const links = (p.l as any[]).map((row, i) => {
    const fromRef = row[0];
    const toRef = row[2];
    const fromEntityId = typeof fromRef === "number" ? `e${fromRef + 1}` : String(fromRef);
    const toEntityId = typeof toRef === "number" ? `e${toRef + 1}` : String(toRef);
    const opcode = row[4] ?? 0;
    return {
      id: `l${i + 1}`,
      groupId: `l${i + 1}`,
      fromEntityId,
      fromPort: row[1] ?? 0,
      toEntityId,
      toPort: row[3] ?? 0,
      ...(opcode === 1 ? { fromSegmentIndex: row[5], toSegmentIndex: row[6] } : {}),
      ...(opcode === 2 ? { sameLayerSegmentDelta: row[5] } : {}),
      ...(opcode === 3 ? { crossLayerBlockSlot: row[5], ...(row[6] === 1 ? { voidBandInnerOuterCrossLayer: true } : {}) } : {}),
    };
  });
  return { version: 1, nextId: p.n ?? entities.length + links.length + 1, entities, links };
}

function decodeTypedSettingsLinkOpcodesImplicitDefaults(payload: JsonValue): BuilderState {
  const out = decodeTypedSettingsLinkOpcodes(payload);
  return applyImplicitDefaultsToTypedState(out);
}

function applyImplicitDefaultsToTypedState(out: BuilderState): BuilderState {
  const entities = out.entities.map((e) => {
    if (e.templateType === "relay") {
      return { ...e, settings: { angle: "0", ...e.settings } };
    }
    if (e.templateType === "hub") {
      return { ...e, settings: { rotation: "clockwise", faceAngle: "0", ...e.settings } };
    }
    if (e.templateType === "text") {
      return { ...e, settings: { label: "", widthTiles: "2", heightTiles: "2", ...e.settings } };
    }
    if (e.templateType === "filter") {
      return {
        ...e,
        settings: {
          operatingPort: "0",
          addressField: "destination",
          operation: "differ",
          mask: "*.*.*.*",
          action: "send_back",
          collisionHandling: "drop_inbound",
          ...e.settings,
        },
      };
    }
    if (e.templateType === "endpoint") {
      return { ...e, settings: { address: "0.0.0.0", ...e.settings } };
    }
    return e;
  });
  return { ...out, entities };
}

function transformTypedOpcodesDropDefaults(payload: JsonValue): JsonValue {
  const p = payload as any;
  const strings = (p.s ?? []) as string[];
  const entities = ((p.e ?? []) as any[]).map((row) => {
    if (!Array.isArray(row)) return row;
    const out = [...row];
    const t = Number(out[0] ?? 0);
    const settingsPayload = out[5];
    if (!Array.isArray(settingsPayload)) return out;

    // endpoint: already sparse, keep as-is.
    if (t === 1) {
      // relay default angle 0
      if ((settingsPayload[0] ?? 0) === 0) out[5] = undefined;
    } else if (t === 2) {
      // hub defaults rotation clockwise(0), face 0
      if ((settingsPayload[0] ?? 0) === 0 && (settingsPayload[1] ?? 0) === 0) out[5] = undefined;
    } else if (t === 4) {
      // text defaults label "", 2x2
      const labelIdx = settingsPayload[0];
      const label = typeof labelIdx === "number" ? (strings[labelIdx] ?? "") : "";
      if (label === "" && Number(settingsPayload[1] ?? 2) === 2 && Number(settingsPayload[2] ?? 2) === 2) {
        out[5] = undefined;
      }
    } else if (t === 3) {
      // filter full defaults
      const af = typeof settingsPayload[1] === "number" ? (strings[settingsPayload[1]] ?? "destination") : "destination";
      const op = typeof settingsPayload[2] === "number" ? (strings[settingsPayload[2]] ?? "differ") : "differ";
      const mask = typeof settingsPayload[3] === "number" ? (strings[settingsPayload[3]] ?? "*.*.*.*") : "*.*.*.*";
      const action = typeof settingsPayload[4] === "number" ? (strings[settingsPayload[4]] ?? "send_back") : "send_back";
      const coll = typeof settingsPayload[5] === "number"
        ? (strings[settingsPayload[5]] ?? "drop_inbound")
        : "drop_inbound";
      if (
        Number(settingsPayload[0] ?? 0) === 0 &&
        af === "destination" &&
        op === "differ" &&
        mask === "*.*.*.*" &&
        action === "send_back" &&
        coll === "drop_inbound"
      ) {
        out[5] = undefined;
      }
    }
    while (out.length > 0 && out[out.length - 1] === undefined) out.pop();
    return out;
  });
  return { ...p, e: entities };
}

function canonicalizeJsonObjectKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonObjectKeys(item));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, JsonValue>;
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    out[key] = canonicalizeJsonObjectKeys(obj[key]);
  }
  return out;
}

function remapSettingsStringIndexes(templateTypeCode: number, settingsPayload: unknown, remap: Map<number, number>): unknown {
  if (!Array.isArray(settingsPayload)) return settingsPayload;
  const out = [...settingsPayload];
  const mapIdx = (pos: number): void => {
    const oldIdx = out[pos];
    if (typeof oldIdx === "number") out[pos] = remap.get(oldIdx) ?? oldIdx;
  };
  if (templateTypeCode === 0) {
    mapIdx(0);
  } else if (templateTypeCode === 4) {
    mapIdx(0);
  } else if (templateTypeCode === 3) {
    mapIdx(1);
    mapIdx(2);
    mapIdx(3);
    mapIdx(4);
    mapIdx(5);
  }
  return out;
}

function reorderTypedStringTableByFrequency(payload: JsonValue): JsonValue {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const p = payload as Record<string, JsonValue>;
  const strings = Array.isArray(p.s) ? (p.s as string[]) : null;
  const entities = Array.isArray(p.e) ? (p.e as any[]) : null;
  if (!strings || !entities || strings.length === 0) return payload;

  const freq = new Map<number, number>();
  const bump = (idx: unknown, weight = 1): void => {
    if (typeof idx !== "number") return;
    freq.set(idx, (freq.get(idx) ?? 0) + weight);
  };

  const templates = Array.isArray(p.t) ? (p.t as any[]) : null;
  if (templates) {
    const tplUse = new Map<number, number>();
    for (const e of entities) {
      if (!Array.isArray(e)) continue;
      const tplIdx = e[5];
      if (typeof tplIdx === "number") tplUse.set(tplIdx, (tplUse.get(tplIdx) ?? 0) + 1);
    }
    templates.forEach((tpl, idx) => {
      if (!Array.isArray(tpl) || tpl.length < 2) return;
      const t = Number(tpl[0] ?? 0);
      const s = tpl[1];
      const weight = tplUse.get(idx) ?? 0;
      if (weight <= 0 || !Array.isArray(s)) return;
      if (t === 0 || t === 4) {
        bump(s[0], weight);
      } else if (t === 3) {
        bump(s[1], weight);
        bump(s[2], weight);
        bump(s[3], weight);
        bump(s[4], weight);
        bump(s[5], weight);
      }
    });
  } else {
    for (const e of entities) {
      if (!Array.isArray(e)) continue;
      const t = Number(e[0] ?? 0);
      const s = e[5];
      if (!Array.isArray(s)) continue;
      if (t === 0 || t === 4) {
        bump(s[0]);
      } else if (t === 3) {
        bump(s[1]);
        bump(s[2]);
        bump(s[3]);
        bump(s[4]);
        bump(s[5]);
      }
    }
  }

  const ranked = strings.map((text, idx) => ({ idx, text, f: freq.get(idx) ?? 0 }));
  ranked.sort((a, b) => b.f - a.f || a.text.localeCompare(b.text) || a.idx - b.idx);
  const remap = new Map<number, number>();
  ranked.forEach((r, i) => remap.set(r.idx, i));
  const reorderedStrings = ranked.map((r) => r.text);

  const out: Record<string, JsonValue> = { ...p, s: reorderedStrings };
  if (templates) {
    out.t = templates.map((tpl) => {
      if (!Array.isArray(tpl) || tpl.length < 2) return tpl;
      const t = Number(tpl[0] ?? 0);
      return [tpl[0], remapSettingsStringIndexes(t, tpl[1], remap)];
    });
  } else {
    out.e = entities.map((e) => {
      if (!Array.isArray(e)) return e;
      const next = [...e];
      const t = Number(next[0] ?? 0);
      next[5] = remapSettingsStringIndexes(t, next[5], remap);
      return next;
    });
  }
  return out;
}

function transformTypedSettingsLinkOpcodesWithTemplates(
  state: BuilderState,
  opts: { packPorts: boolean },
): JsonValue {
  const base = transformTypedSettingsLinkOpcodes(state) as {
    v: number;
    n: number;
    s: string[];
    e: Array<any[]>;
    l: Array<any[]>;
  };

  const templateDict = new Map<string, number>();
  const templates: JsonValue[] = [];
  const entities = base.e.map((row) => {
    const next = [...row];
    const settingsPayload = next[5];
    if (Array.isArray(settingsPayload)) {
      const key = JSON.stringify([next[0], settingsPayload]);
      let idx = templateDict.get(key);
      if (idx === undefined) {
        idx = templates.length;
        templates.push([next[0], settingsPayload]);
        templateDict.set(key, idx);
      }
      next[5] = idx;
    }
    return next;
  });

  const links = base.l.map((row) => {
    if (!opts.packPorts) return row;
    const next = [...row];
    const fromPort = Number(next[1] ?? 0);
    const toPort = Number(next[3] ?? 0);
    const packedPorts = fromPort * 4 + toPort;
    // [from,to,packedPorts,kind,...args]
    return [next[0], next[2], packedPorts, next[4], ...next.slice(5)];
  });

  return {
    v: opts.packPorts ? 8 : 7,
    n: base.n,
    s: base.s,
    t: templates,
    e: entities,
    l: links,
    ...(opts.packPorts ? { p: 1 } : {}),
  };
}

function decodeTypedSettingsLinkOpcodesWithTemplates(payload: JsonValue): BuilderState {
  const p = payload as any;
  const templates = (p.t ?? []) as any[];
  const packedPorts = p.p === 1;

  const expandedEntities = ((p.e ?? []) as any[]).map((row) => {
    const next = [...row];
    if (typeof next[5] === "number") {
      const tpl = templates[next[5]];
      if (Array.isArray(tpl) && tpl.length >= 2) {
        next[0] = tpl[0];
        next[5] = tpl[1];
      }
    }
    return next;
  });

  const expandedLinks = ((p.l ?? []) as any[]).map((row) => {
    if (!packedPorts) return row;
    // row: [from,to,packedPorts,kind,...args] => [from,fromPort,to,toPort,kind,...args]
    const packed = Number(row[2] ?? 0);
    const fromPort = Math.floor(packed / 4);
    const toPort = packed % 4;
    return [row[0], fromPort, row[1], toPort, row[3], ...row.slice(4)];
  });

  return decodeTypedSettingsLinkOpcodes({
    v: 3,
    n: p.n,
    s: p.s,
    e: expandedEntities,
    l: expandedLinks,
  });
}

function transformTypedWithEndpointIdTable(
  state: BuilderState,
  opts: { useTemplates: boolean; packPorts: boolean; omitNextId: boolean },
): JsonValue {
  let payload: Record<string, JsonValue>;
  let useTemplates = opts.useTemplates;
  if (useTemplates) {
    payload = transformTypedSettingsLinkOpcodesWithTemplates(state, { packPorts: opts.packPorts }) as Record<string, JsonValue>;
  } else {
    payload = transformTypedSettingsLinkOpcodes(state) as Record<string, JsonValue>;
    useTemplates = false;
  }

  // Replace frequent static endpoint IDs with short table refs.
  const endpointIds = new Set<string>();
  const links = (payload.l as any[]).map((row) => {
    if (!Array.isArray(row) || row.length < 4) return row;
    const out = [...row];
    const refs: Array<{ idx: number; value: unknown }> = useTemplates && opts.packPorts
      ? [
          { idx: 0, value: out[0] },
          { idx: 1, value: out[1] },
        ]
      : [
          { idx: 0, value: out[0] },
          { idx: 2, value: out[2] },
        ];
    for (const r of refs) {
      if (typeof r.value === "string" && r.value.startsWith("ol-ep-")) endpointIds.add(r.value);
    }
    return out;
  });

  const endpointTable = [...endpointIds].sort();
  const endpointIndex = new Map(endpointTable.map((id, i) => [id, i]));
  const remappedLinks = links.map((row) => {
    if (!Array.isArray(row) || row.length < 4) return row;
    const out = [...row];
    const positions = useTemplates && opts.packPorts ? [0, 1] : [0, 2];
    for (const pos of positions) {
      const v = out[pos];
      if (typeof v === "string" && endpointIndex.has(v)) {
        out[pos] = ["@", endpointIndex.get(v)];
      }
    }
    return out;
  });

  const next: Record<string, JsonValue> = {
    ...payload,
    l: remappedLinks,
    ...(endpointTable.length > 0 ? { q: endpointTable } : {}),
  };
  if (opts.omitNextId) {
    const { n: _n, ...rest } = next;
    return rest;
  }
  return next;
}

function decodeTypedWithEndpointIdTable(payload: JsonValue): BuilderState {
  const p = payload as any;
  const table = (p.q ?? []) as string[];
  const restoreRef = (v: unknown): unknown => {
    if (Array.isArray(v) && v.length === 2 && v[0] === "@" && typeof v[1] === "number") {
      return table[v[1]] ?? v;
    }
    return v;
  };
  const links = ((p.l ?? []) as any[]).map((row) => {
    if (!Array.isArray(row) || row.length < 4) return row;
    const out = [...row];
    out[0] = restoreRef(out[0]);
    if (p.p === 1) {
      out[1] = restoreRef(out[1]);
    } else {
      out[2] = restoreRef(out[2]);
    }
    return out;
  });

  const rebuilt = { ...p, l: links };
  if (p.t !== undefined) return decodeTypedSettingsLinkOpcodesWithTemplates(rebuilt);
  return decodeTypedSettingsLinkOpcodes(rebuilt);
}

function semanticSignature(state: BuilderState): string {
  const idToIndex = new Map<string, number>();
  state.entities.forEach((e, i) => idToIndex.set(e.id, i));
  const entities = state.entities.map((e) => ({
    t: e.templateType,
    l: e.layer,
    s: e.segmentIndex,
    x: e.x,
    y: e.y,
    i: e.isStatic === true ? 1 : 0,
    z: Object.entries(e.settings).sort(([a], [b]) => a.localeCompare(b)),
  }));
  const links = state.links.map((l) => ({
    f: idToIndex.get(l.fromEntityId) ?? l.fromEntityId,
    fp: l.fromPort,
    t: idToIndex.get(l.toEntityId) ?? l.toEntityId,
    tp: l.toPort,
    fs: l.fromSegmentIndex ?? null,
    ts: l.toSegmentIndex ?? null,
    d: l.sameLayerSegmentDelta ?? null,
    c: l.crossLayerBlockSlot ?? null,
    v: l.voidBandInnerOuterCrossLayer === true ? 1 : 0,
  }));
  return JSON.stringify({ entities, links });
}

function sortedSettings(settings: Record<string, string>): Array<[string, string]> {
  return Object.entries(settings).sort(([a], [b]) => a.localeCompare(b));
}

function firstStateDifference(expected: BuilderState, actual: BuilderState): string | null {
  if (expected.entities.length !== actual.entities.length) {
    return `entities.length expected=${expected.entities.length} actual=${actual.entities.length}`;
  }
  if (expected.links.length !== actual.links.length) {
    return `links.length expected=${expected.links.length} actual=${actual.links.length}`;
  }

  const expectedEntityById = new Map(expected.entities.map((e) => [e.id, e]));
  const actualEntityById = new Map(actual.entities.map((e) => [e.id, e]));
  const idToIndex = new Map(expected.entities.map((e, i) => [e.id, i]));

  for (const [id, e] of expectedEntityById) {
    const a = actualEntityById.get(id);
    if (!a) return `entities[${id}] missing in reconstructed state`;
    const checks: Array<[string, unknown, unknown]> = [
      ["templateType", e.templateType, a.templateType],
      ["layer", e.layer, a.layer],
      ["segmentIndex", e.segmentIndex, a.segmentIndex],
      ["x", e.x, a.x],
      ["y", e.y, a.y],
      ["isStatic", e.isStatic === true, a.isStatic === true],
    ];
    for (const [k, ev, av] of checks) {
      if (ev !== av) return `entities[${id}].${k} expected=${String(ev)} actual=${String(av)}`;
    }
    const es = sortedSettings(e.settings);
    const as = sortedSettings(a.settings);
    if (es.length !== as.length) {
      return `entities[${id}].settings.length expected=${es.length} actual=${as.length}`;
    }
    for (let i = 0; i < es.length; i += 1) {
      const [ek, ev] = es[i]!;
      const [ak, av] = as[i]!;
      if (ek !== ak || ev !== av) {
        return `entities[${id}].settings[${i}] expected=${ek}=${ev} actual=${ak}=${av}`;
      }
    }
  }

  const normalizeLink = (l: BuilderState["links"][number]) => ({
    f: idToIndex.get(l.fromEntityId) ?? l.fromEntityId,
    fp: l.fromPort,
    t: idToIndex.get(l.toEntityId) ?? l.toEntityId,
    tp: l.toPort,
    fs: l.fromSegmentIndex ?? null,
    ts: l.toSegmentIndex ?? null,
    d: l.sameLayerSegmentDelta ?? null,
    c: l.crossLayerBlockSlot ?? null,
    v: l.voidBandInnerOuterCrossLayer === true ? 1 : 0,
  });

  for (let i = 0; i < expected.links.length; i += 1) {
    const el = normalizeLink(expected.links[i]!);
    const al = normalizeLink(actual.links[i]!);
    const keys: Array<keyof typeof el> = ["f", "fp", "t", "tp", "fs", "ts", "d", "c", "v"];
    for (const k of keys) {
      if (el[k] !== al[k]) {
        return `links[${i}].${k} expected=${String(el[k])} actual=${String(al[k])}`;
      }
    }
  }

  return null;
}

function quantizeToInt(value: number): number {
  return Math.round(value);
}

function transformTypedSettingsLinkOpcodesAggressive(
  state: BuilderState,
  opts: {
    quantizeXY: boolean;
    omitNextId: boolean;
    elideStaticOuterEndpoints: boolean;
  },
): JsonValue {
  let working = state;
  if (opts.elideStaticOuterEndpoints) {
    const keep = working.entities.filter(
      (e) => !(e.templateType === "endpoint" && e.layer === "outer64" && e.isStatic === true),
    );
    const keepIds = new Set(keep.map((e) => e.id));
    const links = working.links.filter((l) => keepIds.has(l.fromEntityId) && keepIds.has(l.toEntityId));
    working = { ...working, entities: keep, links };
  }

  const idToIndex = new Map<string, number>();
  working.entities.forEach((e, i) => idToIndex.set(e.id, i));

  const strDict = new Map<string, number>();
  const strings: string[] = [];

  const entities = working.entities.map((e) => {
    const t = templateCode.get(e.templateType) ?? 0;
    const l = layerCode.get(e.layer) ?? 0;
    const x = opts.quantizeXY ? quantizeToInt(e.x) : e.x;
    const y = opts.quantizeXY ? quantizeToInt(e.y) : e.y;
    const row: Array<JsonValue> = [t, l, e.segmentIndex, x, y];

    if (e.templateType === "endpoint") {
      const address = e.settings.address ?? "0.0.0.0";
      if (address !== "0.0.0.0") row.push([pushDict(strDict, strings, address)]);
    } else if (e.templateType === "relay") {
      const angle = ((numOr(e.settings.angle, 0) % 360) + 360) % 360;
      row.push([Math.floor(angle / 90) % 4]);
    } else if (e.templateType === "hub") {
      const rot = rotationCode.get(e.settings.rotation ?? "clockwise") ?? 0;
      const face = (((numOr(e.settings.faceAngle, 0) % 360) + 360) % 360) / 30;
      row.push([rot, Math.floor(face) % 12]);
    } else if (e.templateType === "text") {
      const label = e.settings.label ?? "";
      const w = numOr(e.settings.widthTiles, 2);
      const h = numOr(e.settings.heightTiles, 2);
      row.push([pushDict(strDict, strings, label), w, h]);
    } else if (e.templateType === "filter") {
      const opPort = numOr(e.settings.operatingPort, 0);
      const af = pushDict(strDict, strings, e.settings.addressField ?? "destination");
      const op = pushDict(strDict, strings, e.settings.operation ?? "differ");
      const mask = pushDict(strDict, strings, e.settings.mask ?? "*.*.*.*");
      const action = pushDict(strDict, strings, e.settings.action ?? "send_back");
      const coll = pushDict(strDict, strings, e.settings.collisionHandling ?? "drop_inbound");
      row.push([opPort, af, op, mask, action, coll]);
    }

    if (e.isStatic === true) row.push(1);
    return row;
  });

  const links = working.links.map((l) => {
    const from = idToIndex.get(l.fromEntityId);
    const to = idToIndex.get(l.toEntityId);
    const fromRef: JsonValue = from === undefined ? l.fromEntityId : from;
    const toRef: JsonValue = to === undefined ? l.toEntityId : to;

    if (l.fromSegmentIndex !== undefined && l.toSegmentIndex !== undefined) {
      return [fromRef, l.fromPort, toRef, l.toPort, 1, l.fromSegmentIndex, l.toSegmentIndex];
    }
    if (l.sameLayerSegmentDelta !== undefined) {
      return [fromRef, l.fromPort, toRef, l.toPort, 2, l.sameLayerSegmentDelta];
    }
    if (l.crossLayerBlockSlot !== undefined || l.voidBandInnerOuterCrossLayer === true) {
      return [fromRef, l.fromPort, toRef, l.toPort, 3, l.crossLayerBlockSlot ?? 0, l.voidBandInnerOuterCrossLayer ? 1 : 0];
    }
    return [fromRef, l.fromPort, toRef, l.toPort, 0];
  });

  const payload: Record<string, JsonValue> = {
    v: 4,
    s: strings,
    e: entities,
    l: links,
  };
  if (!opts.omitNextId) payload.n = working.nextId;
  if (opts.elideStaticOuterEndpoints) payload.m = 1; // mark that static outer endpoints were elided
  if (opts.quantizeXY) payload.q = 1; // mark quantized coordinates
  return payload;
}

function transformTypedSettingsUndirectedWires(state: BuilderState): JsonValue {
  const idToIndex = new Map<string, number>();
  state.entities.forEach((e, i) => idToIndex.set(e.id, i));

  const strDict = new Map<string, number>();
  const strings: string[] = [];

  const entities = state.entities.map((e) => {
    const t = templateCode.get(e.templateType) ?? 0;
    const l = layerCode.get(e.layer) ?? 0;
    const row: Array<JsonValue> = [t, l, e.segmentIndex, e.x, e.y];
    if (e.templateType === "endpoint") {
      const address = e.settings.address ?? "0.0.0.0";
      if (address !== "0.0.0.0") row.push([pushDict(strDict, strings, address)]);
    } else if (e.templateType === "relay") {
      const angle = ((numOr(e.settings.angle, 0) % 360) + 360) % 360;
      row.push([Math.floor(angle / 90) % 4]);
    } else if (e.templateType === "hub") {
      const rot = rotationCode.get(e.settings.rotation ?? "clockwise") ?? 0;
      const face = (((numOr(e.settings.faceAngle, 0) % 360) + 360) % 360) / 30;
      row.push([rot, Math.floor(face) % 12]);
    } else if (e.templateType === "text") {
      const label = e.settings.label ?? "";
      const w = numOr(e.settings.widthTiles, 2);
      const h = numOr(e.settings.heightTiles, 2);
      row.push([pushDict(strDict, strings, label), w, h]);
    } else if (e.templateType === "filter") {
      const opPort = numOr(e.settings.operatingPort, 0);
      const af = pushDict(strDict, strings, e.settings.addressField ?? "destination");
      const op = pushDict(strDict, strings, e.settings.operation ?? "differ");
      const mask = pushDict(strDict, strings, e.settings.mask ?? "*.*.*.*");
      const action = pushDict(strDict, strings, e.settings.action ?? "send_back");
      const coll = pushDict(strDict, strings, e.settings.collisionHandling ?? "drop_inbound");
      row.push([opPort, af, op, mask, action, coll]);
    }
    if (e.isStatic === true) row.push(1);
    return row;
  });

  // [aIdx,aPort,bIdx,bPort,dir,kind,arg1?,arg2?]
  // dir: 0 => original was a->b, 1 => original was b->a
  const wires = state.links.map((l) => {
    const f = idToIndex.get(l.fromEntityId);
    const t = idToIndex.get(l.toEntityId);
    const fromRef: JsonValue = f === undefined ? l.fromEntityId : f;
    const toRef: JsonValue = t === undefined ? l.toEntityId : t;
    const shouldSwap = typeof fromRef === "number" && typeof toRef === "number"
      ? fromRef > toRef || (fromRef === toRef && l.fromPort > l.toPort)
      : false;
    const aRef = shouldSwap ? toRef : fromRef;
    const bRef = shouldSwap ? fromRef : toRef;
    const aPort = shouldSwap ? l.toPort : l.fromPort;
    const bPort = shouldSwap ? l.fromPort : l.toPort;
    const dir = shouldSwap ? 1 : 0;
    if (l.fromSegmentIndex !== undefined && l.toSegmentIndex !== undefined) {
      const s1 = shouldSwap ? l.toSegmentIndex : l.fromSegmentIndex;
      const s2 = shouldSwap ? l.fromSegmentIndex : l.toSegmentIndex;
      return [aRef, aPort, bRef, bPort, dir, 1, s1, s2];
    }
    if (l.sameLayerSegmentDelta !== undefined) {
      return [aRef, aPort, bRef, bPort, dir, 2, shouldSwap ? -l.sameLayerSegmentDelta : l.sameLayerSegmentDelta];
    }
    if (l.crossLayerBlockSlot !== undefined || l.voidBandInnerOuterCrossLayer === true) {
      return [aRef, aPort, bRef, bPort, dir, 3, l.crossLayerBlockSlot ?? 0, l.voidBandInnerOuterCrossLayer ? 1 : 0];
    }
    return [aRef, aPort, bRef, bPort, dir, 0];
  });

  return { v: 6, n: state.nextId, s: strings, e: entities, w: wires };
}

function decodeTypedSettingsUndirectedWires(payload: JsonValue): BuilderState {
  const p = payload as any;
  const base = decodeTypedSettingsLinkOpcodes({ v: 3, n: p.n, s: p.s, e: p.e, l: [] });
  if (!base) return { version: 1, nextId: 1, entities: [], links: [] };
  const links = ((p.w ?? []) as any[]).map((row, i) => {
    const aRef = row[0];
    const bRef = row[2];
    const aId = typeof aRef === "number" ? `e${aRef + 1}` : String(aRef);
    const bId = typeof bRef === "number" ? `e${bRef + 1}` : String(bRef);
    const dir = Number(row[4] ?? 0);
    const kind = Number(row[5] ?? 0);
    const fromEntityId = dir === 0 ? aId : bId;
    const toEntityId = dir === 0 ? bId : aId;
    const fromPort = dir === 0 ? (row[1] ?? 0) : (row[3] ?? 0);
    const toPort = dir === 0 ? (row[3] ?? 0) : (row[1] ?? 0);
    const arg1 = row[6];
    const arg2 = row[7];
    return {
      id: `l${i + 1}`,
      groupId: `l${i + 1}`,
      fromEntityId,
      fromPort,
      toEntityId,
      toPort,
      ...(kind === 1
        ? dir === 0
          ? { fromSegmentIndex: arg1, toSegmentIndex: arg2 }
          : { fromSegmentIndex: arg2, toSegmentIndex: arg1 }
        : {}),
      ...(kind === 2 ? { sameLayerSegmentDelta: dir === 0 ? arg1 : -Number(arg1 ?? 0) } : {}),
      ...(kind === 3 ? { crossLayerBlockSlot: arg1, ...(arg2 === 1 ? { voidBandInnerOuterCrossLayer: true } : {}) } : {}),
    };
  });
  return { ...base, links };
}

function runBenchmark(token: string, sourceLabel: string, linkPrefix: string): void {
  const state = decodeLayoutTokenToState(token);
  const baselineJson = JSON.stringify(state);
  const baselineRawB64Len = toBase64Url(new TextEncoder().encode(baselineJson)).length;
  const baselineBrotliBase66Len = brotliBase66LinkLen(baselineJson, linkPrefix);
  const baselineGzipBase64Len = bestGzipBase64LinkLen(baselineJson, linkPrefix);
  const baselineBestLen = Math.min(baselineBrotliBase66Len, baselineGzipBase64Len);

  const variants: BenchmarkVariant[] = [
    { name: "baseline.current-shape", payload: state as unknown as JsonValue, decode: (x) => x as BuilderState },
    { name: "short-keys-only", payload: transformShortKeysOnly(state), decode: decodeShortKeysOnly },
    { name: "tuple-rows", payload: transformTupleRows(state), decode: decodeTupleRows },
    {
      name: "indexed-dense",
      payload: transformIndexedDense(state, { removeDefaults: false, enumInts: false }),
      decode: decodeIndexedDense,
    },
    {
      name: "indexed-dense+enum-ints",
      payload: transformIndexedDense(state, { removeDefaults: false, enumInts: true }),
      decode: decodeIndexedDense,
    },
    {
      name: "indexed-dense+enum-ints+omit-defaults",
      payload: transformIndexedDense(state, { removeDefaults: true, enumInts: true }),
      decode: decodeIndexedDense,
    },
  ];

  // Exhaustive compatible crosses for the typed-opcode family.
  const typedOpcodeVariants: BenchmarkVariant[] = [];
  for (const quantized of [false, true]) {
    const sourceState = quantized
      ? decodeTypedSettingsLinkOpcodes(
          transformTypedSettingsLinkOpcodesAggressive(state, {
            quantizeXY: true,
            omitNextId: false,
            elideStaticOuterEndpoints: false,
          }),
        )
      : state;

    for (const templates of [false, true]) {
      const packPortsOptions = templates ? [false, true] : [false];
      for (const packPorts of packPortsOptions) {
        for (const omitNextId of [false, true]) {
          const parts = ["typed", "opcodes"];
          if (quantized) parts.push("quantized-xy");
          if (templates) parts.push("settings-templates");
          if (packPorts) parts.push("port-pack");
          if (omitNextId) parts.push("omit-nextId");
          let payload: JsonValue;
          let decode: BenchmarkVariant["decode"];
          if (templates) {
            payload = transformTypedSettingsLinkOpcodesWithTemplates(sourceState, { packPorts });
            decode = decodeTypedSettingsLinkOpcodesWithTemplates;
          } else {
            payload = transformTypedSettingsLinkOpcodes(sourceState);
            decode = decodeTypedSettingsLinkOpcodes;
          }
          if (omitNextId) payload = omitNextIdFromPayload(payload);
          typedOpcodeVariants.push({
            name: parts.join("+"),
            payload,
            decode,
          });
        }
      }
    }
  }

  // Compatible undirected crosses currently available (omit-nextId only).
  const undirectedPayload = transformTypedSettingsUndirectedWires(state);
  typedOpcodeVariants.push({
    name: "typed+undirected-wires",
    payload: undirectedPayload,
    decode: decodeTypedSettingsUndirectedWires,
  });
  typedOpcodeVariants.push({
    name: "typed+undirected-wires+omit-nextId",
    payload: omitNextIdFromPayload(undirectedPayload),
    decode: decodeTypedSettingsUndirectedWires,
  });

  variants.push(...typedOpcodeVariants);

  // Additional typed+opcodes focused combinations:
  const typedBase = transformTypedSettingsLinkOpcodes(state);
  const typedBaseOmit = omitNextIdFromPayload(typedBase);
  const typedDropDefaults = transformTypedOpcodesDropDefaults(typedBase);
  const typedDropDefaultsOmit = omitNextIdFromPayload(typedDropDefaults);

  variants.push(
    {
      name: "typed+opcodes+drop-default-settings",
      payload: typedDropDefaults,
      decode: decodeTypedSettingsLinkOpcodesImplicitDefaults,
    },
    {
      name: "typed+opcodes+drop-default-settings+omit-nextId",
      payload: typedDropDefaultsOmit,
      decode: decodeTypedSettingsLinkOpcodesImplicitDefaults,
    },
    {
      name: "typed+opcodes+omit-nextId+baseline-repeat",
      payload: typedBaseOmit,
      decode: decodeTypedSettingsLinkOpcodes,
    },
    {
      name: "typed+opcodes+drop-default-settings+omit-nextId+freq-string-table",
      payload: reorderTypedStringTableByFrequency(typedDropDefaultsOmit),
      decode: decodeTypedSettingsLinkOpcodesImplicitDefaults,
    },
    {
      name: "typed+opcodes+drop-default-settings+omit-nextId+stable-keys",
      payload: canonicalizeJsonObjectKeys(typedDropDefaultsOmit),
      decode: decodeTypedSettingsLinkOpcodesImplicitDefaults,
    },
    {
      name: "typed+opcodes+drop-default-settings+omit-nextId+freq-string-table+stable-keys",
      payload: canonicalizeJsonObjectKeys(reorderTypedStringTableByFrequency(typedDropDefaultsOmit)),
      decode: decodeTypedSettingsLinkOpcodesImplicitDefaults,
    },
  );

  // More complex typed crosses: endpoint-id table on top of best typed stacks.
  variants.push(
    {
      name: "typed+opcodes+settings-templates+port-pack+endpoint-id-table",
      payload: transformTypedWithEndpointIdTable(state, {
        useTemplates: true,
        packPorts: true,
        omitNextId: false,
      }),
      decode: decodeTypedWithEndpointIdTable,
    },
    {
      name: "typed+opcodes+settings-templates+port-pack+endpoint-id-table+omit-nextId",
      payload: transformTypedWithEndpointIdTable(state, {
        useTemplates: true,
        packPorts: true,
        omitNextId: true,
      }),
      decode: decodeTypedWithEndpointIdTable,
    },
  );

  const baselineSignature = semanticSignature(state);
  const dumpDir = join("temp", "layout-bench-dumps", "latest");
  rmSync(dumpDir, { recursive: true, force: true });
  mkdirSync(dumpDir, { recursive: true });

  const scored = variants.map((v, idx) => {
    const json = JSON.stringify(v.payload);
    const rawB64Len = toBase64Url(new TextEncoder().encode(json)).length;
    const brotli66Len = brotliBase66LinkLen(json, linkPrefix);
    const gzip64Len = bestGzipBase64LinkLen(json, linkPrefix);
    const bestComboLen = Math.min(brotli66Len, gzip64Len);
    let roundtrip = "N/A";
    let firstDiff: string | null = null;
    if (v.decode) {
      try {
        const restored = v.decode(v.payload);
        if (semanticSignature(restored) === baselineSignature) {
          roundtrip = "PASS";
        } else {
          roundtrip = "FAIL";
          firstDiff = firstStateDifference(state, restored) ?? "unknown semantic mismatch";
        }
      } catch {
        roundtrip = "FAIL";
        firstDiff = "decoder threw";
      }
    }
    const safeName = v.name.replace(/[^a-z0-9\-_]+/gi, "_");
    const dumpId = String(idx + 1).padStart(2, "0");
    const filename = `${dumpId}-${safeName}.json`;
    writeFileSync(join(dumpDir, filename), `${JSON.stringify(v.payload, null, 2)}\n`, "utf8");

    return {
      name: v.name,
      namePretty: v.name.replace(/\+/g, " "),
      rawJsonBytes: compactJsonLength(v.payload),
      tokenLen: bestComboLen,
      deltaVsCurrentToken: bestComboLen - baselineBestLen,
      percentVsCurrent: ((bestComboLen / baselineBestLen) * 100).toFixed(2),
      rawB64Len,
      rawB64Pct: ((rawB64Len / baselineRawB64Len) * 100).toFixed(2),
      rawPercentVsBaseline: ((compactJsonLength(v.payload) / Buffer.byteLength(baselineJson, "utf8")) * 100).toFixed(2),
      roundtrip,
      firstDiff,
      dumpId,
      dumpFile: filename,
      brotli66Len,
      gzip64Len,
      brotli66Pct: ((brotli66Len / baselineBrotliBase66Len) * 100).toFixed(2),
      gzip64Pct: ((gzip64Len / baselineGzipBase64Len) * 100).toFixed(2),
      bestCombo: brotli66Len <= gzip64Len ? "br11+b66" : "gz+b64",
    };
  });

  scored.sort((a, b) => a.tokenLen - b.tokenLen);

  console.log(`\nLayout token benchmark (${sourceLabel})`);
  console.log(`Current link length: ${linkPrefix.length + token.length}`);
  console.log(`Baseline br11+b66 link length: ${baselineBrotliBase66Len}`);
  console.log(`Baseline best-gzip+b64 link length: ${baselineGzipBase64Len}`);
  console.log(`Baseline raw JSON bytes: ${Buffer.byteLength(baselineJson, "utf8")}`);
  console.log("\nSorted by shortest final token:\n");

  const table = new Table({
    head: [
      "variant",
      "link",
      "tok%",
      "b64 raw",
      "b64%",
      "raw",
      "raw%",
      "vs",
      "rt",
      "br11+b66",
      "br11%",
      "best-gzip+b64",
      "gz%",
      "best",
      "dump",
      "first error",
    ],
    style: {
      head: [],
      compact: true,
    },
    wordWrap: true,
  });

  for (const row of scored) {
    const sign = row.deltaVsCurrentToken <= 0 ? "" : "+";
    const deltaText = `${sign}${row.deltaVsCurrentToken} (${row.percentVsCurrent}%)`;
    table.push([
      row.namePretty,
      row.tokenLen,
      row.percentVsCurrent,
      row.rawB64Len,
      row.rawB64Pct,
      row.rawJsonBytes,
      row.rawPercentVsBaseline,
      deltaText,
      row.roundtrip,
      row.brotli66Len,
      row.brotli66Pct,
      row.gzip64Len,
      row.gzip64Pct,
      row.bestCombo,
      row.dumpId,
      row.roundtrip === "FAIL" && row.firstDiff ? row.firstDiff : "",
    ]);
  }
  console.log(table.toString());

  const best = scored[0];
  console.log(`\nBest variant: ${best.name} (${best.tokenLen} chars link)`);
  console.log(`Dump directory: ${dumpDir}`);
}

function main(): void {
  const inputPath = process.argv[2] ?? DEFAULT_TEMP_PATH;
  const raw = readFileSync(inputPath, "utf8");
  const token = extractLayoutToken(raw);
  const linkPrefix = detectLayoutLinkPrefix(raw);
  runBenchmark(token, inputPath, linkPrefix);
}

main();
