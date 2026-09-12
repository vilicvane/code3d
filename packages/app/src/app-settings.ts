import {action, computed, makeObservable, observableRef} from 'mobx';

export type AppSettingsValues = Readonly<{
  editDelayMs: number;
  completionDelayMs: number;
  pixelRatioLimit: number | null;
  snapshotConcurrency: number;
  memoryCacheGiB: number;
  diskCacheGiB: number;
}>;

export type ExecutionSettings = Readonly<{
  snapshotConcurrency: number;
  memoryCacheBytes: number;
}>;

export const appSettingsStorageKey = 'code3d-app-settings';
export const gibibyte = 1024 ** 3;

export function defaultAppSettings(): AppSettingsValues {
  return {
    editDelayMs: 400,
    completionDelayMs: 200,
    pixelRatioLimit: null,
    snapshotConcurrency: Math.min(
      4,
      Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1),
    ),
    memoryCacheGiB: 2,
    diskCacheGiB: 2,
  };
}

export class AppSettingError extends Error {
  constructor(
    readonly key: keyof AppSettingsValues,
    message: string,
  ) {
    super(message);
  }
}

export function validateAppSettings(value: AppSettingsValues): void {
  for (const key of ['editDelayMs', 'completionDelayMs'] as const) {
    const delay = value[key];
    if (!Number.isInteger(delay) || delay < 0 || delay > 2 ** 31 - 1)
      throw new AppSettingError(
        key,
        'Enter a whole delay from 0 to 2147483647 ms.',
      );
  }
  if (
    value.pixelRatioLimit !== null &&
    (!Number.isFinite(value.pixelRatioLimit) || value.pixelRatioLimit <= 0)
  )
    throw new AppSettingError(
      'pixelRatioLimit',
      'Enter a positive resolution limit, or leave it empty.',
    );
  if (
    !Number.isSafeInteger(value.snapshotConcurrency) ||
    value.snapshotConcurrency < 1
  )
    throw new AppSettingError(
      'snapshotConcurrency',
      'Enter a positive whole number of geometry workers.',
    );
  for (const key of ['memoryCacheGiB', 'diskCacheGiB'] as const) {
    const budget = value[key];
    if (
      !Number.isFinite(budget) ||
      budget <= 0 ||
      !Number.isFinite(budget * gibibyte)
    )
      throw new AppSettingError(key, 'Enter a positive cache budget in GiB.');
  }
}

/** Browser-wide preferences; projects and Workers consume values, not copies of UI state. */
export class AppSettings {
  private values: AppSettingsValues;
  private readonly defaults = defaultAppSettings();

  constructor(
    private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly events?: Pick<
      Window,
      'addEventListener' | 'removeEventListener'
    >,
  ) {
    this.values = this.read();
    makeObservable<this, 'values' | 'receive'>(this, {
      values: observableRef,
      execution: computed,
      save: action,
      receive: action,
    });
    events?.addEventListener('storage', this.receive);
  }

  get value(): AppSettingsValues {
    return this.values;
  }

  get execution(): ExecutionSettings {
    return {
      snapshotConcurrency: this.values.snapshotConcurrency,
      memoryCacheBytes: this.values.memoryCacheGiB * gibibyte,
    };
  }

  save(value: AppSettingsValues): void {
    validateAppSettings(value);
    // A failed write leaves the committed values intact so the form can retry.
    this.storage?.setItem(appSettingsStorageKey, JSON.stringify(value));
    this.values = value;
  }

  dispose(): void {
    this.events?.removeEventListener('storage', this.receive);
  }

  private receive = (event: Event): void => {
    const {key} = event as StorageEvent;
    if (key === appSettingsStorageKey || key === null)
      this.values = this.read();
  };

  private read(): AppSettingsValues {
    try {
      const text = this.storage?.getItem(appSettingsStorageKey);
      if (!text) return this.defaults;
      const value = JSON.parse(text) as AppSettingsValues;
      validateAppSettings(value);
      return value;
    } catch {
      return this.defaults;
    }
  }
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const appSettings = new AppSettings(
  browserStorage(),
  typeof window === 'undefined' ? undefined : window,
);
