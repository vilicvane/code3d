export const compilationPhaseLabels = {
  'loading-compiler': 'Loading compiler',
  'loading-project': 'Loading project dependencies',
  'loading-runtime': 'Loading modeling engine',
  'initializing-runtime': 'Initializing modeling engine',
  'compiling-model': 'Compiling model',
  'evaluating-model': 'Building model',
} as const;

export type CompilationPhase = keyof typeof compilationPhaseLabels;
export type CompilationProgress = (phase: CompilationPhase) => void;
