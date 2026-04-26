import type { BuilderEntityRoot, BuilderLayer, BuilderLinkRoot, BuilderState, BuilderTemplateType } from "./state";

const SHARE_STATE_VERSION = 3;
const TEMPLATE_TYPES: BuilderTemplateType[] = ["endpoint", "relay", "hub", "filter", "text"];
const LAYERS: BuilderLayer[] = ["outer64", "middle16", "inner4", "core1"];
const ROTATIONS = ["clockwise", "counterclockwise"] as const;

type EncodedEntity = [number, number, number, number, number, unknown?, 1?];
type EncodedLink = [number | string, number, number | string, number, 0 | 1 | 2 | 3, number?, number?];
type EncodedShareStateV3 = {
  v: 3;
  s: string[];
  e: EncodedEntity[];
  l: EncodedLink[];
};

function numOr(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
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

function applyImplicitDefaults(out: BuilderState): BuilderState {
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
          collisionHandling: "send_back_outbound",
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

export function encodeBuilderShareState(state: BuilderState): unknown {
  const idToIndex = new Map<string, number>();
  state.entities.forEach((e, i) => idToIndex.set(e.id, i));

  const strDict = new Map<string, number>();
  const strings: string[] = [];

  const entities: EncodedEntity[] = state.entities.map((e) => {
    const t = TEMPLATE_TYPES.indexOf(e.templateType);
    const l = LAYERS.indexOf(e.layer);
    const row: EncodedEntity = [Math.max(0, t), Math.max(0, l), e.segmentIndex, e.x, e.y];

    if (e.templateType === "endpoint") {
      const address = e.settings.address ?? "0.0.0.0";
      if (address !== "0.0.0.0") row.push([pushDict(strDict, strings, address)]);
    } else if (e.templateType === "relay") {
      const angle = ((numOr(e.settings.angle, 0) % 360) + 360) % 360;
      const payload = [Math.floor(angle / 90) % 4];
      if (payload[0] !== 0) row.push(payload);
    } else if (e.templateType === "hub") {
      const rot = Math.max(0, ROTATIONS.indexOf((e.settings.rotation as (typeof ROTATIONS)[number]) ?? "clockwise"));
      const face = (((numOr(e.settings.faceAngle, 0) % 360) + 360) % 360) / 30;
      const payload = [rot, Math.floor(face) % 12];
      if (!(payload[0] === 0 && payload[1] === 0)) row.push(payload);
    } else if (e.templateType === "text") {
      const label = e.settings.label ?? "";
      const w = numOr(e.settings.widthTiles, 2);
      const h = numOr(e.settings.heightTiles, 2);
      const payload = [pushDict(strDict, strings, label), w, h];
      if (!(label === "" && w === 2 && h === 2)) row.push(payload);
    } else if (e.templateType === "filter") {
      const opPort = numOr(e.settings.operatingPort, 0);
      const af = pushDict(strDict, strings, e.settings.addressField ?? "destination");
      const op = pushDict(strDict, strings, e.settings.operation ?? "differ");
      const mask = pushDict(strDict, strings, e.settings.mask ?? "*.*.*.*");
      const action = pushDict(strDict, strings, e.settings.action ?? "send_back");
      const coll = pushDict(strDict, strings, e.settings.collisionHandling ?? "send_back_outbound");
      const payload = [opPort, af, op, mask, action, coll];
      const afText = strings[af] ?? "destination";
      const opText = strings[op] ?? "differ";
      const maskText = strings[mask] ?? "*.*.*.*";
      const actionText = strings[action] ?? "send_back";
      const collText = strings[coll] ?? "send_back_outbound";
      if (!(opPort === 0 && afText === "destination" && opText === "differ" && maskText === "*.*.*.*" && actionText === "send_back" && collText === "send_back_outbound")) {
        row.push(payload);
      }
    }

    if (e.isStatic === true) row.push(1);
    return row;
  });

  const links: EncodedLink[] = state.links.map((l) => {
    const from = idToIndex.get(l.fromEntityId);
    const to = idToIndex.get(l.toEntityId);
    const fromRef: number | string = from === undefined ? l.fromEntityId : from;
    const toRef: number | string = to === undefined ? l.toEntityId : to;

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

  return { v: SHARE_STATE_VERSION, s: strings, e: entities, l: links } satisfies EncodedShareStateV3;
}

export function decodeBuilderShareState(payload: unknown): BuilderState | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<EncodedShareStateV3>;
  if (p.v !== SHARE_STATE_VERSION || !Array.isArray(p.s) || !Array.isArray(p.e) || !Array.isArray(p.l)) return null;
  if (!p.s.every((x) => typeof x === "string")) return null;
  const strings = p.s;

  const entities: BuilderEntityRoot[] = p.e.map((row, i) => {
    if (!Array.isArray(row) || row.length < 5) return null;
    const t = TEMPLATE_TYPES[row[0] ?? -1];
    const layer = LAYERS[row[1] ?? -1];
    if (!t || !layer) return null;
    const settingsPayload = row[5];
    const settings: Record<string, string> = {};
    if (Array.isArray(settingsPayload)) {
      if (t === "endpoint") {
        const idx = settingsPayload[0];
        if (typeof idx === "number") settings.address = strings[idx] ?? "0.0.0.0";
      } else if (t === "relay") {
        settings.angle = String(((settingsPayload[0] ?? 0) % 4) * 90);
      } else if (t === "hub") {
        settings.rotation = ROTATIONS[(settingsPayload[0] ?? 0) % 2] ?? "clockwise";
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
        settings.collisionHandling = typeof collIdx === "number" ? (strings[collIdx] ?? "send_back_outbound") : "send_back_outbound";
      }
    }
    return {
      id: `e${i + 1}`,
      groupId: `e${i + 1}`,
      templateType: t,
      layer,
      segmentIndex: Number(row[2] ?? 0),
      x: Number(row[3] ?? 0),
      y: Number(row[4] ?? 0),
      settings,
      ...(row[6] === 1 ? { isStatic: true } : {}),
    };
  });
  if (entities.some((e) => !e)) return null;
  const entityList = entities as BuilderEntityRoot[];

  const links: BuilderLinkRoot[] = p.l.map((row, i) => {
    if (!Array.isArray(row) || row.length < 5) return null;
    const fromRef = row[0];
    const toRef = row[2];
    const fromEntityId = typeof fromRef === "number" ? (entityList[fromRef]?.id ?? "") : String(fromRef);
    const toEntityId = typeof toRef === "number" ? (entityList[toRef]?.id ?? "") : String(toRef);
    if (!fromEntityId || !toEntityId) return null;
    const opcode = row[4] ?? 0;
    return {
      id: `l${i + 1}`,
      groupId: `l${i + 1}`,
      fromEntityId,
      fromPort: Number(row[1] ?? 0),
      toEntityId,
      toPort: Number(row[3] ?? 0),
      ...(opcode === 1 ? { fromSegmentIndex: Number(row[5]), toSegmentIndex: Number(row[6]) } : {}),
      ...(opcode === 2 ? { sameLayerSegmentDelta: Number(row[5]) } : {}),
      ...(opcode === 3 ? { crossLayerBlockSlot: Number(row[5] ?? 0), ...(row[6] === 1 ? { voidBandInnerOuterCrossLayer: true } : {}) } : {}),
    };
  });
  if (links.some((l) => !l)) return null;
  const out: BuilderState = {
    version: 1,
    entities: entityList,
    links: links as BuilderLinkRoot[],
    nextId: entityList.length + links.length + 1,
  };
  return applyImplicitDefaults(out);
}

