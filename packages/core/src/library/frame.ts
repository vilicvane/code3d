import {FrameObject, type Frame} from './runtime.js';

/** Create an independent coordinate frame without finite geometry. */
export function frame(name = 'Frame'): Frame {
  return new FrameObject(name);
}
