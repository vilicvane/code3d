import {
  BlueprintSketcher,
  getOC,
  type Blueprint,
  type Face,
  type Wire,
  type Point2D,
} from 'replicad';
import {castOwnedShape} from './kernel-shapes.js';
import type {PathCommand} from 'opentype.js';
import {fontArtifact, type Font} from './font.js';
import {evaluateKernelOperation, type KernelArtifact} from './kernel-cache.js';
import {estimateRetainedBytes} from './retained-memory.js';

export type TextOptions = Readonly<{font: Font}>;
type Contour = readonly PathCommand[];
type Region = readonly Contour[];
type Glyph = Readonly<{
  regions: KernelArtifact<readonly Region[]>;
  x: number;
  y: number;
}>;

/** Layout shares a baseline at (0, 0, 0); spaces advance without creating faces. */
export function textGlyphs(
  content: string,
  size: number,
  options: TextOptions,
): readonly Glyph[] {
  if (!Number.isFinite(size) || size <= 0)
    throw new Error('Text size must be finite and greater than zero.');
  if (typeof content !== 'string')
    throw new Error('Text content must be a string.');
  if (/[\r\n\t]/u.test(content))
    throw new Error(
      'text() supports one line; position separate text() calls for multiple lines.',
    );
  const resource = fontArtifact(options?.font);
  const font = resource.value;
  for (const character of content) {
    if (!font.charToGlyphIndex(character)) {
      throw new Error(
        `Font ${font.names.fontFamily?.en ?? ''} has no glyph for ${JSON.stringify(character)} (U+${character.codePointAt(0)!.toString(16).toUpperCase()}).`,
      );
    }
  }
  const glyphs: Glyph[] = [];
  font.forEachGlyph(content, 0, 0, size, undefined, (glyph, x, y) => {
    const regions = evaluateKernelOperation<readonly Region[]>(
      'textGlyph',
      [glyph.index, size],
      [resource],
      {
        estimateBytes: estimateRetainedBytes,
        retain: value => value,
        instantiate: value => value,
        release() {},
      },
      () =>
        groupTextContours(splitContours(glyph.getPath(0, 0, size).commands)),
    );
    glyphs.push({regions, x, y});
  });
  return glyphs;
}

function splitContours(commands: readonly PathCommand[]): readonly Contour[] {
  const contours: PathCommand[][] = [];
  let contour: PathCommand[] | undefined;
  for (const command of commands) {
    if (command.type === 'M') {
      contour = [];
      contours.push(contour);
    }
    if (!contour)
      throw new Error('A font contour must start with a move command.');
    contour.push(command);
    if (command.type === 'Z') contour = undefined;
  }
  if (contour) throw new Error('A font contour must be closed.');
  return contours.filter(contour => contour.length > 2);
}

function blueprint(contour: Contour, x = 0, y = 0): Blueprint {
  const start = contour[0];
  if (start?.type !== 'M')
    throw new Error('A font contour must start with a move command.');
  const sketcher = new BlueprintSketcher([start.x + x, -start.y - y]);
  try {
    let previous = start;
    for (const command of contour.slice(1)) {
      if (command.type === 'Z') return sketcher.close();
      if (command.type === 'M')
        throw new Error('Unexpected move inside a font contour.');
      const end: [number, number] = [command.x + x, -command.y - y];
      if (command.type === 'L') {
        if (command.x !== previous.x || command.y !== previous.y)
          sketcher.lineTo(end);
      } else if (command.type === 'Q') {
        sketcher.quadraticBezierCurveTo(end, [command.x1 + x, -command.y1 - y]);
      } else {
        sketcher.cubicBezierCurveTo(
          end,
          [command.x1 + x, -command.y1 - y],
          [command.x2 + x, -command.y2 - y],
        );
      }
      previous = {type: 'M', x: command.x, y: command.y};
    }
    throw new Error('A font contour must be closed.');
  } catch (error) {
    deleteBlueprint(sketcher.done());
    throw error;
  }
}

/**
 * Work around Replicad #278 without relying on contour order. Every boundary
 * belongs to its nearest containing boundary; even depths are filled islands.
 * Crossing/touching outlines are rejected instead of silently filling holes.
 */
export function groupTextContours(
  contours: readonly Contour[],
): readonly Region[] {
  const blueprints: Blueprint[] = [];
  try {
    for (const contour of contours) blueprints.push(blueprint(contour));
    const contains = blueprints.map(() => new Set<number>());
    for (let i = 0; i < blueprints.length; i++) {
      for (let j = i + 1; j < blueprints.length; j++) {
        const a = blueprints[i],
          b = blueprints[j];
        if (contoursIntersect(a, b))
          throw new Error(
            'The font has crossing or touching contours within a glyph.',
          );
        if (containsPoint(a, b.firstPoint)) contains[j].add(i);
        if (containsPoint(b, a.firstPoint)) contains[i].add(j);
      }
    }
    const parents = contains.map(
      containers =>
        [...containers].sort((a, b) => contains[b].size - contains[a].size)[0],
    );
    return contours.flatMap((outer, index) =>
      contains[index].size % 2
        ? []
        : [[outer, ...contours.filter((_, hole) => parents[hole] === index)]],
    );
  } finally {
    blueprints.forEach(deleteBlueprint);
  }
}

/** Blueprint.delete() does not release cached per-curve bounds. */
function deleteBlueprint(value: Blueprint): void {
  for (const curve of value.curves) {
    curve._boundingBox?.delete();
    curve._boundingBox = null;
  }
  value.delete();
}

function contoursIntersect(a: Blueprint, b: Blueprint): boolean {
  if (a.boundingBox.isOut(b.boundingBox)) return false;
  const intersector = new (getOC().Geom2dAPI_InterCurveCurve)();
  try {
    for (const first of a.curves)
      for (const second of b.curves) {
        if (first.boundingBox.isOut(second.boundingBox)) continue;
        intersector.Init(first.wrapped, second.wrapped, 1e-9);
        if (intersector.NbPoints() || intersector.NbSegments()) return true;
      }
    return false;
  } finally {
    intersector.delete();
  }
}

function containsPoint(contour: Blueprint, point: Point2D): boolean {
  const [min, max] = contour.boundingBox.bounds;
  if (
    point[0] < min[0] ||
    point[0] > max[0] ||
    point[1] < min[1] ||
    point[1] > max[1]
  )
    return false;
  const span = Math.max(max[0] - min[0], max[1] - min[1]);
  const intersector = new (getOC().Geom2dAPI_InterCurveCurve)();
  try {
    // A ray through a vertex or tangent cannot be counted by intersection parity.
    // Retry a different direction in those cases, retaining exact native curves.
    for (let attempt = 0; attempt < 16; attempt++) {
      const end: Point2D = [
        max[0] + span,
        point[1] + span * Math.sin(attempt * 2.399963229728653),
      ];
      const ray = new BlueprintSketcher(point).lineTo(end).done();
      try {
        let crossings = 0,
          ambiguous = false;
        for (const curve of contour.curves) {
          intersector.Init(ray.curves[0].wrapped, curve.wrapped, 1e-9);
          if (intersector.NbSegments()) {
            ambiguous = true;
            break;
          }
          const endpoints = [curve.firstPoint, curve.lastPoint];
          for (let index = 1; index <= intersector.NbPoints(); index++) {
            const hit = intersector.Point(index);
            try {
              if (
                endpoints.some(
                  p => Math.hypot(p[0] - hit.X(), p[1] - hit.Y()) < 1e-8,
                )
              )
                ambiguous = true;
            } finally {
              hit.delete();
            }
          }
          if (ambiguous) break;
          crossings += intersector.NbPoints();
        }
        if (!ambiguous) return crossings % 2 === 1;
      } finally {
        deleteBlueprint(ray);
      }
    }
    throw new Error('Could not determine containment of the font contours.');
  } finally {
    intersector.delete();
  }
}

/** Own every native handle; Replicad's sketchOnPlane leaves edge builders alive. */
export function textRegionFace(region: Region, x: number, y: number): Face {
  const oc = getOC();
  const blueprints: Blueprint[] = [];
  const wires: Wire[] = [];
  const origin = new oc.gp_Pnt(0, 0, 0);
  const normal = new oc.gp_Dir(0, 1, 0);
  const xDirection = new oc.gp_Dir(1, 0, 0);
  const axis = new oc.gp_Ax2(origin, normal, xDirection);
  const plane = new oc.gp_Pln(origin, normal);
  try {
    for (const contour of region) {
      const profile = blueprint(contour, x, y);
      blueprints.push(profile);
      const wireBuilder = new oc.BRepBuilderAPI_MakeWire();
      try {
        for (const curve of profile.curves) {
          const nativeCurve = oc.GeomLib.To3d(axis, curve.wrapped);
          try {
            const edgeBuilder = new oc.BRepBuilderAPI_MakeEdge(nativeCurve);
            try {
              const edge = edgeBuilder.Edge();
              try {
                wireBuilder.Add(edge);
              } finally {
                edge.delete();
              }
            } finally {
              edgeBuilder.delete();
            }
          } finally {
            nativeCurve.delete();
          }
        }
        if (!wireBuilder.IsDone())
          throw new Error('Could not connect the font contour into a wire.');
        wires.push(castOwnedShape(wireBuilder.Wire()) as Wire);
      } finally {
        wireBuilder.delete();
      }
    }
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace(
      plane,
      wires[0].wrapped,
      true,
    );
    try {
      for (const hole of wires.slice(1)) faceBuilder.Add(hole.wrapped);
      if (!faceBuilder.IsDone())
        throw new Error('Could not create a text face.');
      const raw = faceBuilder.Face();
      try {
        const fixer = new oc.ShapeFix_Face(raw);
        try {
          fixer.FixOrientation();
          const face = castOwnedShape(fixer.Face()) as Face;
          try {
            const analyzer = new oc.BRepCheck_Analyzer(
              face.wrapped,
              true,
              false,
            );
            try {
              if (!analyzer.IsValid())
                throw new Error(
                  'The font contours do not form a valid planar face.',
                );
            } finally {
              analyzer.delete();
            }
            return face;
          } catch (error) {
            face.delete();
            throw error;
          }
        } finally {
          fixer.delete();
        }
      } finally {
        raw.delete();
      }
    } finally {
      faceBuilder.delete();
    }
  } finally {
    wires.forEach(wire => wire.delete());
    blueprints.forEach(deleteBlueprint);
    plane.delete();
    axis.delete();
    xDirection.delete();
    normal.delete();
    origin.delete();
  }
}
