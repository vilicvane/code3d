/** Public modeling packages provided together by the zero-install App. */
export const builtinPackageNames = [
  '@code3d/core',
  '@code3d/screws',
  '@code3d/materials',
] as const;

export const isBuiltinPackageSpecifier = (specifier: string): boolean =>
  builtinPackageNames.some(
    name => specifier === name || specifier.startsWith(name + '/'),
  );
