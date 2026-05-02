import { isOuterLeafVoidSegment, OUTER_CANVAS_VOID_MERGE_KEY } from "./state";
import type { BuilderEntityInstance, ExpandedBuilderState } from "./clone-engine";
import {
  HUB_LAYOUT,
  HUB_VIEW,
  HUB_REVERSE_BUTTON_SIZE,
  HUB_REVERSE_ICON_SIZE,
  hubPortPinUprightStyle,
  hubTriangleSvg,
} from "../ui/canvas-entities";
import { textTileSizeFromSettings } from "./template-sidebar";

export interface BuilderEntityHtmlContext {
  gridTileXPx: number;
  gridTileYPx: number;
  staticRootIds: ReadonlySet<string>;
  selectedEntityRootId: string | null;
  simTickCollisionDropEntityInstanceIds: ReadonlySet<string>;
  simTickCollisionDropEntityRootIds: ReadonlySet<string>;
  simTickDeliveredEntityRootIds: ReadonlySet<string>;
}

export function buildSortedEntitiesByCanvasBucket(
  expanded: ExpandedBuilderState,
  staticRootIds: ReadonlySet<string>,
): Map<string, BuilderEntityInstance[]> {
  const entitiesByLayerSegment = new Map<string, BuilderEntityInstance[]>();
  for (const entity of expanded.entities) {
    const key =
      entity.layer === "outer64" && isOuterLeafVoidSegment(entity.segmentIndex)
        ? OUTER_CANVAS_VOID_MERGE_KEY
        : `${entity.layer}:${entity.segmentIndex}`;
    if (!entitiesByLayerSegment.has(key)) entitiesByLayerSegment.set(key, []);
    entitiesByLayerSegment.get(key)!.push(entity);
  }
  for (const list of Array.from(entitiesByLayerSegment.values())) {
    list.sort((a, b) => {
      const aS = a.templateType === "endpoint" && a.layer === "outer64" && staticRootIds.has(a.rootId) ? 1 : 0;
      const bS = b.templateType === "endpoint" && b.layer === "outer64" && staticRootIds.has(b.rootId) ? 1 : 0;
      return aS - bS;
    });
  }
  return entitiesByLayerSegment;
}

/** Same markup as `renderCanvas` entity `.map` body — keep in sync when editing builder entity DOM. */
export function buildBuilderEntityInstanceHtml(
  entity: BuilderEntityInstance,
  ctx: BuilderEntityHtmlContext,
): string {
  const selected =
    ctx.selectedEntityRootId !== null && ctx.selectedEntityRootId === entity.rootId ? "selected" : "";
  const settingsText = Object.entries(entity.settings)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join("<br/>");
  const maskParts = (entity.settings.mask ?? "*.*.*.*").split(".");
  while (maskParts.length < 4) maskParts.push("*");
  const displayAddressField =
    (entity.settings.addressField ?? "destination") === "source" ? "Source" : "Destination";
  const displayOperation = (entity.settings.operation ?? "differ") === "match" ? "Match" : "Differ";
  const displayAction = (entity.settings.action ?? "send_back") === "drop" ? "Drop" : "Send back";
  const displayCollision = (() => {
    const value = entity.settings.collisionHandling ?? "drop_inbound";
    if (value === "drop_inbound") return "Drop<br/>Inbound";
    if (value === "drop_outbound") return "Drop<br/>Outbound";
    return "Send back<br/>Outbound";
  })();
  const isOuterStatic =
    entity.templateType === "endpoint" && entity.layer === "outer64" && ctx.staticRootIds.has(entity.rootId);
  const textTiles = textTileSizeFromSettings(entity.settings);
  const addrParts = (entity.settings.address ?? "0.0.0.0").split(".");
  const endpointAddressBlock = isOuterStatic
    ? `
                                  <div class="builder-filter-ui" data-root-id="${entity.rootId}">
                                    <div class="builder-filter-left">
                                      <div class="builder-row builder-row-endpoint-addr">
                                        <span class="builder-row-label">Address:</span>
                                        <div class="builder-mask-row builder-mask-row--readonly">
                                          ${[0, 1, 2, 3]
                                            .map(
                                              (idx) => `
                                                <div class="builder-mask-cell builder-mask-cell--readonly">
                                                  <span class="builder-endpoint-addr-nib">${addrParts[idx] ?? "0"}</span>
                                                </div>
                                              `,
                                            )
                                            .join(`<span class="builder-mask-dot" aria-hidden="true">.</span>`)}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                `
    : "";
  const filterControls =
    entity.templateType === "filter"
      ? `
                                  <div class="builder-filter-ui" data-root-id="${entity.rootId}">
                                    <div class="builder-filter-left">
                                      <div class="builder-row">
                                        <span class="builder-row-label">Port:</span>
                                        <div class="builder-cycle">
                                          <button class="builder-cycle-btn" data-setting-cycle="operatingPort" data-dir="prev" data-root-id="${entity.rootId}" type="button">&lt;</button>
                                          <span class="builder-cycle-value" data-setting-value="operatingPort">${entity.settings.operatingPort ?? "0"}</span>
                                          <button class="builder-cycle-btn" data-setting-cycle="operatingPort" data-dir="next" data-root-id="${entity.rootId}" type="button">&gt;</button>
                                        </div>
                                      </div>
                                      <div class="builder-row">
                                        <span class="builder-row-label">Address:</span>
                                        <div class="builder-cycle">
                                          <button class="builder-cycle-btn" data-setting-cycle="addressField" data-dir="prev" data-root-id="${entity.rootId}" type="button">&lt;</button>
                                          <span class="builder-cycle-value" data-setting-value="addressField">${displayAddressField}</span>
                                          <button class="builder-cycle-btn" data-setting-cycle="addressField" data-dir="next" data-root-id="${entity.rootId}" type="button">&gt;</button>
                                        </div>
                                      </div>
                                      <div class="builder-row">
                                        <span class="builder-row-label">Operation:</span>
                                        <div class="builder-cycle">
                                          <button class="builder-cycle-btn" data-setting-cycle="operation" data-dir="prev" data-root-id="${entity.rootId}" type="button">&lt;</button>
                                          <span class="builder-cycle-value" data-setting-value="operation">${displayOperation}</span>
                                          <button class="builder-cycle-btn" data-setting-cycle="operation" data-dir="next" data-root-id="${entity.rootId}" type="button">&gt;</button>
                                        </div>
                                      </div>
                                      <div class="builder-row builder-row-mask">
                                        <span class="builder-row-label">Mask:</span>
                                        <div class="builder-mask-row">
                                          ${[0, 1, 2, 3]
                                            .map(
                                              (idx) => `
                                                <div class="builder-mask-cell">
                                                  <button class="builder-mask-arrow" data-mask-dir="up" data-mask-idx="${idx}" data-root-id="${entity.rootId}" type="button">+</button>
                                                  <span data-mask-value-idx="${idx}" class="${(maskParts[idx] ?? "*") === "*" ? "builder-mask-value-wildcard" : ""}">${maskParts[idx] ?? "*"}</span>
                                                  <button class="builder-mask-arrow" data-mask-dir="down" data-mask-idx="${idx}" data-root-id="${entity.rootId}" type="button">-</button>
                                                </div>
                                              `,
                                            )
                                            .join(`<span class="builder-mask-dot" aria-hidden="true">.</span>`)}
                                        </div>
                                      </div>
                                      <div class="builder-row">
                                        <span class="builder-row-label">Action:</span>
                                        <div class="builder-cycle">
                                          <button class="builder-cycle-btn" data-setting-cycle="action" data-dir="prev" data-root-id="${entity.rootId}" type="button">&lt;</button>
                                          <span class="builder-cycle-value" data-setting-value="action">${displayAction}</span>
                                          <button class="builder-cycle-btn" data-setting-cycle="action" data-dir="next" data-root-id="${entity.rootId}" type="button">&gt;</button>
                                        </div>
                                      </div>
                                      ${`
                                        <div class="builder-row builder-row-collision ${((entity.settings.action ?? "send_back") === "send_back" ? "" : "builder-row-collision--hidden")}" data-filter-collision-row>
                                          <span class="builder-row-label">Collision<br/>handling:</span>
                                          <div class="builder-cycle builder-cycle--tall">
                                            <button class="builder-cycle-btn" data-setting-cycle="collisionHandling" data-dir="prev" data-root-id="${entity.rootId}" type="button">&lt;</button>
                                            <span class="builder-cycle-value" data-setting-value="collisionHandling">${displayCollision}</span>
                                            <button class="builder-cycle-btn" data-setting-cycle="collisionHandling" data-dir="next" data-root-id="${entity.rootId}" type="button">&gt;</button>
                                          </div>
                                        </div>
                                      `}
                                    </div>
                                  </div>
                                `
      : "";
  const hubCw = (entity.settings.rotation ?? "clockwise") !== "counterclockwise";
  const hubFaceDeg = ((Number.parseFloat(entity.settings.faceAngle ?? "0") % 360) + 360) % 360;
  const relayAngleDeg = ((Number.parseFloat(entity.settings.angle ?? "0") % 360) + 360) % 360;
  const hubOriginX = (HUB_LAYOUT.G.x / HUB_VIEW.w) * 100;
  const hubOriginY = (HUB_LAYOUT.G.y / HUB_VIEW.h) * 100;
  const hubBlock =
    entity.templateType === "hub"
      ? `<div class="builder-hub" data-face-angle="${hubFaceDeg}" style="--hub-w:${HUB_VIEW.w}px;--hub-h:${HUB_VIEW.h}px;--hub-reverse-size:${HUB_REVERSE_BUTTON_SIZE}px;--hub-reverse-icon-size:${HUB_REVERSE_ICON_SIZE}px;">
        <div class="builder-hub-rot" style="transform:rotate(${hubFaceDeg}deg);transform-origin:${hubOriginX}% ${hubOriginY}%;">
          ${hubTriangleSvg(entity.instanceId, entity.settings.rotation)}
          <button type="button" class="builder-port builder-hub-port" style="${hubPortPinUprightStyle(HUB_LAYOUT.T, hubFaceDeg)}" data-instance-id="${entity.instanceId}" data-root-id="${entity.rootId}" data-port="0">0</button>
          <button type="button" class="builder-port builder-hub-port" style="${hubPortPinUprightStyle(HUB_LAYOUT.R, hubFaceDeg)}" data-instance-id="${entity.instanceId}" data-root-id="${entity.rootId}" data-port="1">1</button>
          <button type="button" class="builder-port builder-hub-port" style="${hubPortPinUprightStyle(HUB_LAYOUT.L, hubFaceDeg)}" data-instance-id="${entity.instanceId}" data-root-id="${entity.rootId}" data-port="2">2</button>
        </div>
        <button type="button" class="builder-hub-reverse" style="left:${hubOriginX}%;top:${hubOriginY}%;transform:translate(-50%,-50%)" data-hub-toggle-rotation data-root-id="${entity.rootId}" title="Reverse forwarding direction"><span class="builder-hub-reverse-icon" aria-hidden="true">${hubCw ? "↻" : "↺"}</span></button>
      </div>`
      : "";
  const textBlock =
    entity.templateType === "text"
      ? `<div class="builder-text-box"><textarea class="builder-note-editor" data-note-root-id="${entity.rootId}" spellcheck="false">${entity.settings.label ?? ""}</textarea></div>`
      : "";
  const entityShapeClass = isOuterStatic
    ? " builder-entity--filter builder-entity--outer-endpoint"
    : entity.templateType === "filter"
      ? " builder-entity--filter"
      : entity.templateType === "text"
        ? " builder-entity--text"
        : entity.templateType === "relay"
          ? " builder-entity--relay"
          : entity.templateType === "hub"
            ? " builder-entity--hub"
            : "";
  const simTickFlashClass = ctx.simTickCollisionDropEntityInstanceIds.has(entity.instanceId)
    ? " builder-entity--tick-collision-drop"
    : ctx.simTickCollisionDropEntityRootIds.has(entity.rootId)
      ? " builder-entity--tick-collision-drop"
      : ctx.simTickDeliveredEntityRootIds.has(entity.rootId)
        ? " builder-entity--tick-delivered"
        : "";
  const settingsBlock =
    entity.templateType === "relay" ||
    entity.templateType === "filter" ||
    entity.templateType === "text" ||
    entity.templateType === "hub" ||
    isOuterStatic ||
    settingsText.length === 0
      ? ""
      : `<div class="builder-entity-settings">${settingsText}</div>`;
  const portBtn = (port: number): string =>
    `<button class="builder-port" data-instance-id="${entity.instanceId}" data-root-id="${entity.rootId}" data-port="${port}" type="button">${port}</button>`;
  const portsRow = isOuterStatic
    ? `<div class="builder-ports builder-ports--filter-bottom builder-ports--endpoint-bottom">${portBtn(0)}</div>`
    : entity.templateType === "filter"
      ? `<div class="builder-ports builder-ports--filter-bottom">${portBtn(1)}</div>`
      : entity.templateType === "text"
        ? ""
        : entity.templateType === "relay"
          ? ""
          : entity.templateType === "hub"
            ? ""
            : `<div class="builder-ports">${entity.ports.map((p) => portBtn(p)).join("")}</div>`;
  return `
                              <div
                                class="builder-entity ${selected}${entityShapeClass}${simTickFlashClass}"
                                data-instance-id="${entity.instanceId}"
                                data-root-id="${entity.rootId}"
                                data-static-endpoint="${isOuterStatic ? "1" : "0"}"
                                data-relay-angle="${entity.templateType === "relay" ? String(relayAngleDeg) : ""}"
                                data-template-type="${entity.templateType}"
                                style="left:${
                                  entity.templateType === "hub"
                                    ? `calc(${entity.x} * var(--builder-grid-step-x) - ${HUB_LAYOUT.G.x.toFixed(3)}px)`
                                    : `calc(${entity.x} * var(--builder-grid-step-x))`
                                };top:${
                                  entity.templateType === "hub"
                                    ? `calc(${entity.y} * var(--builder-grid-step-y) - ${HUB_LAYOUT.G.y.toFixed(3)}px)`
                                    : `calc(${entity.y} * var(--builder-grid-step-y))`
                                };--builder-text-w:${textTiles.wTiles * ctx.gridTileXPx + 1}px;--builder-text-h:${textTiles.hTiles * ctx.gridTileYPx + 1}px"
                              >
                                ${
                                  entity.templateType === "filter"
                                    ? `<div class="builder-ports builder-ports--filter-top">${portBtn(0)}</div>`
                                    : ""
                                }
                                ${
                                  entity.templateType === "hub"
                                    ? ""
                                    : isOuterStatic
                                      ? `<div class="builder-entity-title builder-endpoint-title">endpoint</div>`
                                      : entity.templateType === "text"
                                        ? `<div class="builder-entity-title">Note</div>`
                                        : entity.templateType === "relay"
                                          ? ""
                                          : `<div class="builder-entity-title">${entity.templateType}</div>`
                                }
                                ${settingsBlock}
                                ${filterControls}
                                ${endpointAddressBlock}
                                ${hubBlock}
                                ${textBlock}
                                ${
                                  entity.templateType === "relay"
                                    ? `<div class="builder-relay-core">
                                        <div class="builder-relay-port-dock builder-relay-port-a">${portBtn(0)}</div>
                                        <div class="builder-relay-port-dock builder-relay-port-b">${portBtn(1)}</div>
                                      </div>`
                                    : ""
                                }
                                ${portsRow}
                              </div>
                            `;
}
