import {group} from './group.js';
import {on} from './on.js';
import {align} from './align.js';
import {coupleRotation} from './couple-rotation.js';
import {offset} from './offset.js';
import {rotate} from './rotate.js';
import {pivot} from './pivot.js';
import {pivotVertex} from './pivot-vertex.js';
import {pivotPoint} from './pivot-point.js';
import {axisEdge} from './axis-edge.js';
import {axisLine} from './axis-line.js';
import {originCenter} from './origin-center.js';
import {union} from './union.js';
import {cut} from './cut.js';
import {intersect} from './intersect.js';
import {extrude} from './extrude.js';
import {revolve} from './revolve.js';
import {sweep} from './sweep.js';
import {loft} from './loft.js';
import {wrap} from './wrap.js';
import {thicken} from './thicken.js';
import {circle} from './circle.js';
import {ellipse} from './ellipse.js';
import {rectangle} from './rectangle.js';
import {regularPolygon} from './regular-polygon.js';
import {point} from './point.js';
import {line} from './line.js';
import {arc} from './arc.js';
import {bezier} from './bezier.js';
import {spline} from './spline.js';
import {cylinder} from './cylinder.js';
import {tube} from './tube.js';
import {coil} from './coil.js';
import {sphere} from './sphere.js';
import {ellipsoid} from './ellipsoid.js';
import {frustum} from './frustum.js';
import {regularPrism} from './regular-prism.js';
import {input} from './input.js';
import {timeOffset} from './time-offset.js';
import {
  dimension,
  boundsAnnotation,
  anchorAnnotation,
  captureInspectData,
} from './inspect.js';
import {cache} from './cached.js';
import {font} from './font.js';
import {googleFont} from './google-font.js';
import {sketch} from './sketch.js';
import {box} from './box.js';
import {text} from './text.js';
import {distance} from './distance.js';

export const authoringApi = Object.freeze({
  originCenter,
  input,
  timeOffset,
  dimension,
  boundsAnnotation,
  anchorAnnotation,
  captureInspectData,
  offset,
  rotate,
  pivot,
  pivotVertex,
  pivotPoint,
  axisEdge,
  axisLine,
  coupleRotation,
  on,
  align,
  cache,
  font,
  googleFont,
  text,
  sketch,
  circle,
  ellipse,
  extrude,
  rectangle,
  regularPolygon,
  point,
  line,
  arc,
  bezier,
  spline,
  loft,
  revolve,
  sweep,
  wrap,
  thicken,
  box,
  cylinder,
  tube,
  coil,
  sphere,
  ellipsoid,
  frustum,
  regularPrism,
  group,
  distance,
  union,
  cut,
  intersect,
});
