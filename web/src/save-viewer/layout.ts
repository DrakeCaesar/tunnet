import {
  button,
  panelHint,
  panelMeta,
  panelSectionTitle,
  simButtonsWrap,
  simSendRateLabel,
  simSendRateRow,
  svButtonRow,
  uiPanelSidebar,
} from "../ui/panels";

export function mountLayout(): HTMLDivElement {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app root");
  app.replaceChildren();

  const root = document.createElement("div");
  root.className = "sv-root";

  const sidebar = document.createElement("div");
  sidebar.className = "sv-sidebar";

  const loadPanel = uiPanelSidebar();
  const fileInput = document.createElement("input");
  fileInput.id = "sv-file-input";
  fileInput.className = "sv-file-input";
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  const lastSavePathEl = panelMeta("—", "sv-last-save-path");
  lastSavePathEl.id = "sv-last-save-path";
  loadPanel.append(
    panelSectionTitle("Load save file"),
    panelHint(
      "Choose a Tunnet save JSON (nodes + edges + entities). This browser remembers it for the next visit. Full paths appear only when the host exposes them (otherwise just the file name).",
    ),
    fileInput,
    lastSavePathEl,
    svButtonRow(
      button("sv-reload-save", "Reload", {
        disabled: true,
        title: "Reload the last picked save from browser storage",
      }),
    ),
  );

  const simPanelWrap = uiPanelSidebar();
  const simStatusEl = panelMeta();
  simStatusEl.id = "sv-sim-status";
  simStatusEl.classList.add("sv-sim-status");
  const simPanelHost = document.createElement("div");
  simPanelHost.id = "sv-sim-panel-host";
  simPanelWrap.append(panelSectionTitle("Simulation"), simStatusEl, simPanelHost);

  const viewPanel = uiPanelSidebar();
  const teleportInput = document.createElement("input");
  teleportInput.id = "sv-teleport-endpoint";
  teleportInput.type = "text";
  teleportInput.value = "0.3.0.0";
  teleportInput.spellcheck = false;
  const teleportRow = simSendRateRow(teleportInput, button("sv-teleport-button", "Teleport"));
  teleportRow.classList.add("sv-inline-action-row");
  const cullInput = document.createElement("input");
  cullInput.id = "sv-cull-height";
  cullInput.type = "range";
  cullInput.min = "0";
  cullInput.max = "1000";
  cullInput.step = "1";
  cullInput.value = "1000";
  const cullValueSpan = document.createElement("span");
  cullValueSpan.id = "sv-cull-height-value";
  cullValueSpan.className = "meta";
  cullValueSpan.textContent = "max";

  const loadProgressWrap = document.createElement("div");
  loadProgressWrap.id = "sv-load-progress-wrap";
  loadProgressWrap.className = "hidden";
  const loadProgress = document.createElement("progress");
  loadProgress.id = "sv-load-progress";
  loadProgress.max = 1000;
  loadProgress.value = 0;
  const loadProgressValue = document.createElement("span");
  loadProgressValue.id = "sv-load-progress-value";
  loadProgressValue.className = "meta";
  loadProgressValue.textContent = "0%";
  const loadProgressText = document.createElement("div");
  loadProgressText.id = "sv-load-progress-text";
  loadProgressText.className = "hint";
  loadProgressText.textContent = "idle";
  loadProgressWrap.append(
    simSendRateLabel("sv-load-progress", "3D load progress"),
    simSendRateRow(loadProgress, loadProgressValue),
    loadProgressText,
  );

  viewPanel.append(
    panelSectionTitle("View"),
    simButtonsWrap(
      button("sv-zoom-in", "Zoom in"),
      button("sv-zoom-out", "Zoom out"),
      button("sv-zoom-fit", "Fit"),
      button("sv-view-toggle", "Switch to 3D"),
      button("sv-fps-toggle", "Pilot mode: off"),
      button("sv-gravity-toggle", "Gravity: on"),
      button("sv-ssao-toggle", "SSAO: on"),
      button("sv-block-ao-toggle", "Block AO: on"),
      button("sv-hemi-ao-toggle", "Hemi AO: off"),
      button("sv-reset-camera", "Reset camera"),
    ),
    simSendRateLabel("sv-teleport-endpoint", "Teleport to endpoint"),
    teleportRow,
    simSendRateLabel("sv-cull-height", "3D cull plane (top cut)"),
    simSendRateRow(cullInput, cullValueSpan),
    loadProgressWrap,
    panelHint("Mouse wheel to zoom. Drag on graph to pan (hand)."),
  );

  const legendPanel = uiPanelSidebar();
  const legendHost = document.createElement("div");
  legendHost.className = "sv-legend";
  const selectedDeviceEl = panelMeta("Click a device in 2D view to inspect it.", "sv-selected-device");
  selectedDeviceEl.id = "sv-selected-device";
  legendPanel.append(
    panelSectionTitle("Legend"),
    legendHost,
    selectedDeviceEl,
    panelHint("Bridge and antenna are placeholders and currently behave like relay in simulation."),
  );

  const worldPanel = uiPanelSidebar();
  const worldSummaryEl = panelMeta("Load a save file to inspect world sections.");
  worldSummaryEl.id = "sv-world-summary";
  worldPanel.append(panelSectionTitle("World data"), worldSummaryEl);

  sidebar.append(loadPanel, simPanelWrap, viewPanel, legendPanel, worldPanel);

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sv-canvas-wrap";
  const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.id = "sv-wires";
  wires.setAttribute("class", "sv-wires");
  const packetOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  packetOverlay.id = "sv-packet-overlay";
  packetOverlay.setAttribute("class", "builder-packet-overlay");
  packetOverlay.setAttribute("aria-hidden", "true");
  const view3d = document.createElement("div");
  view3d.id = "sv-3d-view";
  view3d.className = "sv-3d-view hidden";
  view3d.setAttribute("aria-hidden", "true");
  canvasWrap.append(wires, packetOverlay, view3d);

  root.append(sidebar, canvasWrap);
  app.appendChild(root);
  return app;
}
