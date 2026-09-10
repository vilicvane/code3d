export const compilationPhaseLabels = {
  'loading-compiler': 'Loading compiler',
  'preparing-project': 'Preparing project',
  'loading-runtime': 'Loading modeling engine',
  'initializing-runtime': 'Initializing modeling engine',
  'compiling-model': 'Compiling model',
  'evaluating-model': 'Building model',
} as const;

export type CompilationPhase = keyof typeof compilationPhaseLabels;
export type CompilationProgress = (phase: CompilationPhase) => void;
