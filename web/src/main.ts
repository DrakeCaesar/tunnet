import "./style.css";
import { mountBuilderView } from "./builder/canvas";
import { panelSectionTitle, uiPanel } from "./ui/panels";

function mountLayout(): HTMLDivElement {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root");
  }
  app.innerHTML = `
    <div class="app-root">
      <div id="builder-view" class="builder-view"></div>
    </div>
  `;
  return app.querySelector<HTMLDivElement>("#builder-view")!;
}

async function main(): Promise<void> {
  try {
    const builderRoot = mountLayout();
    mountBuilderView({ root: builderRoot });
  } catch (err) {
    const builderRoot = mountLayout();
    builderRoot.replaceChildren();
    const wrap = uiPanel();
    wrap.append(panelSectionTitle("Builder startup error"));
    const pre = document.createElement("pre");
    pre.className = "details";
    pre.textContent = String(err);
    wrap.append(pre);
    builderRoot.append(wrap);
  }
}

void main();
