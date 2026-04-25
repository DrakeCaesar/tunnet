import "./style.css";
import { mountBuilderView } from "./builder/canvas";

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
    builderRoot.innerHTML = `
      <div class="card">
        <div class="section-title">Builder startup error</div>
        <pre class="details">${String(err)}</pre>
      </div>
    `;
  }
}

void main();
