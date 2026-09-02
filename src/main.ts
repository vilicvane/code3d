import "./style.css";
import { CodeEditor } from "./editor";
import { ModelCompilerClient } from "./model/compiler-client";
import type { ModelModule } from "./model/compiler";
import { sampleSource } from "./model/sample";
import type { ModelSnapshotObject, SourceRef, Vec3 } from "./model/runtime";
import { ModelViewport, type Occurrence } from "./viewport";

const storageKey = "code3d.prototype.source";
const savedSource = localStorage.getItem(storageKey) ?? sampleSource;
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app element.");
}

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>code3d</span>
        <span class="prototype-tag">prototype 01</span>
      </div>
      <div class="run-state" id="run-state" data-state="idle">
        <span class="run-state-dot"></span>
        <span id="run-state-label">等待编译</span>
      </div>
      <div class="topbar-actions">
        <button class="quiet-button" id="reset-button" type="button">重置示例</button>
        <button class="run-button" id="run-button" type="button">
          <span>运行</span>
          <kbd>⌘ ↵</kbd>
        </button>
      </div>
    </header>

    <main class="workspace">
      <section class="pane editor-pane">
        <header class="pane-header">
          <div class="pane-title">
            <span class="language-badge">TS</span>
            <span>model.ts</span>
          </div>
          <span class="pane-meta">入口模组</span>
        </header>
        <div class="editor-host" id="editor-host"></div>
        <div class="error-bar" id="error-bar" hidden></div>
      </section>

      <section class="pane preview-pane">
        <header class="pane-header scope-header">
          <div class="pane-title">
            <span class="preview-icon" aria-hidden="true"></span>
            <span>模型</span>
          </div>
          <nav class="scope-list" id="scope-list" aria-label="模型 scope"></nav>
        </header>
        <div class="viewport-host" id="viewport-host">
          <div class="viewport-hint">拖动旋转 · 滚轮缩放 · 点击对象</div>
          <aside class="inspector" id="inspector"></aside>
        </div>
      </section>
    </main>

    <footer class="footer">
      <span>JS/TS OBJECT MODEL</span>
      <span class="footer-separator"></span>
      <span>MONACO + OPENCASCADE</span>
      <span class="footer-note">B-Rep → Three.js mesh</span>
    </footer>
  </div>
`;

const editorHost = requiredElement("editor-host");
const viewportHost = requiredElement("viewport-host");
const runState = requiredElement("run-state");
const runStateLabel = requiredElement("run-state-label");
const errorBar = requiredElement("error-bar");
const scopeList = requiredElement("scope-list");
const inspector = requiredElement("inspector");
const runButton = requiredElement<HTMLButtonElement>("run-button");
const resetButton = requiredElement<HTMLButtonElement>("reset-button");

const codeEditor = new CodeEditor(editorHost, savedSource);
const compiler = new ModelCompilerClient();
let currentModule: ModelModule | null = null;
let compileTimer: number | undefined;
let explodeValue = 0;
let runRevision = 0;

const viewport = new ModelViewport(viewportHost, (occurrence) => {
  selectOccurrence(occurrence, true);
});

codeEditor.onChange(() => {
  localStorage.setItem(storageKey, codeEditor.getValue());
  setRunState("pending", "等待更新");
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(runModel, 420);
});

codeEditor.onCursorOffset((offset) => {
  viewport.selectBySourceOffset(offset);
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  }
});

runButton.addEventListener("click", runModel);
resetButton.addEventListener("click", () => {
  if (!window.confirm("将编辑器恢复为 prototype 示例？")) {
    return;
  }
  codeEditor.setValue(sampleSource);
  localStorage.removeItem(storageKey);
  runModel();
});

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runModel();
  }
});

runModel();

async function runModel(): Promise<void> {
  window.clearTimeout(compileTimer);
  const revision = ++runRevision;
  setRunState("running", "正在编译");
  errorBar.hidden = true;

  try {
    currentModule = await compiler.compile(codeEditor.getValue());
    if (revision !== runRevision) {
      return;
    }
    viewport.renderModule(currentModule);
    explodeValue = 0;
    renderScopes(currentModule);
    const root = viewport.getSelected();
    if (root) {
      selectOccurrence(root, false);
    }
    const objectCount = countObjects(currentModule.root);
    setRunState("ready", `${objectCount} 个对象`);
  } catch (error) {
    if (revision !== runRevision) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setRunState("error", "运行失败");
    errorBar.textContent = message;
    errorBar.hidden = false;
  }
}

function renderScopes(module: ModelModule): void {
  scopeList.replaceChildren();
  scopeList.append(
    scopeButton("整体", module.root.nodeId, () => viewport.selectRoot()),
  );

  for (const [name, nodeId] of module.exports) {
    if (name === "default" || nodeId === module.root.nodeId) {
      continue;
    }
    scopeList.append(scopeButton(name, nodeId, () => viewport.selectNode(nodeId)));
  }
}

function scopeButton(
  label: string,
  nodeId: string,
  action: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scope-button";
  button.dataset.nodeId = nodeId;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function selectOccurrence(occurrence: Occurrence, revealSource: boolean): void {
  renderInspector(occurrence);
  updateActiveScope(occurrence.node);

  if (revealSource) {
    const sourceRef = primarySource(occurrence.node);
    if (sourceRef) {
      codeEditor.revealSource(sourceRef);
    } else {
      codeEditor.clearSourceHighlight();
    }
  }
}

function renderInspector(occurrence: Occurrence): void {
  inspector.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "inspector-heading";
  const eyebrow = document.createElement("span");
  eyebrow.className = "inspector-eyebrow";
  eyebrow.textContent = occurrence.depth === 0 ? "MODEL SCOPE" : "LOCAL SCOPE";
  const title = document.createElement("strong");
  title.textContent = occurrence.node.name;
  heading.append(eyebrow, title);
  inspector.append(heading);

  if (occurrence.depth === 0) {
    renderModelInspector();
  } else {
    renderLocalInspector(occurrence);
  }
}

function renderModelInspector(): void {
  const copy = document.createElement("p");
  copy.className = "inspector-copy";
  copy.textContent = "整体 scope 只改变当前观察方式，不修改模型代码。";

  const control = rangeControl("分解视图", explodeValue, -0, 32, 1, (value) => {
    explodeValue = value;
    viewport.setExplode(value);
  });

  const fitButton = actionButton("适应模型", () => viewport.fit());
  inspector.append(copy, control, fitButton);
}

function renderLocalInspector(occurrence: Occurrence): void {
  const kind = document.createElement("div");
  kind.className = "object-kind";
  kind.textContent = occurrence.node.kind.toUpperCase();
  inspector.append(kind);

  const current = viewport.getPreviewOffset(occurrence.key);
  const axisLabels = ["X", "Y", "Z"] as const;
  axisLabels.forEach((axis, index) => {
    inspector.append(
      rangeControl(axis, current[index], -30, 30, 1, (value) => {
        const next = [...viewport.getPreviewOffset(occurrence.key)] as [
          number,
          number,
          number,
        ];
        next[index] = value;
        viewport.setPreviewOffset(occurrence.key, next);
      }),
    );
  });

  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  actions.append(
    actionButton("聚焦", () => viewport.focusSelection()),
    actionButton("清除偏移", () => {
      viewport.resetPreviewOffset(occurrence.key);
      renderInspector(occurrence);
    }),
  );
  inspector.append(actions);

  const note = document.createElement("p");
  note.className = "inspector-note";
  note.textContent = "局部调整是临时 preview override；它不会尝试重写任意 TS 表达式。";
  inspector.append(note);
}

function rangeControl(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "range-control";
  const row = document.createElement("span");
  const name = document.createElement("span");
  name.textContent = label;
  const output = document.createElement("output");
  output.textContent = String(value);
  row.append(name, output);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    output.textContent = String(next);
    onInput(next);
  });
  wrapper.append(row, input);
  return wrapper;
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inspector-button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function updateActiveScope(node: ModelSnapshotObject): void {
  const buttons = scopeList.querySelectorAll<HTMLButtonElement>(".scope-button");
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.nodeId === node.nodeId);
  });
}

function setRunState(
  state: "idle" | "pending" | "running" | "ready" | "error",
  label: string,
): void {
  runState.dataset.state = state;
  runStateLabel.textContent = label;
}

function primarySource(node: ModelSnapshotObject): SourceRef | undefined {
  return node.sourceRefs.at(-1);
}

function countObjects(root: ModelSnapshotObject): number {
  return 1 + root.children.reduce((sum, child) => sum + countObjects(child), 0);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }
  return element as T;
}
