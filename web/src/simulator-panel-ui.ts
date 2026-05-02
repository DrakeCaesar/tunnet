import type { SimulationStats, Topology } from "./simulation";
import {
  SPEED_EXP_DEFAULT,
  SPEED_EXP_MAX,
  SPEED_EXP_MIN,
  formatSpeedLabel,
} from "./sim-controls";

export interface SimulatorPanelElements {
  root: HTMLElement;
  playPauseBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  stepBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
  togglePacketIpsBtn: HTMLButtonElement;
  speedRange: HTMLInputElement;
  speedValueSpan: HTMLSpanElement;
  metaEl: HTMLDivElement;
  dropListEl: HTMLOListElement;
  dropEmptyEl: HTMLDivElement;
}

export type SimulatorPanelMountOptions = {
  /** When false, step-back control is hidden (no tick history). */
  stepBack?: boolean;
  speedExponent?: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTopologyDropLabel(topology: Topology, deviceId: string): string {
  const d = topology.devices[deviceId];
  if (!d) return deviceId;
  if (d.type === "endpoint") return `${d.address} endpoint`;
  return d.type;
}

export function renderSimulatorMetaGridHtml(params: {
  stats: SimulationStats;
  inFlight: number;
  deliveredPerTickAvg100: number | null;
  dropPctCumulative: number | null;
}): string {
  const formatSimInteger = (value: number): string => {
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(Math.trunc(value));
    const grouped = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${sign}${grouped}`;
  };
  const { stats, inFlight, deliveredPerTickAvg100, dropPctCumulative } = params;
  return `
      <div class="builder-sim-stats-grid">
        <div class="stat-pill"><span>Tick</span><strong>${formatSimInteger(stats.tick)}</strong></div>
        <div class="stat-pill"><span>In-flight</span><strong>${formatSimInteger(inFlight)}</strong></div>
        <div class="stat-pill"><span>Emitted</span><strong>${formatSimInteger(stats.emitted)}</strong></div>
        <div class="stat-pill"><span>Delivered</span><strong>${formatSimInteger(stats.delivered)}</strong></div>
        <div class="stat-pill"><span>Dropped</span><strong>${formatSimInteger(stats.dropped)}</strong></div>
        <div class="stat-pill"><span>TTL expired</span><strong>${formatSimInteger(stats.ttlExpired)}</strong></div>
        <div class="stat-pill"><span>Collisions</span><strong>${formatSimInteger(stats.collisions)}</strong></div>
        <div class="stat-pill"><span>Delivered /100</span><strong>${deliveredPerTickAvg100 === null ? "—" : deliveredPerTickAvg100.toFixed(2)}</strong></div>
        <div class="stat-pill"><span>Drop %</span><strong>${dropPctCumulative === null ? "—" : `${dropPctCumulative.toFixed(1)}%`}</strong></div>
      </div>
    `;
}

export function simulatorPanelMarkup(prefix: string, opts: SimulatorPanelMountOptions = {}): string {
  const exp = Number.isFinite(opts.speedExponent)
    ? Math.max(SPEED_EXP_MIN, Math.min(SPEED_EXP_MAX, Math.round(opts.speedExponent as number)))
    : SPEED_EXP_DEFAULT;
  const backCls = opts.stepBack === false ? ` class="hidden"` : "";
  return `
    <div id="${prefix}-panel-simulation" class="builder-floating-simulation sv-shared-sim-panel" aria-label="Simulation controls">
      <div class="builder-sim-toolbar">
        <button id="${prefix}-sim-play-pause" type="button" aria-label="Play/Pause" title="Play/Pause">▶</button>
        <button id="${prefix}-sim-reset" type="button" aria-label="Stop" title="Stop">⏹</button>
        <button id="${prefix}-sim-step" type="button" aria-label="Step forward" title="Step forward">
          <span class="builder-sim-skip builder-sim-skip--forward" aria-hidden="true">
            <span class="builder-sim-skip-tri">▶</span><span class="builder-sim-skip-bar">⏹</span>
          </span>
        </button>
        <button id="${prefix}-sim-back" type="button" aria-label="Step back" title="Step back" disabled${backCls}>
          <span class="builder-sim-skip builder-sim-skip--back" aria-hidden="true">
            <span class="builder-sim-skip-bar">⏹</span><span class="builder-sim-skip-tri">◀</span>
          </span>
        </button>
        <button id="${prefix}-sim-toggle-packet-ips" type="button">IPs</button>
        <div class="builder-sim-speed-inline" aria-label="Tick speed">
          <div class="builder-sim-speed-inline-top">
            <span class="builder-sim-speed-inline-label">Speed</span>
            <span id="${prefix}-sim-speed-value" class="builder-sim-speed-inline-value">${escapeHtml(formatSpeedLabel(exp))}</span>
          </div>
          <input id="${prefix}-sim-speed" class="builder-sim-speed-inline-range" type="range" min="${SPEED_EXP_MIN}" max="${SPEED_EXP_MAX}" step="1" value="${exp}" />
        </div>
      </div>
      <div id="${prefix}-sim-meta" class="builder-sim-meta"></div>
      <div id="${prefix}-sim-drop-board" class="builder-sim-drop-board" aria-label="Entities that dropped packets">
        <div class="builder-sim-drop-board-title">Drops this run</div>
        <ol id="${prefix}-sim-drop-board-list" class="builder-sim-drop-board-list"></ol>
        <div id="${prefix}-sim-drop-board-empty" class="builder-sim-drop-board-empty">
          Run or step the simulation to accumulate per-device drop counts. Stop clears the list.
        </div>
      </div>
    </div>
  `;
}

export function querySimulatorPanel(host: HTMLElement, prefix: string): SimulatorPanelElements {
  const q = <T extends HTMLElement>(id: string): T => {
    const el = host.querySelector<T>(`#${prefix}-${id}`);
    if (!el) throw new Error(`Missing #${prefix}-${id}`);
    return el;
  };
  return {
    root: q<HTMLElement>("panel-simulation"),
    playPauseBtn: q<HTMLButtonElement>("sim-play-pause"),
    resetBtn: q<HTMLButtonElement>("sim-reset"),
    stepBtn: q<HTMLButtonElement>("sim-step"),
    backBtn: q<HTMLButtonElement>("sim-back"),
    togglePacketIpsBtn: q<HTMLButtonElement>("sim-toggle-packet-ips"),
    speedRange: q<HTMLInputElement>("sim-speed"),
    speedValueSpan: q<HTMLSpanElement>("sim-speed-value"),
    metaEl: q<HTMLDivElement>("sim-meta"),
    dropListEl: q<HTMLOListElement>("sim-drop-board-list"),
    dropEmptyEl: q<HTMLDivElement>("sim-drop-board-empty"),
  };
}

export function mountSimulatorPanel(
  host: HTMLElement,
  prefix: string,
  opts: SimulatorPanelMountOptions = {},
): SimulatorPanelElements {
  host.innerHTML = simulatorPanelMarkup(prefix, opts);
  return querySimulatorPanel(host, prefix);
}

function sameDropBoardRenderOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class SimulatorDropBoardController {
  private readonly listEl: HTMLOListElement;
  private readonly emptyEl: HTMLDivElement;
  private readonly getTopology: () => Topology;
  private readonly countByDeviceId = new Map<string, number>();
  private readonly rowLiByDeviceId = new Map<string, HTMLLIElement>();
  private renderedOrder: string[] = [];
  /** Highlight row picked from the list (device id in topology). */
  traceDeviceId: string | null = null;
  onPick: ((deviceId: string) => void) | null = null;

  constructor(listEl: HTMLOListElement, emptyEl: HTMLDivElement, getTopology: () => Topology) {
    this.listEl = listEl;
    this.emptyEl = emptyEl;
    this.getTopology = getTopology;
    this.wireInput();
  }

  reset(): void {
    this.countByDeviceId.clear();
    for (const li of Array.from(this.rowLiByDeviceId.values())) {
      li.remove();
    }
    this.rowLiByDeviceId.clear();
    this.renderedOrder = [];
    this.traceDeviceId = null;
    this.refresh();
  }

  ingestDropEvents(deviceIds: readonly string[]): void {
    const topo = this.getTopology();
    for (const deviceId of deviceIds) {
      if (topo.devices[deviceId] === undefined) continue;
      this.countByDeviceId.set(deviceId, (this.countByDeviceId.get(deviceId) ?? 0) + 1);
    }
  }

  /** Copy per-device drop counts for simulation history undo. */
  snapshotCounts(): Map<string, number> {
    return new Map(this.countByDeviceId);
  }

  restoreCounts(counts: Map<string, number>): void {
    this.countByDeviceId.clear();
    for (const [id, n] of Array.from(counts.entries())) {
      if (n > 0) this.countByDeviceId.set(id, n);
    }
    this.refresh();
  }

  refresh(): void {
    const topology = this.getTopology();
    const entriesMap = new Map<string, number>();
    for (const [deviceId, n] of Array.from(this.countByDeviceId.entries())) {
      if (n > 0) entriesMap.set(deviceId, n);
    }
    const hasRows = entriesMap.size > 0;
    this.emptyEl.classList.toggle("hidden", hasRows);
    this.listEl.classList.toggle("hidden", !hasRows);

    if (!hasRows) {
      for (const li of Array.from(this.rowLiByDeviceId.values())) {
        li.remove();
      }
      this.rowLiByDeviceId.clear();
      this.renderedOrder = [];
      return;
    }

    const sortedDeviceIds = Array.from(entriesMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id]) => id);

    const seen = new Set<string>();
    const renderedOrder: string[] = [];

    for (const deviceId of sortedDeviceIds) {
      const count = entriesMap.get(deviceId);
      if (count === undefined) continue;
      if (topology.devices[deviceId] === undefined) continue;
      seen.add(deviceId);
      renderedOrder.push(deviceId);

      let li = this.rowLiByDeviceId.get(deviceId);
      if (!li) {
        li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "builder-sim-drop-board-row";
        const countSpan = document.createElement("span");
        countSpan.className = "builder-sim-drop-board-count";
        const labelSpan = document.createElement("span");
        labelSpan.className = "builder-sim-drop-board-label";
        btn.append(countSpan, labelSpan);
        li.appendChild(btn);
        this.rowLiByDeviceId.set(deviceId, li);
      }

      const btn = li.querySelector<HTMLButtonElement>(".builder-sim-drop-board-row")!;
      const countSpan = btn.querySelector<HTMLSpanElement>(".builder-sim-drop-board-count")!;
      const labelSpan = btn.querySelector<HTMLSpanElement>(".builder-sim-drop-board-label")!;
      btn.dataset.dropRootId = deviceId;
      btn.dataset.dropDeviceId = deviceId;
      const countStr = String(count);
      if (countSpan.textContent !== countStr) countSpan.textContent = countStr;
      const labelText = formatTopologyDropLabel(topology, deviceId);
      if (labelSpan.textContent !== labelText) labelSpan.textContent = labelText;
      btn.classList.toggle("is-selected", this.traceDeviceId === deviceId);
    }

    const needsDomReorder =
      !sameDropBoardRenderOrder(renderedOrder, this.renderedOrder) ||
      renderedOrder.some((id) => {
        const li = this.rowLiByDeviceId.get(id);
        return li !== undefined && li.parentNode !== this.listEl;
      });

    if (needsDomReorder) {
      this.renderedOrder = renderedOrder.slice();
      for (const deviceId of renderedOrder) {
        const li = this.rowLiByDeviceId.get(deviceId);
        if (li) this.listEl.appendChild(li);
      }
    }

    for (const deviceId of Array.from(this.rowLiByDeviceId.keys())) {
      if (seen.has(deviceId)) continue;
      this.rowLiByDeviceId.get(deviceId)?.remove();
      this.rowLiByDeviceId.delete(deviceId);
    }
  }

  private wireInput(): void {
    const pick = (btn: HTMLButtonElement): void => {
      const deviceId = btn.dataset.dropDeviceId;
      if (!deviceId) return;
      this.traceDeviceId = deviceId;
      this.onPick?.(deviceId);
      this.refresh();
    };
    this.listEl.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-drop-device-id]");
      if (!btn) return;
      pick(btn);
    });
    this.listEl.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const t = ev.target;
      if (!(t instanceof HTMLButtonElement) || !t.dataset.dropDeviceId) return;
      ev.preventDefault();
      pick(t);
    });
  }
}
