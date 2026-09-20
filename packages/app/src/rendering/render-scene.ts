import {action, computed, makeObservable, observableRef} from 'mobx';

export type ScenePreset = Readonly<{
  label: string;
  background: string;
  hemisphere: number;
  ambient: number;
  key: number;
  keyPosition: readonly [number, number, number];
  rim: number;
  environment: Readonly<{
    ambient: number;
    sky: number;
    softboxes: readonly [number, number, number];
    sharpness: number;
  }>;
}>;

// Modeling always uses this lighting, independently of the render selection.
export const modelingScenePreset: ScenePreset = {
  label: 'Studio',
  background: '#171815',
  hemisphere: 1.2,
  ambient: 0.8,
  key: 2.4,
  keyPosition: [70, 110, 80],
  rim: 1.6,
  environment: {
    ambient: 0.45,
    sky: 0.25,
    softboxes: [2.5, 2.5, 2.5],
    sharpness: 12,
  },
};

export const renderScenePresets = {
  studio: modelingScenePreset,
  side: {
    label: 'Side light',
    background: '#171815',
    hemisphere: 0.35,
    ambient: 0.1,
    key: 3,
    keyPosition: [100, 25, 45],
    rim: 0.6,
    environment: {
      ambient: 0.08,
      sky: 0.05,
      softboxes: [3, 0.7, 0.15],
      sharpness: 20,
    },
  },
  soft: {
    label: 'Soft light',
    background: '#e6e7e4',
    hemisphere: 0.5,
    ambient: 0.15,
    key: 1.4,
    keyPosition: [70, 110, 80],
    rim: 0.55,
    environment: {
      ambient: 0.12,
      sky: 0.12,
      softboxes: [1.2, 0.65, 0.45],
      sharpness: 4,
    },
  },
} as const satisfies Record<string, ScenePreset>;

export type RenderScenePreset = keyof typeof renderScenePresets;

export const renderSceneStorageKey = 'code3d-render-scene';

/** One selection; only the interactive viewport opts into browser persistence. */
export class RenderScenePreference {
  private selected: RenderScenePreset;

  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.selected = this.read();
    makeObservable<this, 'selected'>(this, {
      selected: observableRef,
      preset: computed,
      select: action,
    });
  }

  get preset(): RenderScenePreset {
    return this.selected;
  }

  select(preset: RenderScenePreset): void {
    // Preserve the current scene if the browser cannot save the new preference.
    this.storage?.setItem(renderSceneStorageKey, preset);
    this.selected = preset;
  }

  private read(): RenderScenePreset {
    try {
      const saved = this.storage?.getItem(renderSceneStorageKey);
      if (saved && Object.hasOwn(renderScenePresets, saved))
        return saved as RenderScenePreset;
    } catch {
      // Browser storage can be unavailable; rendering still has a default.
    }
    return 'studio';
  }
}
