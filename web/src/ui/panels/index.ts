/** Shared DOM factories for sidebar cards (save viewer, future builder chrome). */

export function uiPanel(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "ui-panel";
  return el;
}

export function uiPanelSidebar(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "ui-panel ui-panel--sidebar";
  return el;
}

export function panelSectionTitle(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "section-title";
  el.textContent = text;
  return el;
}

export function panelHint(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "hint";
  el.textContent = text;
  return el;
}

export function panelMeta(initial?: string, ...extraClasses: string[]): HTMLDivElement {
  const el = document.createElement("div");
  el.className = ["meta", ...extraClasses].filter(Boolean).join(" ");
  if (initial !== undefined) el.textContent = initial;
  return el;
}

export function svButtonRow(...children: HTMLElement[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "sv-button-row sim-buttons";
  row.append(...children);
  return row;
}

export function simButtonsWrap(...children: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "sim-buttons";
  wrap.append(...children);
  return wrap;
}

export function simSendRateLabel(forId: string, text: string): HTMLLabelElement {
  const lab = document.createElement("label");
  lab.className = "sim-send-rate-label";
  lab.htmlFor = forId;
  lab.textContent = text;
  return lab;
}

export function simSendRateRow(...children: HTMLElement[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "sim-send-rate-row";
  row.append(...children);
  return row;
}

export function button(id: string, label: string, options?: { disabled?: boolean; title?: string }): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.textContent = label;
  if (options?.disabled) btn.disabled = true;
  if (options?.title) btn.title = options.title;
  return btn;
}
