import {
  action,
  compareStructural,
  makeObservable,
  observableRef,
  reaction,
} from 'mobx';
import type {IconNode} from 'lucide';
import type {SourceTarget} from '../model/compiler';
import type {
  SpatialTool,
  TransformGizmo,
  TransformGizmoBinding,
} from '../tools/transform-gizmo';
import {Toolbar} from './toolbar';

const names: Record<SpatialTool, string> = {
  translate: 'Translate',
  'rotate-point': 'Rotate about point',
  'rotate-axis': 'Rotate about axis',
};
const modelNames = {
  translate: 'Origin Offset',
  'rotate-point': 'Rotate model',
} as const;

const translateIcon: IconNode = [
  ['path', {d: 'M5 3v16h16 M2 6l3-3 3 3 M18 16l3 3-3 3'}],
  ['circle', {cx: 5, cy: 19, r: 1.75, fill: 'currentColor', stroke: 'none'}],
];
// Share the arrowed horizontal arc from Lucide's Rotate3d.
const rotationArc: IconNode = [
  ['path', {d: 'm15.194 13.707 3.814 1.86-1.86 3.814'}],
  ['path', {d: 'M21.79796 11 A 10 5 0 1 0 19 15.57071'}],
];
const rotatePointIcon: IconNode = [
  ['path', {d: 'M16.47214 7.52786 A 5 10 0 1 0 13 21.79796'}],
  ...rotationArc,
  ['circle', {cx: 12, cy: 12, r: 1.75, fill: 'currentColor', stroke: 'none'}],
];
const rotateAxisIcon: IconNode = [
  ['path', {d: 'M12 2v20', 'stroke-dasharray': '2 3'}],
  ...rotationArc,
];

/** Spatial tool choice with remembered rotation variants. */
export class SpatialToolbar {
  readonly root = document.createElement('section');
  private readonly toolbar = new Toolbar('Position tools');
  selection?: Readonly<{
    binding?: Extract<TransformGizmoBinding, {kind: 'spatial'}>;
    draft?: NonNullable<SourceTarget['rotationSelection']>;
    tool: 'rotate-point' | 'rotate-axis';
    occurrenceKey: string;
    sourceVersion: number;
    hasTopology: boolean;
  }>;
  private readonly stop: () => void;
  private activation = 0;

  constructor(
    container: HTMLElement,
    private readonly tools: TransformGizmo,
    private readonly options: {
      visible(): boolean;
      availableTools(): readonly SpatialTool[];
      context(): 'model' | 'relation';
      cancel(): void;
      activateSource(tool: SpatialTool): Promise<boolean>;
    },
  ) {
    this.root.className = 'spatial-toolbar';
    const group = this.toolbar.group('Transform');
    const modelGroup = this.toolbar.group('Model transform');
    const choose = async (tool: SpatialTool) => {
      const activation = ++this.activation;
      this.options.cancel();
      const presented = await this.options.activateSource(tool);
      // Bind the choice to the newly presented context, including async inspect.
      if (presented && activation === this.activation)
        this.tools.selectTool(tool);
    };
    this.toolbar.add(group, {
      name: names.translate,
      title: 'Translate',
      icon: translateIcon,
      run: () => choose('translate'),
    });
    this.toolbar.variants(group, 'Rotation tools', [
      {
        name: names['rotate-point'],
        title: names['rotate-point'],
        icon: rotatePointIcon,
        run: () => choose('rotate-point'),
      },
      {
        name: names['rotate-axis'],
        title: names['rotate-axis'],
        icon: rotateAxisIcon,
        run: () => choose('rotate-axis'),
      },
    ]);
    this.toolbar.add(modelGroup, {
      name: modelNames.translate,
      title: 'Edit originOffset (Alt drags the model)',
      icon: translateIcon,
      run: () => choose('translate'),
    });
    this.toolbar.add(modelGroup, {
      name: modelNames['rotate-point'],
      title: 'Edit model rotate',
      icon: rotatePointIcon,
      run: () => choose('rotate-point'),
    });
    this.root.append(this.toolbar.root);
    container.append(this.root);
    makeObservable(this, {selection: observableRef, setSelection: action});
    this.stop = reaction(
      () => ({
        tool: tools.tool,
        available: options.availableTools(),
        context: options.context(),
        visible: options.visible(),
      }),
      ({tool, available, context, visible}) => {
        group.style.display = context === 'relation' ? '' : 'none';
        modelGroup.style.display = context === 'model' ? '' : 'none';
        this.root.hidden = !visible || !available.length;
        if (this.root.hidden) this.toolbar.close();
        if (context === 'relation' && tool && tool !== 'translate')
          this.toolbar.selectVariant(names[tool]);
        this.toolbar.update(name => ({
          pressed:
            !!tool &&
            name ===
              (context === 'model' && tool !== 'rotate-axis'
                ? modelNames[tool]
                : names[tool]),
          disabled: !available.some(
            tool =>
              (context === 'model' && tool !== 'rotate-axis'
                ? modelNames[tool]
                : names[tool]) === name,
          ),
        }));
      },
      {fireImmediately: true, equals: compareStructural},
    );
  }

  setSelection(value: SpatialToolbar['selection']): void {
    this.selection = value;
  }
  dispose(): void {
    this.activation++;
    this.stop();
    this.toolbar.dispose();
    this.root.remove();
  }
}
