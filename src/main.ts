import './style.css';
import {CodeEditor} from './editor';
import {ModelCompilerClient} from './model/compiler-client';
import type {
  ModelModule,
  ObjectCatalogEntry,
  ObjectCatalogOccurrence,
} from './model/compiler';
import {sampleSource} from './model/sample';
import type {
  ModelSnapshotObject,
  ParameterTarget,
  ParameterUsage,
  SourceRef,
} from './model/runtime';
import type {
  PositionGizmoBinding,
  PositionGizmoEvent,
} from './tools/position-gizmo';
import {parameterRange} from './tools/parameter-policy';
import {
  ToolEngine,
  type ToolIntent,
  type ToolPreview,
  type ToolSession,
} from './tools/tool-system';
import {ModelViewport, type Occurrence} from './viewport';

const storageKey = 'code3d.prototype.source';
const savedSource = localStorage.getItem(storageKey) ?? sampleSource;
const app = document.querySelector<HTMLDivElement>('#app');

type CatalogTarget = Readonly<{
  id: string;
  nodeIds: readonly string[];
  sourceRef: SourceRef;
}>;

if (!app) {
  throw new Error('Missing #app element.');
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
          <span class="pane-meta">入口模组 · ⇧ Alt F 格式化</span>
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
          <div class="viewport-hint">拖动旋转 · 滚轮缩放 · 点击对象 · 拖动 gizmo</div>
          <div class="tool-status" id="tool-status" hidden></div>
          <aside class="object-catalog" aria-label="运行时对象">
            <header class="object-catalog-header">
              <span>OBJECTS</span>
              <span id="object-catalog-count">0</span>
            </header>
            <div class="object-catalog-list" id="object-catalog-list"></div>
            <p class="object-catalog-hint">悬停预览 · 点击定位并固定</p>
          </aside>
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

const editorHost = requiredElement('editor-host');
const viewportHost = requiredElement('viewport-host');
const runState = requiredElement('run-state');
const runStateLabel = requiredElement('run-state-label');
const errorBar = requiredElement('error-bar');
const scopeList = requiredElement('scope-list');
const objectCatalogList = requiredElement('object-catalog-list');
const objectCatalogCount = requiredElement('object-catalog-count');
const inspector = requiredElement('inspector');
const toolStatus = requiredElement('tool-status');
const runButton = requiredElement<HTMLButtonElement>('run-button');
const resetButton = requiredElement<HTMLButtonElement>('reset-button');

const codeEditor = new CodeEditor(editorHost, savedSource);
const compiler = new ModelCompilerClient();
let currentModule: ModelModule | null = null;
let compileTimer: number | undefined;
let explodeValue = 0;
let runRevision = 0;
let positionToolSession: ToolSession | undefined;
let pinnedCatalogId: string | undefined;
let catalogHoverTimer: number | undefined;
const expandedCatalogIds = new Set<string>();
const catalogTargets = new Map<string, CatalogTarget>();

const viewport = new ModelViewport(
  viewportHost,
  occurrence => {
    selectOccurrence(occurrence, true);
  },
  handlePositionTool,
);
const toolEngine = new ToolEngine({
  sourceVersion: () => codeEditor.sourceVersion(),
  readSource: sourceRef => codeEditor.readSource(sourceRef),
  applySourceEdits: (baseVersion, edits) =>
    codeEditor.applySourceEdits(baseVersion, edits),
  applyPreview: preview => applyToolPreview(preview),
  clearPreview: preview => clearToolPreview(preview),
});

codeEditor.onChange(() => {
  localStorage.setItem(storageKey, codeEditor.getValue());
  setRunState('pending', '等待更新');
  window.clearTimeout(compileTimer);
  compileTimer = window.setTimeout(runModel, 420);
});

codeEditor.onCursorOffset(offset => {
  if (viewport.selectBySourceOffset(offset)) {
    pinnedCatalogId = undefined;
  }
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  }
});

runButton.addEventListener('click', runModel);
resetButton.addEventListener('click', () => {
  if (!window.confirm('将编辑器恢复为 prototype 示例？')) {
    return;
  }
  codeEditor.setValue(sampleSource);
  localStorage.removeItem(storageKey);
  runModel();
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && viewport.cancelPositionTool()) {
    event.preventDefault();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    runModel();
  }
});

runModel();

async function runModel(): Promise<void> {
  window.clearTimeout(compileTimer);
  const revision = ++runRevision;
  setRunState('running', '正在编译');
  errorBar.hidden = true;

  try {
    const selectedKey = viewport.getSelected()?.key ?? 'root';
    const firstRun = currentModule === null;
    const nextModule = await compiler.compile(codeEditor.getValue());
    if (revision !== runRevision) {
      return;
    }
    currentModule = nextModule;
    viewport.renderModule(currentModule, selectedKey, firstRun);
    explodeValue = 0;
    renderScopes(currentModule);
    renderObjectCatalog(currentModule);
    const restoredCatalogTarget = restorePinnedCatalogTarget();
    if (!restoredCatalogTarget) {
      const cursorOffset = codeEditor.cursorOffset();
      if (cursorOffset !== undefined) {
        if (viewport.selectBySourceOffset(cursorOffset)) {
          pinnedCatalogId = undefined;
        }
      }
    }
    const selected = viewport.getSelected();
    if (selected) {
      selectOccurrence(selected, false);
    }
    const objectCount = countObjects(currentModule.fallback);
    setRunState('ready', `${objectCount} 个对象`);
  } catch (error) {
    if (revision !== runRevision) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setRunState('error', '运行失败');
    errorBar.textContent = message;
    errorBar.hidden = false;
  }
}

function renderScopes(module: ModelModule): void {
  scopeList.replaceChildren();
  scopeList.append(
    scopeButton('整体预览', module.fallback.nodeId, () => {
      pinnedCatalogId = undefined;
      viewport.selectRoot();
      updateCatalogSelection(viewport.getSelected());
    }),
  );
}

function renderObjectCatalog(module: ModelModule): void {
  window.clearTimeout(catalogHoverTimer);
  objectCatalogList.replaceChildren();
  catalogTargets.clear();
  const entries = module.catalog.filter(
    entry => entry.visibility === 'primary' && entry.nodeIds.length > 0,
  );
  const lineage = module.catalog.filter(
    entry => entry.visibility === 'lineage' && entry.nodeIds.length > 0,
  );
  objectCatalogCount.textContent = String(entries.length);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'object-catalog-empty';
    empty.textContent = '暂无命名对象';
    objectCatalogList.append(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const localLineage = lineage
      .filter(candidate =>
        containsSourceRef(entry.sourceRef, candidate.sourceRef),
      )
      .sort((left, right) => left.firstOrder - right.firstOrder);
    objectCatalogList.append(
      objectCatalogGroup(entry, String(index + 1).padStart(2, '0'), module, {
        variant: 'primary',
        lineage: localLineage,
      }),
    );
  });

  if (pinnedCatalogId && !catalogTargets.has(pinnedCatalogId)) {
    pinnedCatalogId = undefined;
  }
  updateCatalogSelection(viewport.getSelected());
}

function objectCatalogGroup(
  entry: ObjectCatalogEntry,
  orderLabel: string,
  module: ModelModule,
  options: Readonly<{
    variant: 'primary' | 'lineage';
    lineage?: readonly ObjectCatalogEntry[];
  }>,
): HTMLElement {
  const group = document.createElement('section');
  group.className = `object-catalog-group ${options.variant}`;

  const row = document.createElement('div');
  row.className = 'object-catalog-row';
  const details = document.createElement('div');
  details.className = 'object-catalog-details';

  const showInstances = entry.occurrences.length > 1;
  const lineage = options.lineage ?? [];
  const expandable = showInstances || lineage.length > 0;
  const expanded = expandable && expandedCatalogIds.has(entry.id);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'object-catalog-toggle';
  toggle.textContent = expandable ? '›' : '';
  toggle.disabled = !expandable;
  toggle.tabIndex = expandable ? 0 : -1;
  toggle.setAttribute('aria-label', `${entry.label} 详情`);
  toggle.setAttribute('aria-expanded', String(expanded));

  const button = objectCatalogEntryButton(
    entry,
    orderLabel,
    module,
    options.variant,
  );
  bindCatalogTarget(button, catalogEntryTarget(entry));
  row.append(toggle, button);

  entry.occurrences.forEach((occurrence, index) => {
    registerCatalogTarget(catalogOccurrenceTarget(occurrence));
    if (showInstances) {
      details.append(objectCatalogOccurrenceButton(occurrence, index));
    }
  });

  if (lineage.length > 0) {
    const label = document.createElement('div');
    label.className = 'object-catalog-section-label';
    label.textContent = 'LINEAGE';
    details.append(label);
    lineage.forEach(candidate => {
      details.append(
        objectCatalogGroup(candidate, `@${candidate.firstOrder}`, module, {
          variant: 'lineage',
        }),
      );
    });
  }

  details.hidden = !expanded;
  group.classList.toggle('expanded', expanded);
  toggle.addEventListener('click', () => {
    const nextExpanded = !expandedCatalogIds.has(entry.id);
    if (nextExpanded) {
      expandedCatalogIds.add(entry.id);
    } else {
      expandedCatalogIds.delete(entry.id);
    }
    group.classList.toggle('expanded', nextExpanded);
    details.hidden = !nextExpanded;
    toggle.setAttribute('aria-expanded', String(nextExpanded));
  });
  group.append(row, details);
  return group;
}

function objectCatalogEntryButton(
  entry: ObjectCatalogEntry,
  orderLabel: string,
  module: ModelModule,
  variant: 'primary' | 'lineage',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `object-catalog-entry catalog-target ${variant}`;
  button.title = `${entry.label}：点击定位源码并固定预览`;

  const order = document.createElement('span');
  order.className = 'object-catalog-order';
  order.textContent = orderLabel;

  const copy = document.createElement('span');
  copy.className = 'object-catalog-copy';
  const label = document.createElement('strong');
  label.textContent = entry.label;
  const meta = document.createElement('small');
  meta.textContent = catalogEntryMeta(entry, module);
  copy.append(label, meta);

  const count = document.createElement('span');
  count.className = 'object-catalog-instances';
  count.textContent =
    entry.occurrences.length > 1 ? `×${entry.occurrences.length}` : '';
  button.append(order, copy, count);
  return button;
}

function objectCatalogOccurrenceButton(
  occurrence: ObjectCatalogOccurrence,
  index: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'object-catalog-occurrence catalog-target';
  button.title = `${occurrence.label}：点击定位这个运行时实例`;

  const marker = document.createElement('span');
  marker.className = 'object-catalog-occurrence-marker';
  marker.textContent = `#${String(index + 1).padStart(2, '0')}`;
  const copy = document.createElement('span');
  copy.className = 'object-catalog-copy';
  const label = document.createElement('strong');
  label.textContent = occurrence.label;
  const meta = document.createElement('small');
  meta.textContent = `RUN ${occurrence.execution + 1} · OUTPUT ${occurrence.output + 1}`;
  copy.append(label, meta);
  button.append(marker, copy);
  bindCatalogTarget(button, catalogOccurrenceTarget(occurrence));
  return button;
}

function catalogEntryMeta(
  entry: ObjectCatalogEntry,
  module: ModelModule,
): string {
  const kinds = new Set(
    entry.nodeIds.flatMap(nodeId => {
      const node = module.objects.get(nodeId);
      return node ? [node.kind] : [];
    }),
  );
  const parts = [kinds.size === 1 ? [...kinds][0].toUpperCase() : 'COLLECTION'];
  if (entry.executions > 1) {
    parts.push(`${entry.executions} RUNS`);
  }
  if (entry.exportNames.length > 0) {
    parts.push(`EXPORT ${entry.exportNames.join(', ')}`);
  }
  return parts.join(' · ');
}

function catalogEntryTarget(entry: ObjectCatalogEntry): CatalogTarget {
  return {
    id: entry.id,
    nodeIds: entry.nodeIds,
    sourceRef: entry.sourceRef,
  };
}

function catalogOccurrenceTarget(
  occurrence: ObjectCatalogOccurrence,
): CatalogTarget {
  return {
    id: occurrence.id,
    nodeIds: [occurrence.nodeId],
    sourceRef: occurrence.sourceRef,
  };
}

function registerCatalogTarget(target: CatalogTarget): void {
  catalogTargets.set(target.id, target);
}

function bindCatalogTarget(
  element: HTMLButtonElement,
  target: CatalogTarget,
): void {
  registerCatalogTarget(target);
  element.dataset.catalogTargetId = target.id;
  element.addEventListener('pointerenter', () => {
    window.clearTimeout(catalogHoverTimer);
    if (target.id === pinnedCatalogId) {
      return;
    }
    catalogHoverTimer = window.setTimeout(() => {
      if (viewport.previewNodes(target.nodeIds)) {
        syncViewportSelection();
      }
    }, 100);
  });
  element.addEventListener('pointerleave', () => {
    window.clearTimeout(catalogHoverTimer);
    if (target.id === pinnedCatalogId) {
      return;
    }
    viewport.restoreView();
    syncViewportSelection();
  });
  element.addEventListener('click', () => pinCatalogTarget(target));
}

function pinCatalogTarget(target: CatalogTarget): void {
  window.clearTimeout(catalogHoverTimer);
  pinnedCatalogId = target.id;
  if (viewport.selectNodes(target.nodeIds)) {
    codeEditor.revealSource(target.sourceRef);
    syncViewportSelection();
  }
}

function restorePinnedCatalogTarget(): boolean {
  if (!pinnedCatalogId) {
    return false;
  }
  const target = catalogTargets.get(pinnedCatalogId);
  if (!target || !viewport.selectNodes(target.nodeIds)) {
    pinnedCatalogId = undefined;
    return false;
  }
  codeEditor.revealSource(target.sourceRef);
  syncViewportSelection();
  return true;
}

function syncViewportSelection(): void {
  const occurrence = viewport.getSelected();
  if (occurrence) {
    selectOccurrence(occurrence, false);
  }
}

function updateCatalogSelection(occurrence?: Occurrence): void {
  const entries =
    objectCatalogList.querySelectorAll<HTMLElement>('.catalog-target');
  entries.forEach(element => {
    const targetId = element.dataset.catalogTargetId;
    const target = targetId ? catalogTargets.get(targetId) : undefined;
    element.classList.toggle(
      'active',
      target?.id === pinnedCatalogId ||
        (!!occurrence && target?.nodeIds.includes(occurrence.node.nodeId)),
    );
    element.classList.toggle('pinned', target?.id === pinnedCatalogId);
  });
}

function containsSourceRef(
  container: SourceRef,
  candidate: SourceRef,
): boolean {
  return container.start <= candidate.start && candidate.end <= container.end;
}

function scopeButton(
  label: string,
  nodeId: string,
  action: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scope-button';
  button.dataset.nodeId = nodeId;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function selectOccurrence(occurrence: Occurrence, revealSource: boolean): void {
  renderInspector(occurrence);
  updateActiveScope(occurrence);
  updateCatalogSelection(occurrence);

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

  const heading = document.createElement('div');
  heading.className = 'inspector-heading';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'inspector-eyebrow';
  eyebrow.textContent =
    occurrence.view === 'source'
      ? 'SOURCE NODE'
      : occurrence.depth === 0
        ? 'MODEL SCOPE'
        : 'LOCAL SCOPE';
  const title = document.createElement('strong');
  title.textContent = occurrence.node.name;
  heading.append(eyebrow, title);
  inspector.append(heading);

  if (occurrence.view === 'model' && occurrence.depth === 0) {
    renderModelInspector();
  } else {
    renderLocalInspector(occurrence);
  }
}

function renderModelInspector(): void {
  const copy = document.createElement('p');
  copy.className = 'inspector-copy';
  copy.textContent = '整体 scope 只改变当前观察方式，不修改模型代码。';

  const control = rangeControl('分解视图', explodeValue, -0, 32, 1, value => {
    explodeValue = value;
    viewport.setExplode(value);
  });

  const fitButton = actionButton('适应模型', () => viewport.fit());
  inspector.append(copy, control, fitButton);
}

function renderLocalInspector(occurrence: Occurrence): void {
  const kind = document.createElement('div');
  kind.className = 'object-kind';
  kind.textContent = occurrence.node.kind.toUpperCase();
  inspector.append(kind);

  const parameters = uniqueParameters(occurrence.node.parameters);
  if (parameters.length > 0) {
    const sectionLabel = document.createElement('div');
    sectionLabel.className = 'parameter-section-label';
    sectionLabel.textContent = 'SOURCE PARAMETERS';
    inspector.append(sectionLabel);
    parameters.forEach(parameter => {
      const impact =
        currentModule?.parameterImpacts.get(parameter.target.id) ?? 1;
      inspector.append(parameterControl(parameter, impact));
    });
  } else {
    const empty = document.createElement('p');
    empty.className = 'inspector-copy';
    empty.textContent = '这个对象暂时没有可安全写回的数值参数。';
    inspector.append(empty);
  }

  const actions = document.createElement('div');
  actions.className = 'inspector-actions';
  actions.append(actionButton('聚焦', () => viewport.focusSelection()));
  inspector.append(actions);

  const note = document.createElement('p');
  note.className = 'inspector-note';
  note.textContent =
    '拖动时使用临时预览；确认后修改源文件并重新执行。unit 只影响界面提示。';
  inspector.append(note);
}

function parameterControl(
  parameter: ParameterUsage,
  impact: number,
): HTMLElement {
  const {target} = parameter;
  const rangeBounds = parameterRange(target);
  const toolSession = toolEngine.begin(`inspector.parameter:${target.id}`);
  const wrapper = document.createElement('section');
  wrapper.className = 'parameter-control';
  wrapper.dataset.targetId = target.id;

  const row = document.createElement('div');
  row.className = 'parameter-control-row';
  const name = document.createElement('span');
  name.className = 'parameter-name';
  name.textContent = target.label;

  const valueGroup = document.createElement('span');
  valueGroup.className = 'parameter-value';
  const numberInput = document.createElement('input');
  numberInput.className = 'parameter-number';
  numberInput.type = 'number';
  if (target.min !== undefined && Number.isFinite(target.min)) {
    numberInput.min = String(target.min);
  }
  if (target.max !== undefined && Number.isFinite(target.max)) {
    numberInput.max = String(target.max);
  }
  numberInput.step =
    target.step !== undefined && Number.isFinite(target.step) && target.step > 0
      ? String(target.step)
      : 'any';
  numberInput.value = String(target.value);
  numberInput.setAttribute('aria-label', target.label);
  valueGroup.append(numberInput);
  if (target.unit) {
    const unit = document.createElement('span');
    unit.textContent = target.unit;
    valueGroup.append(unit);
  }
  row.append(name, valueGroup);

  const range = rangeBounds
    ? Object.assign(document.createElement('input'), {
        type: 'range',
        min: String(rangeBounds.min),
        max: String(rangeBounds.max),
        step: String(rangeBounds.step),
        value: String(target.value),
      })
    : undefined;

  const details = document.createElement('p');
  details.className = 'parameter-details';
  const context = `${parameter.operation}.${parameter.argument}`;
  details.textContent = target.description
    ? `${target.description} · ${context}`
    : context;
  if (impact > 1) {
    const impactLabel = document.createElement('span');
    impactLabel.className = 'parameter-impact';
    impactLabel.textContent = `影响 ${impact} 个对象`;
    details.append(' · ', impactLabel);
  }

  const preview = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (range) range.value = String(value);
    numberInput.value = String(value);
    const resolution = toolSession.preview(parameterIntent(target, value));
    if (resolution.status !== 'ready') {
      showToolIssue(resolution.reason);
    }
  };
  const commit = (value: number): void => {
    if (!Number.isFinite(value)) return;
    if (value === target.value) {
      toolSession.cancel();
      return;
    }
    codeEditor.revealSource(target.sourceRef);
    const result = toolSession.commit(parameterIntent(target, value));
    if (result.status !== 'committed') {
      showToolIssue(result.reason);
    }
  };

  range?.addEventListener('input', () => preview(Number(range.value)));
  range?.addEventListener('change', () => commit(Number(range.value)));
  numberInput.addEventListener('input', () =>
    preview(Number(numberInput.value)),
  );
  numberInput.addEventListener('change', () =>
    commit(Number(numberInput.value)),
  );
  numberInput.addEventListener('focus', () =>
    codeEditor.revealSource(target.sourceRef),
  );

  wrapper.append(row);
  if (range) wrapper.append(range);
  wrapper.append(details);
  return wrapper;
}

function parameterIntent(target: ParameterTarget, value: number): ToolIntent {
  return {kind: 'parameter.set', target, value};
}

function handlePositionTool(event: PositionGizmoEvent): void {
  if (event.kind === 'begin') {
    positionToolSession?.cancel();
    positionToolSession = toolEngine.begin(
      `viewport.translate:${event.binding.axis}:${positionBindingId(event.binding)}`,
    );
    errorBar.hidden = true;
    showPositionToolStatus(event.binding, event.binding.value);
    return;
  }

  if (event.kind === 'cancel') {
    positionToolSession?.cancel();
    positionToolSession = undefined;
    if (event.binding.kind === 'parameter') {
      updateParameterControl(event.binding.target.id, event.binding.value);
    }
    hidePositionToolStatus();
    return;
  }

  const session = positionToolSession;
  if (!session) {
    showToolIssue('位置工具会话已经失效，请重新拖动。');
    return;
  }
  if (event.binding.kind === 'parameter') {
    updateParameterControl(event.binding.target.id, event.value);
  }
  showPositionToolStatus(event.binding, event.value);

  if (event.kind === 'preview') {
    const resolution = session.preview(
      positionIntent(event.binding, event.value),
    );
    if (resolution.status !== 'ready') {
      showToolIssue(resolution.reason);
    }
    return;
  }

  if (Math.abs(event.value - event.binding.value) < 1e-9) {
    session.cancel();
  } else {
    codeEditor.revealSource(positionBindingSource(event.binding));
    const result = session.commit(positionIntent(event.binding, event.value));
    if (result.status !== 'committed') {
      showToolIssue(result.reason);
    }
  }
  positionToolSession = undefined;
  hidePositionToolStatus();
}

function positionIntent(
  binding: PositionGizmoBinding,
  value: number,
): ToolIntent {
  if (binding.kind === 'parameter') {
    return parameterIntent(binding.target, value);
  }
  const delta: [number, number, number] = [0, 0, 0];
  delta[positionAxisIndex(binding.axis)] = value;
  return {
    kind: 'relation.offset',
    receiver: binding.receiver,
    occurrenceKeys: binding.occurrenceKeys,
    delta,
    frameQuaternion: binding.frame.quaternion,
  };
}

function positionAxisIndex(axis: PositionGizmoBinding['axis']): 0 | 1 | 2 {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
}

function positionBindingId(binding: PositionGizmoBinding): string {
  if (binding.kind === 'parameter') {
    return binding.target.id;
  }
  const {start, end} = binding.receiver.sourceRef;
  return `expression:${start}:${end}`;
}

function positionBindingSource(binding: PositionGizmoBinding): SourceRef {
  return binding.kind === 'parameter'
    ? binding.target.sourceRef
    : binding.receiver.sourceRef;
}

function showPositionToolStatus(
  binding: PositionGizmoBinding,
  value: number,
): void {
  const impact =
    binding.kind === 'parameter'
      ? (currentModule?.parameterImpacts.get(binding.target.id) ?? 1)
      : binding.occurrenceKeys.length;
  const unit = binding.unit ? ` ${binding.unit}` : '';
  const effect = impact > 1 ? ` · 影响 ${impact} 个对象` : '';
  toolStatus.textContent = `${binding.axis.toUpperCase()} · ${binding.label} ${formatDisplayNumber(value)}${unit}${effect} · Esc 取消`;
  toolStatus.hidden = false;
}

function hidePositionToolStatus(): void {
  toolStatus.hidden = true;
}

function updateParameterControl(targetId: string, value: number): void {
  const control = [
    ...inspector.querySelectorAll<HTMLElement>('.parameter-control'),
  ].find(candidate => candidate.dataset.targetId === targetId);
  if (!control) return;
  const numberInput =
    control.querySelector<HTMLInputElement>('.parameter-number');
  const rangeInput = control.querySelector<HTMLInputElement>(
    'input[type="range"]',
  );
  if (numberInput) numberInput.value = String(value);
  if (rangeInput) rangeInput.value = String(value);
}

function formatDisplayNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function applyToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'parameter') {
    viewport.setParameterPreview(preview.targetId, preview.value);
  } else if (preview.kind === 'occurrence-translation') {
    viewport.setOccurrenceTranslationPreview(
      preview.occurrenceKeys,
      preview.delta,
    );
  }
}

function clearToolPreview(preview: ToolPreview): void {
  if (preview.kind === 'parameter') {
    viewport.clearParameterPreview(preview.targetId);
  } else if (preview.kind === 'occurrence-translation') {
    viewport.clearOccurrenceTranslationPreview(preview.occurrenceKeys);
  }
}

function showToolIssue(message: string): void {
  setRunState('pending', '工具需要更新');
  errorBar.textContent = message;
  errorBar.hidden = false;
}

function uniqueParameters(
  parameters: readonly ParameterUsage[],
): ParameterUsage[] {
  const unique = new Map<string, ParameterUsage>();
  for (const parameter of parameters) {
    if (!unique.has(parameter.target.id)) {
      unique.set(parameter.target.id, parameter);
    }
  }
  return [...unique.values()];
}

function rangeControl(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'range-control';
  const row = document.createElement('span');
  const name = document.createElement('span');
  name.textContent = label;
  const output = document.createElement('output');
  output.textContent = String(value);
  row.append(name, output);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = String(next);
    onInput(next);
  });
  wrapper.append(row, input);
  return wrapper;
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspector-button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function updateActiveScope(occurrence: Occurrence): void {
  const buttons =
    scopeList.querySelectorAll<HTMLButtonElement>('.scope-button');
  buttons.forEach(button => {
    button.classList.toggle('active', occurrence.view === 'model');
  });
}

function setRunState(
  state: 'idle' | 'pending' | 'running' | 'ready' | 'error',
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
