/** A trimmed rectangle with a semicircular cap and a concentric hole. */
export const trimmedArcSketchArguments = (
  radius = 7.5,
  top = 10,
  fixed?: number,
): string => `[
  ['point', 2, [-20, -10]], ['point', 3, [20, -10]],
  ['point', 4, [20, ${top}]], ['point', 5, [-20, ${top}]],
  ['line', 6, [2, 3]], ['line', 7, [3, 4]], ['line', 9, [5, 2]],
  ['point', 10, [0, ${top}]],
  ['arc', 11, [10, ${radius}, 13, 15, 'cw']],
  ['line', 12, [4, 15]],
  ['point', 13, [-${radius}, ${top}]],
  ['line', 14, [13, 5]],
  ['point', 15, [${radius}, ${top}]],
  ['circle', 16, [10, 2.5]],
], {constraints: [
  ['horizontal', 6], ['vertical', 7], ['horizontal', 12],
  ['vertical', 9], ['horizontal', 14],
  ${fixed === undefined ? '' : `['fixed', ${fixed}],`}
]}`;
