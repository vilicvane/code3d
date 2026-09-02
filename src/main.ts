import "./style.css";
import { CodeEditor } from "./editor";
import { ModelCompilerClient } from "./model/compiler-client";
import type { ModelModule } from "./model/compiler";
import { sampleSource } from "./model/sample";
import type {
  ModelSnapshotObject,
  ParameterTarget,
  ParameterUsage,
  SourceRef,
} from "./model/runtime";
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
    const selectedKey = viewport.getSelected()?.key ?? "root";
    const firstRun = currentModule === null;
    const nextModule = await compiler.compile(codeEditor.getValue());
    if (revision !== runRevision) {
      return;
    }
    currentModule = nextModule;
    viewport.renderModule(currentModule, selectedKey, firstRun);
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

  const parameters = uniqueParameters(occurrence.node.parameters);
  if (parameters.length > 0) {
    const sectionLabel = document.createElement("div");
    sectionLabel.className = "parameter-section-label";
    sectionLabel.textContent = "SOURCE PARAMETERS";
    inspector.append(sectionLabel);
    parameters.forEach((parameter) => {
      const impact = currentModule?.parameterImpacts.get(parameter.target.id) ?? 1;
      inspector.append(parameterControl(parameter, impact));
    });
  } else {
    const empty = document.createElement("p");
    empty.className = "inspector-copy";
    empty.textContent = "这个对象暂时没有可安全写回的数值参数。";
    inspector.append(empty);
  }

  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  actions.append(actionButton("聚焦", () => viewport.focusSelection()));
  inspector.append(actions);

  const note = document.createElement("p");
  note.className = "inspector-note";
  note.textContent =
    "拖动时使用临时预览；确认后修改源文件并重新执行。unit 只影响界面提示。";
  inspector.append(note);
}

function parameterControl(parameter: ParameterUsage, impact: number): HTMLElement {
  const { target } = parameter;
  const bounds = parameterBounds(parameter);
  const wrapper = document.createElement("section");
  wrapper.className = "parameter-control";

  const row = document.createElement("div");
  row.className = "parameter-control-row";
  const name = document.createElement("span");
  name.className = "parameter-name";
  name.textContent = target.label;

  const valueGroup = document.createElement("span");
  valueGroup.className = "parameter-value";
  const numberInput = document.createElement("input");
  numberInput.className = "parameter-number";
  numberInput.type = "number";
  numberInput.min = String(bounds.min);
  numberInput.max = String(bounds.max);
  numberInput.step = String(bounds.step);
  numberInput.value = String(target.value);
  numberInput.setAttribute("aria-label", target.label);
  valueGroup.append(numberInput);
  if (target.unit) {
    const unit = document.createElement("span");
    unit.textContent = target.unit;
    valueGroup.append(unit);
  }
  row.append(name, valueGroup);

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(bounds.min);
  range.max = String(bounds.max);
  range.step = String(bounds.step);
  range.value = String(target.value);

  const details = document.createElement("p");
  details.className = "parameter-details";
  const context = `${parameter.operation}.${parameter.argument}`;
  details.textContent = target.description
    ? `${target.description} · ${context}`
    : context;
  if (impact > 1) {
    const impactLabel = document.createElement("span");
    impactLabel.className = "parameter-impact";
    impactLabel.textContent = `影响 ${impact} 个对象`;
    details.append(" · ", impactLabel);
  }

  const preview = (value: number): void => {
    if (!Number.isFinite(value)) return;
    range.value = String(value);
    numberInput.value = String(value);
    viewport.setParameterPreview(target.id, value);
  };
  const commit = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (value === target.value) {
      viewport.clearParameterPreview(target.id);
      return;
    }
    codeEditor.revealSource(target.sourceRef);
    if (!codeEditor.replaceNumber(target.sourceRef, target.value, value)) {
      viewport.clearParameterPreview(target.id);
      setRunState("pending", "源码已变化");
      errorBar.textContent = "参数对应的源码已经变化，请等待模型更新后重试。";
      errorBar.hidden = false;
    }
  };

  range.addEventListener("input", () => preview(Number(range.value)));
  range.addEventListener("change", () => commit(Number(range.value)));
  numberInput.addEventListener("input", () => preview(Number(numberInput.value)));
  numberInput.addEventListener("change", () => commit(Number(numberInput.value)));
  numberInput.addEventListener("focus", () => codeEditor.revealSource(target.sourceRef));

  wrapper.append(row, range, details);
  return wrapper;
}

function uniqueParameters(parameters: readonly ParameterUsage[]): ParameterUsage[] {
  const unique = new Map<string, ParameterUsage>();
  for (const parameter of parameters) {
    if (!unique.has(parameter.target.id)) {
      unique.set(parameter.target.id, parameter);
    }
  }
  return [...unique.values()];
}

function parameterBounds(parameter: ParameterUsage): Readonly<{
  min: number;
  max: number;
  step: number;
}> {
  const { target } = parameter;
  const span = Math.max(Math.abs(target.value), 10);
  const positive = [
    "box",
    "cylinder",
    "sphere",
    "fillet",
    "chamfer",
    "scaled",
  ].includes(parameter.operation);
  return {
    min: target.min ?? (positive ? Math.max(span / 100, 0.01) : target.value - span),
    max: target.max ?? target.value + span,
    step: target.step ?? inferredStep(target),
  };
}

function inferredStep(target: ParameterTarget): number {
  if (target.kind === "count") return 1;
  if (target.kind === "angle") return 1;
  return Math.abs(target.value) < 10 ? 0.1 : 0.5;
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
