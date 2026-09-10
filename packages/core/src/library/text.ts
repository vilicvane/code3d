import {
  BlueprintSketcher,
  getOC,
  type Blueprint,
  type Face,
  type Wire,
  type Point2D,
} from 'replicad';
import {castOwnedShape} from './kernel-shapes.js';
import type * as hb from 'harfbuzzjs';
import {boolean as combinePaths} from 'flo-boolean';
import {fontParts, shapeFontText, type Font, type FontPart} from './font.js';
import {cachedArtifact} from './cached.js';
import {kernelOperationKey, type KernelArtifact} from './kernel-cache.js';

export type TextOptions = Readonly<{
  /** Extra model-unit spacing between glyphs, including spaces. Defaults to 0; may be negative. */
  letterSpacing?: number;
  /** Apply the font's kerning pairs. Defaults to true. */
  kerning?: boolean;
}>;

export type PathCommand =
  | {type: 'M'; x: number; y: number}
  | {type: 'L'; x: number; y: number}
  | {type: 'Q'; x1: number; y1: number; x: number; y: number}
  | {
      type: 'C';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }
  | {type: 'Z'};
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
  font: Font,
  size: number,
  options: TextOptions = {},
): readonly Glyph[] {
  if (!Number.isFinite(size) || size <= 0)
    throw new Error('Text size must be finite and greater than zero.');
  if (typeof content !== 'string')
    throw new Error('Text content must be a string.');
  const letterSpacing = options.letterSpacing ?? 0;
  if (!Number.isFinite(letterSpacing))
    throw new Error('Text letter spacing must be finite.');
  if (/[\r\n\t]/u.test(content))
    throw new Error(
      'text() supports one line; position separate text() calls for multiple lines.',
    );
  const parts = fontParts(font);
  const runs: {part: FontPart; content: string}[] = [];
  for (const character of content) {
    const code = character.codePointAt(0)!;
    const part = parts.find(
      ({artifact, ranges}) =>
        (!ranges.length ||
          ranges.some(([start, end]) => code >= start && code <= end)) &&
        artifact.value.font.nominalGlyph(code),
    );
    if (!part) {
      throw new Error(
        `Font ${font.family} has no glyph for ${JSON.stringify(character)} (U+${code.toString(16).toUpperCase()}).`,
      );
    }
    const previous = runs.at(-1);
    if (previous?.part === part) previous.content += character;
    else runs.push({part, content: character});
  }
  const glyphs: Glyph[] = [];
  let advanceX = 0;
  let advanceY = 0;
  for (const {part, content: run} of runs) {
    const resource = part.artifact;
    const parsed = resource.value;
    const scale = size / parsed.face.upem;
    const {infos, positions} = shapeFontText(
      parsed.font,
      run,
      options.kerning ?? true,
    );
    infos.forEach((info, index) => {
      const position = positions[index];
      const regions = textGlyph(resource, info.codepoint, size);
      glyphs.push({
        regions,
        x: advanceX + position.xOffset * scale + glyphs.length * letterSpacing,
        y: -advanceY - position.yOffset * scale,
      });
      advanceX += position.xAdvance * scale;
      advanceY += position.yAdvance * scale;
    });
  }
  return glyphs;
}

const textGlyph = cachedArtifact(
  (
    resource: FontPart['artifact'],
    codepoint: number,
    size: number,
  ): readonly Region[] =>
    groupTextContours(
      splitContours(
        resource.value.font
          .glyphToJson(codepoint)
          .map(command =>
            scaledCommand(command, size / resource.value.face.upem),
          ),
      ),
    ),
  {
    key: (resource, codepoint, size) =>
      kernelOperationKey('textGlyph', [codepoint, size], [resource]),
  },
);

function scaledCommand(
  {type, values}: hb.SvgPathCommand,
  scale: number,
): PathCommand {
  const [x1, y1, x2, y2, x, y] = values.map(
    (value, index) => value * scale * (index % 2 ? -1 : 1),
  );
  switch (type) {
    case 'M':
    case 'L':
      return {type, x: x1, y: y1};
    case 'Q':
      return {type, x1, y1, x: x2, y: y2};
    case 'C':
      return {type, x1, y1, x2, y2, x, y};
    case 'Z':
      return {type};
    default:
      throw new Error(`Unsupported glyph path command: ${type}`);
  }
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
 * Overlapping outlines are first combined with the font non-zero fill rule.
 */
export function groupTextContours(
  contours: readonly Contour[],
): readonly Region[] {
  const blueprints: Blueprint[] = [];
  try {
    for (const contour of contours) blueprints.push(blueprint(contour));
    if (
      blueprints.some((a, i) =>
        blueprints.slice(i + 1).some(b => contoursIntersect(a, b)),
      )
    ) {
      blueprints.splice(0).forEach(deleteBlueprint);
      contours = combineContours(contours);
      for (const contour of contours) blueprints.push(blueprint(contour));
    }
    const contains = blueprints.map(() => new Set<number>());
    for (let i = 0; i < blueprints.length; i++) {
      for (let j = i + 1; j < blueprints.length; j++) {
        const a = blueprints[i],
          b = blueprints[j];
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

/** Keep quadratic/cubic Beziers; no polygon flattening or SVG rounding. */
function combineContours(contours: readonly Contour[]): readonly Contour[] {
  const paths = contours.map(contour => {
    const curves: number[][][] = [];
    let start: number[] = [];
    let previous: number[] = [];
    for (const command of contour) {
      if (command.type === 'M') {
        start = previous = [command.x, command.y];
        continue;
      }
      if (command.type === 'Z') {
        if (previous[0] !== start[0] || previous[1] !== start[1])
          curves.push([previous, start]);
        continue;
      }
      const end = [command.x, command.y];
      if (command.type === 'L') curves.push([previous, end]);
      else if (command.type === 'Q')
        curves.push([previous, [command.x1, command.y1], end]);
      else
        curves.push([
          previous,
          [command.x1, command.y1],
          [command.x2, command.y2],
          end,
        ]);
      previous = end;
    }
    return curves;
  });
  return combinePaths('OR', paths, {minLoopArea: 0})
    .filter(loop => loop.length)
    .map(loop => {
      const [x, y] = loop[0][0];
      const commands: PathCommand[] = [{type: 'M', x, y}];
      for (const curve of loop) {
        const [x, y] = curve.at(-1)!;
        if (curve.length === 2) commands.push({type: 'L', x, y});
        else if (curve.length === 3)
          commands.push({type: 'Q', x1: curve[1][0], y1: curve[1][1], x, y});
        else
          commands.push({
            type: 'C',
            x1: curve[1][0],
            y1: curve[1][1],
            x2: curve[2][0],
            y2: curve[2][1],
            x,
            y,
          });
      }
      commands.push({type: 'Z'});
      return commands;
    });
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
