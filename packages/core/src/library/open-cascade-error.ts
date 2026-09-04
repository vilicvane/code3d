import {getOC} from 'replicad';

export function describeOpenCascadeException(
  error: unknown,
): string | undefined {
  if (
    typeof WebAssembly === 'undefined' ||
    typeof WebAssembly.Exception !== 'function' ||
    !(error instanceof WebAssembly.Exception)
  ) {
    return undefined;
  }

  try {
    const [name, message] = getOC().getExceptionMessage(error);
    const description = [name, message]
      .map(part => part?.trim())
      .filter((part, index, parts) => part && parts.indexOf(part) === index)
      .join(': ');
    return description
      ? `OpenCascade error (${description})`
      : 'OpenCascade operation failed.';
  } catch {
    return 'OpenCascade operation failed.';
  }
}
