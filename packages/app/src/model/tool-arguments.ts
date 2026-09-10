import type {SourceRef} from '@code3d/core/tooling';
import type {SourceTarget} from './compiler';
import type {ToolParameterSchema} from './tool-schema';

/** Locate this argument occurrence, independently of its editable variable. */
export function sourceParameterAt(
  target: SourceTarget,
  file: string,
  offset: number,
  resolveSourceRef: (ref: SourceRef) => SourceRef | undefined = ref => ref,
): ToolParameterSchema | undefined {
  const argument = target.tool?.arguments.find(({target: source}) => {
    const ref = source && resolveSourceRef(source.sourceRef);
    return ref?.file === file && ref.start <= offset && offset <= ref.end;
  });
  return argument
    ? target.tool!.signature.parameters.find(
        parameter => parameter.index === argument.index,
      )
    : undefined;
}
