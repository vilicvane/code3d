import {reaction} from 'mobx';
import {ChevronDown} from 'lucide';
import type {ModelViewport} from '../viewport';
import {
  renderScenePresets,
  type RenderScenePreset,
} from '../rendering/render-scene';
import {ChoiceMenu} from './choice-menu';
import {createIcon} from './icons';
import {dialogs} from './dialog';

/** Render-only scene preference; the menu consumes the viewport's selection. */
export class ViewportSceneSelector {
  readonly root = document.createElement('div');
  private readonly menu: ChoiceMenu<RenderScenePreset>;
  private readonly stop: () => void;

  constructor(
    container: HTMLElement,
    viewport: ModelViewport,
    presentation: () => {visible: boolean; disabled: boolean},
  ) {
    this.root.className = 'viewport-scene-selector';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'viewport-scene-trigger';
    trigger.setAttribute('aria-label', 'Render scene');
    trigger.title = 'Lighting and background · Also applies to image export';
    const label = document.createElement('span');
    trigger.append(label, createIcon(ChevronDown));
    this.root.append(trigger);
    this.menu = new ChoiceMenu(trigger, {
      label: 'Render scene',
      choices: (Object.keys(renderScenePresets) as RenderScenePreset[]).map(
        value => ({
          value,
          label: renderScenePresets[value].label,
        }),
      ),
      value: () => viewport.renderScenePreset,
      select: value => {
        try {
          viewport.setRenderScenePreset(value);
        } catch (error) {
          void dialogs.alert({
            title: 'Could not save render scene',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      align: 'end',
    });
    container.append(this.root);
    this.stop = reaction(
      () => ({...presentation(), preset: viewport.renderScenePreset}),
      ({visible, disabled, preset}) => {
        this.root.hidden = !visible;
        trigger.disabled = disabled;
        if (!visible || disabled) this.menu.close();
        label.textContent = renderScenePresets[preset].label;
      },
      {fireImmediately: true},
    );
  }

  dispose(): void {
    this.stop();
    this.menu.dispose();
    this.root.remove();
  }
}
