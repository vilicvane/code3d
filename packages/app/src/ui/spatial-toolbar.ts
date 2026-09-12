import {action, autorun, makeObservable, observableRef} from 'mobx';
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

  constructor(
    container: HTMLElement,
    private readonly tools: TransformGizmo,
    private readonly options: {
      visible(): boolean;
      cancel(): void;
      activateSource(): void;
    },
  ) {
    this.root.className = 'spatial-toolbar';
    const group = this.toolbar.group('Transform');
    const choose = action((tool: SpatialTool) => {
      this.options.cancel();
      this.tools.selectTool(tool);
      this.options.activateSource();
      // Navigation changes the source context; retain the explicit tool choice.
      this.tools.selectTool(tool);
    });
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
    this.root.append(this.toolbar.root);
    container.append(this.root);
    makeObservable(this, {selection: observableRef, setSelection: action});
    this.stop = autorun(() => {
      const tool = tools.tool;
      this.root.hidden = !options.visible() || !tools.availableTools.length;
      if (this.root.hidden) this.toolbar.close();
      if (tool && tool !== 'translate') this.toolbar.selectVariant(names[tool]);
      this.toolbar.update(name => ({
        pressed: !!tool && name === names[tool],
        disabled: !tools.availableTools.some(tool => names[tool] === name),
      }));
    });
  }

  setSelection(value: SpatialToolbar['selection']): void {
    this.selection = value;
  }
  dispose(): void {
    this.stop();
    this.toolbar.close();
    this.root.remove();
  }
}
