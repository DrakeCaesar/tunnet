import { BuilderState, createEmptyBuilderState, isStaticOuterLeafEndpoint } from "./state";

const STORAGE_KEY = "tunnet.builder.v1";
const EXPORT_GZIP_BASE64_PREFIX = "tunnet-simulator-gz64:";

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
