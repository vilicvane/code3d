export const compilationPhaseLabels = {
  'loading-compiler': 'Loading compiler',
  'reading-files': 'Reading files',
  'resolving-imports': 'Resolving imports',
  'loading-runtime': 'Loading dependencies',
  'initializing-runtime': 'Starting modeling engine',
  'compiling-model': 'Compiling code',
  'evaluating-model': 'Building model',
  'preparing-preview': 'Preparing preview',
} as const;

export type CompilationPhase = keyof typeof compilationPhaseLabels;
export type CompilationProgress = (phase: CompilationPhase) => void;

export const compilationPhaseDescriptions: Record<CompilationPhase, string> = {
  'loading-compiler': 'Load the code compiler for this session.',
  'reading-files': 'Read project source files and configuration.',
  'resolving-imports':
    'Locate imported files, packages, and type declarations.',
  'loading-runtime': 'Load and prepare the packages used by the model.',
  'initializing-runtime': 'Start the geometry engine and dependency modules.',
  'compiling-model': 'Compile model code and its interactive tool metadata.',
  'evaluating-model': 'Run model code and calculate geometry.',
  'preparing-preview': 'Prepare display meshes, topology, and model snapshots.',
};
