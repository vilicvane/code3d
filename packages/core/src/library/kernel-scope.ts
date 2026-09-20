type NativeResource = {delete(): void};

/** Own handles immediately after acquisition; release only values returned to a caller. */
export class NativeScope {
  private readonly resources = new Set<NativeResource>();

  own<T extends NativeResource>(value: T): T {
    this.resources.add(value);
    return value;
  }

  release<T extends NativeResource>(value: T): T {
    this.resources.delete(value);
    return value;
  }

  delete(): void {
    for (const resource of [...this.resources].reverse()) {
      this.resources.delete(resource);
      resource.delete();
    }
  }
}

export function withNativeScope<T>(compute: (scope: NativeScope) => T): T {
  const scope = new NativeScope();
  try {
    return compute(scope);
  } finally {
    scope.delete();
  }
}
