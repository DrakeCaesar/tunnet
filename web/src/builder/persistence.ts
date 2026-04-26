import { BuilderState, createEmptyBuilderState, isStaticOuterLeafEndpoint } from "./state";
import { decodeBuilderShareState, encodeBuilderShareState } from "./share-codec";
import { ensureLoadedAsync as ensureBrotliEncoderLoaded, type BrotliEncoder } from "brotli-ts/encoder";
import { ensureLoadedAsync as ensureBrotliDecoderLoaded, type BrotliDecoder } from "brotli-ts/decoder";
import brotliEncoderWasmUrl from "brotli-ts/wasm/encoder?url";
import brotliDecoderWasmUrl from "brotli-ts/wasm/decoder?url";

const STORAGE_KEY = "tunnet.builder.v1";
const EXPORT_GZIP_BASE64_PREFIX = "tunnet-simulator-gz64:";
const LAYOUT_SLOT_COUNT = 4;
const LAYOUT_SLOT_KEY_PREFIX = "tunnet.builder.layoutSlot.";

function isBuilderStateLike(value: unknown): value is BuilderState {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<BuilderState>;
  return v.version === 1 && Array.isArray(v.entities) && Array.isArray(v.links) && typeof v.nextId === "number";
}

export function loadBuilderState(): BuilderState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyBuilderState();
    const parsed = JSON.parse(raw) as unknown;
    return isBuilderStateLike(parsed) ? parsed : createEmptyBuilderState();
  } catch {
    return createEmptyBuilderState();
  }
}

export function saveBuilderState(state: BuilderState): void {
  const persisted: BuilderState = {
    ...state,
    entities: state.entities.filter((entity) => !isStaticOuterLeafEndpoint(entity)),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function stateForPersistence(state: BuilderState): BuilderState {
  return {
    ...state,
    entities: state.entities.filter((entity) => !isStaticOuterLeafEndpoint(entity)),
  };
}

export interface BuilderLayoutSlotRecord {
  index: number;
  updatedAtMs: number;
  state: BuilderState;
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let bin = "";
    for (let j = 0; j < chunk.length; j += 1) {
      bin += String.fromCharCode(chunk[j]!);
    }
    out += bin;
  }
  return btoa(out);
}

function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const BASE66_UNRESERVED = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._~";
let brotliEncoderPromise: Promise<BrotliEncoder> | null = null;
let brotliDecoderPromise: Promise<BrotliDecoder> | null = null;

function getBrotliEncoder(): Promise<BrotliEncoder> {
  if (!brotliEncoderPromise) {
    brotliEncoderPromise = ensureBrotliEncoderLoaded(() => fetch(brotliEncoderWasmUrl));
  }
  return brotliEncoderPromise;
}

function getBrotliDecoder(): Promise<BrotliDecoder> {
  if (!brotliDecoderPromise) {
    brotliDecoderPromise = ensureBrotliDecoderLoaded(() => fetch(brotliDecoderWasmUrl));
  }
  return brotliDecoderPromise;
}

function bytesToBase66Unreserved(bytes: Uint8Array): string {
  if (bytes.length === 0) return BASE66_UNRESERVED[0]!;
  const base = BASE66_UNRESERVED.length;
  const digits: number[] = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j]! * 256 + carry;
      digits[j] = value % base;
      carry = Math.floor(value / base);
    }
    while (carry > 0) {
      digits.push(carry % base);
      carry = Math.floor(carry / base);
    }
  }
  let out = "";
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += BASE66_UNRESERVED[digits[i]!]!;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  if (leadingZeros > 0) out = BASE66_UNRESERVED[0]!.repeat(leadingZeros) + out;
  return out || BASE66_UNRESERVED[0]!;
}

function base66UnreservedToBytes(input: string): Uint8Array {
  const text = input.trim();
  if (!text) return new Uint8Array(0);
  const base = BASE66_UNRESERVED.length;
  const bytes: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    const idx = BASE66_UNRESERVED.indexOf(text[i]!);
    if (idx < 0) throw new Error("Invalid base66 character");
    let carry = idx;
    for (let j = 0; j < bytes.length; j += 1) {
      const value = bytes[j]! * base + carry;
      bytes[j] = value & 0xff;
      carry = value >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  bytes.reverse();
  let leadingZeros = 0;
  while (leadingZeros < text.length && text[leadingZeros] === BASE66_UNRESERVED[0]) leadingZeros += 1;
  return new Uint8Array([...Array.from({ length: leadingZeros }, () => 0), ...bytes]);
}

async function gzipToBase64(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return bytesToBase64(compressed);
}

async function gunzipBase64(base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const decompressed = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(decompressed);
}

async function brotliToBase66Url(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const encoder = await getBrotliEncoder();
  const compressed = encoder.compressBuffer(input, { quality: 11 });
  return bytesToBase66Unreserved(compressed);
}

async function base66UrlToBrotliText(base66: string): Promise<string> {
  const bytes = base66UnreservedToBytes(base66);
  const decoder = await getBrotliDecoder();
  const decompressed = decoder.decompressBuffer(bytes);
  return new TextDecoder().decode(decompressed.buffer.slice(
    decompressed.byteOffset,
    decompressed.byteOffset + decompressed.byteLength,
  ));
}

function layoutSlotKey(index: number): string {
  return `${LAYOUT_SLOT_KEY_PREFIX}${index}`;
}

export async function exportBuilderStateText(state: BuilderState): Promise<string> {
  const persisted: BuilderState = {
    ...stateForPersistence(state),
  };
  const serialized = JSON.stringify(persisted);
  const gz64 = await gzipToBase64(serialized);
  return `${EXPORT_GZIP_BASE64_PREFIX}${gz64}`;
}

export async function importBuilderStateText(raw: string): Promise<BuilderState | null> {
  try {
    const text = raw.trim();
    let payloadText = text;
    if (text.startsWith(EXPORT_GZIP_BASE64_PREFIX)) {
      const base64 = text.slice(EXPORT_GZIP_BASE64_PREFIX.length);
      payloadText = await gunzipBase64(base64);
    }
    const parsed = JSON.parse(payloadText) as unknown;
    if (!isBuilderStateLike(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function exportBuilderStateUrlToken(state: BuilderState): Promise<string> {
  const compact = encodeBuilderShareState(stateForPersistence(state));
  return brotliToBase66Url(JSON.stringify(compact));
}

export async function importBuilderStateUrlToken(token: string): Promise<BuilderState | null> {
  try {
    const payloadText = await base66UrlToBrotliText(token.trim());
    const parsed = JSON.parse(payloadText) as unknown;
    return decodeBuilderShareState(parsed);
  } catch {
    return null;
  }
}

export function saveBuilderLayoutSlot(index: number, state: BuilderState): boolean {
  if (!Number.isInteger(index) || index < 1 || index > LAYOUT_SLOT_COUNT) return false;
  const record: BuilderLayoutSlotRecord = {
    index,
    updatedAtMs: Date.now(),
    state: stateForPersistence(state),
  };
  window.localStorage.setItem(layoutSlotKey(index), JSON.stringify(record));
  return true;
}

export function clearBuilderLayoutSlot(index: number): boolean {
  if (!Number.isInteger(index) || index < 1 || index > LAYOUT_SLOT_COUNT) return false;
  window.localStorage.removeItem(layoutSlotKey(index));
  return true;
}

export function loadBuilderLayoutSlot(index: number): BuilderLayoutSlotRecord | null {
  if (!Number.isInteger(index) || index < 1 || index > LAYOUT_SLOT_COUNT) return null;
  try {
    const raw = window.localStorage.getItem(layoutSlotKey(index));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuilderLayoutSlotRecord> & { state?: unknown };
    if (!Number.isFinite(parsed.updatedAtMs) || !isBuilderStateLike(parsed.state)) return null;
    return {
      index,
      updatedAtMs: Math.floor(parsed.updatedAtMs),
      state: parsed.state,
    };
  } catch {
    return null;
  }
}

export function listBuilderLayoutSlots(): BuilderLayoutSlotRecord[] {
  const out: BuilderLayoutSlotRecord[] = [];
  for (let i = 1; i <= LAYOUT_SLOT_COUNT; i += 1) {
    const slot = loadBuilderLayoutSlot(i);
    if (slot) out.push(slot);
  }
  return out;
}
