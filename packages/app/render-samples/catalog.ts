import type {ImageView} from '../src/rendering/image-camera';
import type {ModelRenderMode} from '../src/rendering/model-renderer';
import type {SourceToken} from './source-focus';

export const renderSamples = [
  {
    id: 'material-presets',
    title: 'Material presets under the same light',
    description:
      'Compare ten equal-size spheres in a grid: plastic, rubber, four metals, glass, acrylic, ceramic and paint.',
    category: 'Materials',
    file: 'packages/materials.ts',
    focus: {context: 'export default palette;', token: 'palette'},
    mode: 'render',
    view: {direction: [0, 2, 1], up: [0, 1, 0]},
    tags: ['materials', 'presets', 'grid', 'render'],
  },
  {
    id: 'layout-linear',
    title: 'Linear layout',
    description:
      'Five identical posts at a fixed 16 mm pitch, with no supporting geometry.',
    category: 'Layouts',
    file: 'packages/layout/linear.ts',
    focus: {
      context: "export default group(posts, 'Linear posts')",
      token: 'group',
    },
    view: {direction: [0.4, 0.7, 1.5], up: [0, 1, 0]},
    tags: ['layout', 'linear', 'repeat'],
  },
  {
    id: 'layout-grid',
    title: 'Grid layout',
    description:
      'Twelve equal-size pins in four columns with 8 mm gaps, without a base or construction space.',
    category: 'Layouts',
    file: 'packages/layout/grid.ts',
    focus: {
      context: "export default group(pins, 'Grid of pins')",
      token: 'group',
    },
    view: {direction: [0.5, 1.5, 1.2], up: [0, 1, 0]},
    tags: ['layout', 'grid', 'repeat'],
  },
  {
    id: 'screws',
    title: 'Screw head shapes and drives',
    description:
      'Compare ten nominal screw models shared by the ISO and GB/T modules, including socket cap, countersunk, button, hexagon, set and shoulder screws.',
    category: 'Practical models',
    file: 'packages/screws.ts',
    focus: {context: ").material('#aaa')", token: 'material'},
    view: {direction: [0.3, 1.6, 1.8], up: [0, 1, 0]},
    tags: ['screws', 'ISO', 'GB/T', 'threads', 'drives'],
  },
  {
    id: 'gears',
    title: 'Gears and mounting options',
    description:
      'Build five complete nominal gear parts with the Gears API: a plain bore, keyed hub, integral shaft, helical hub, and bolted internal ring.',
    category: 'Practical models',
    file: 'packages/gears/parts.ts',
    focus: {context: 'export default group(', token: 'group'},
    view: {direction: [0.7, 1.7, 1.2], up: [0, 1, 0]},
    tags: ['gears', 'bore', 'hub', 'shaft', 'helical', 'internal'],
  },
  {
    id: 'gear-assembly',
    title: 'Assemble a three-gear train',
    description:
      'Mesh three spur gears around a 120° center angle, then constrain the assembled group to a mounting plate.',
    category: 'Practical models',
    file: 'packages/gears/assembly.ts',
    focus: {
      context:
        "export default group([mountingPlate, train], 'Mounted gear train')",
      token: 'group',
    },
    view: {direction: [0.5, 1.8, 1.2], up: [0, 1, 0]},
    tags: ['gears', 'assembly', 'center distance', 'phase'],
  },
  {
    id: 'layout-ventilation',
    title: 'Ventilation in a construction space',
    description:
      'Fill a related construction space with fins that follow its placement, without including the space in the result.',
    category: 'Practical models',
    file: 'packages/layout/ventilation.ts',
    focus: {context: 'export default group(', token: 'group'},
    view: {direction: [0.5, 1, 1.3], up: [0, 1, 0]},
    tags: ['layout', 'fill', 'relate', 'frame'],
  },
  {
    id: 'layout-fill-grid',
    title: 'Fill a grid within bounds',
    description:
      'Calculate a complete grid of tiles from the available width, depth and minimum gaps.',
    category: 'Practical models',
    file: 'packages/layout/fill-grid.ts',
    focus: {context: 'export default group(', token: 'group'},
    view: {direction: [0.5, 1, 1.3], up: [0, 1, 0]},
    tags: ['layout', 'grid', 'fill', 'bounds'],
  },
  {
    id: 'layout-grille',
    title: 'Grilles within bounds',
    description:
      'Distribute six slats across a target width, or pack a fixed gap and align the row to the right.',
    category: 'Practical models',
    file: 'packages/layout/grille.ts',
    focus: {context: 'export default group(', token: 'group'},
    view: {direction: [0.5, 1, 1.3], up: [0, 1, 0]},
    tags: ['layout', 'bounds', 'gap', 'justifyContent'],
  },
  {
    id: 'layout-radial',
    title: 'Radial layout',
    description:
      'Repeat fins around a circle and rotate each by its sample angle. Layout also supports flex, grid and automatic filling.',
    category: 'Practical models',
    file: 'packages/layout/radial.ts',
    focus: {context: 'const fins = radial(', token: 'radial'},
    tags: ['layout', 'radial', 'arrays'],
  },
  {
    id: 'desktop-controller',
    title: 'A complete desktop controller',
    description:
      'An enclosure, labeled panel, shared knob and keycap, board placeholder, posts and screws. A modeling study, not a manufacturing-validated design.',
    category: 'Complete projects',
    file: 'projects/desktop-controller/model.ts',
    focus: {
      context: 'export default group(',
      token: 'group',
    },
    tags: ['modules', 'reuse', 'text', 'materials', 'assembly'],
  },
  {
    id: 'desktop-stand',
    view: {
      direction: [1, 0.65, 1],
      up: [0, 1, 0],
    },
    title: 'A one-piece phone stand',
    description:
      'An extruded side profile with a retaining lip and charging opening. Change its width and lean.',
    category: 'Practical models',
    file: 'projects/phone-stand.ts',
    focus: {
      context: 'export default phoneStand();',
      token: 'phoneStand',
    },
    tags: ['profile', 'extrude', 'cut', 'parameters'],
  },
  {
    id: 'mounting-plate',
    view: {
      direction: [1, 2, 1],
      up: [0, 1, 0],
    },
    title: 'A sketch on a part',
    description:
      'Edit a rounded slot in the local plane of a rotated mounting plate.',
    category: 'Practical models',
    file: 'sketches/mounting-plate.ts',
    focus: {
      context: 'export default mountingPlate;',
      token: 'mountingPlate',
    },
    tags: ['inspect', 'edit', 'reuse'],
  },
  {
    id: 'text',
    title: 'Text as geometry',
    description:
      'Google Fonts outlines become solid lettering, raised text and engraving.',
    category: 'Practical models',
    file: 'text.ts',
    focus: {
      context: ".material('#529dcb')",
      token: 'material',
    },
    tags: ['googleFont', 'text', 'extrude', 'cut'],
  },
  {
    id: 'annotations',
    title: 'Parameters and presets',
    description:
      'Annotations give a spacer editable dimensions, limits, defaults and named argument presets.',
    category: 'Practical models',
    file: 'annotations.ts',
    focus: {
      context: 'export default spacer(12, 5, 6);',
      token: 'spacer',
    },
    tags: ['inspect', 'edit', 'reuse'],
  },
  {
    id: 'length',
    title: 'Read edge length',
    description:
      'Inspect straight lengths, arc lengths and closed-edge circumferences as read-only properties.',
    category: 'Practical models',
    file: 'operations/length.ts',
    focus: {context: 'const arcLength = curved.length;', token: 'length'},
    tags: ['length', 'measurement', 'inspect'],
  },
  {
    id: 'area',
    title: 'Read surface area',
    description:
      'Measure finite faces and the total boundary surface area of solids.',
    category: 'Practical models',
    file: 'operations/area.ts',
    focus: {context: 'const pipeSurfaceArea = pipe.area;', token: 'area'},
    tags: ['area', 'measurement', 'inspect'],
  },
  {
    id: 'volume',
    title: 'Read solid volume',
    description:
      'Measure the volume occupied by solid material, excluding holes and cavities.',
    category: 'Practical models',
    file: 'operations/volume.ts',
    focus: {context: 'const pipeVolume = pipe.volume;', token: 'volume'},
    tags: ['volume', 'measurement', 'inspect'],
  },
  {
    id: 'distance',
    title: 'Fit a beam to a measured opening',
    description:
      'Measure an assembly gap and use it as a normal model dimension, with an optional projection axis.',
    category: 'Practical models',
    file: 'operations/distance.ts',
    focus: {
      context: "const length = distance(left.right, right.left, 'x');",
      token: 'distance',
    },
    tags: ['distance', 'parameters', 'assembly'],
  },
  {
    id: 'intersect',
    title: 'Intersect',
    description: 'Keep the common volume of a box and an offset sphere.',
    category: 'Practical models',
    file: 'operations/intersect.ts',
    focus: {
      context: 'export default intersect([blank, ball]);',
      token: 'intersect',
    },
    tags: ['inspect', 'edit', 'reuse'],
  },
  {
    id: 'primitives',
    title: 'Basic shapes at a glance',
    description:
      'Compare every built-in solid, planar face, point and curve by its name and basic shape.',
    category: 'The essentials',
    file: 'primitives/primitives.ts',
    focus: {
      context: 'export const cuboid = box(12, 10, 8)',
      token: 'box',
    },
    tags: ['solids', 'faces', 'curves', 'points'],
  },
  {
    id: 'screw-box',
    title: 'Screw box',
    description:
      'A box with tapping pilots, a counterbored lid and four socket cap screws. Open or close the lid with one parameter.',
    category: 'An assembly',
    file: 'assemblies/screw-box/model.ts',
    focus: {
      context: 'export default screwBox(14);',
      token: 'screwBox',
    },
    tags: ['cut', 'fillet', 'ISO4762', 'relate'],
  },
  {
    id: 'expose',
    title: 'A model with an API',
    description:
      'A pin function returns named mounting references; its cap uses the exposed axis and end face.',
    category: 'Reusable design',
    file: 'expose.ts',
    focus: {
      context: 'group([plate, pin, cap])',
      token: 'group',
    },
    tags: ['expose', 'cylinder', 'relate', 'group'],
  },
  {
    id: 'custom-primitives',
    title: 'Geometry of your own',
    description:
      'Twisted knobs with D-shaped shaft bores, built with Replicad and adjustable through their own parameter tools.',
    category: 'Custom primitives',
    file: 'primitives/custom-primitives.ts',
    focus: {
      context: 'group(',
      token: 'group',
    },
    tags: ['definePrimitive', 'replicad', '@code3d.param', 'originOffset'],
  },
  {
    id: 'shell',
    title: 'Make room inside',
    description:
      'Hollow a box with uniform walls, then pick the faces to leave open.',
    category: 'Shells and openings',
    file: 'operations/shell.ts',
    focus: {
      context: "enclosure.material('#d8ff3e')",
      token: 'material',
    },
    tags: ['box', 'shell', 'surface selection'],
  },
  {
    id: 'loft',
    title: 'Bend through three profiles',
    description:
      'Position a circle, an octagon, and a rectangle with bound contacts and pivot rotations, then loft through them.',
    category: 'Placement and rotation',
    file: 'operations/loft.ts',
    focus: {
      context: "loft([start, via, end]).material('#d8ff3e')",
      token: 'material',
    },
    tags: ['relate', 'on', 'pivot', 'rotate', 'loft'],
  },
  {
    id: 'rotate',
    title: 'Rotate',
    description:
      'Rotate a box around its local origin, with angles in degrees.',
    category: 'Local coordinates',
    file: 'operations/rotate.ts',
    focus: {
      context: 'blank.rotate(15, 35, 0)',
      token: 'rotate',
    },
    tags: ['rotate', 'angles'],
  },
  {
    id: 'relate',
    title: 'Relate parts',
    description:
      'Place a part on a base, offset the result and rotate around a pivot.',
    category: 'Constraints',
    file: 'constraints/relate.ts',
    focus: {
      context: '.rotate(0, 0, 25)',
      token: 'rotate',
    },
    tags: ['relate', 'on', 'offset', 'pivot', 'inspect'],
  },
  {
    id: 'topology-paths',
    title: 'Follow a face to its source',
    description:
      'Inspect the cap and side surface IDs of a tapered loft; cap paths retain their source profiles.',
    category: 'Topology and reuse',
    file: 'topology-paths.ts',
    focus: {
      context: 'export default body',
      token: 'body',
    },
    tags: ['loft', 'surface', 'edges', 'paths'],
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  category: string;
  file: string;
  focus: SourceToken;
  tags: readonly string[];
  view?: ImageView;
  mode?: ModelRenderMode;
}[];

export type SourceContext = Readonly<{
  id: string;
  image: string;
  label: string;
  description: string;
  focus: SourceToken;
}>;
export const sourceContextSets: Readonly<
  Record<string, readonly SourceContext[]>
> = {
  gears: [
    {
      id: 'bore',
      image: 'gears-bore',
      label: 'Straight teeth and a bore',
      description: 'A straight-tooth wheel with a simple through bore.',
      focus: {
        context: ".material('#91aeca')",
        token: 'material',
      },
    },
    {
      id: 'keyed-hub',
      image: 'gears-keyed-hub',
      label: 'Keyed hub',
      description: 'A projecting hub and a shaft keyway surround the bore.',
      focus: {
        context: ".material('#d3b46c')",
        token: 'material',
      },
    },
    {
      id: 'shaft',
      image: 'gears-shaft',
      label: 'Integral shaft',
      description: 'The pinion and its shaft form one solid part.',
      focus: {
        context: ".material('#d49a85')",
        token: 'material',
      },
    },
    {
      id: 'helical',
      image: 'gears-helical',
      label: 'Helical teeth and a hub',
      description: 'Twisted tooth traces, a hub, and a through bore.',
      focus: {
        context: ".material('#83bba6')",
        token: 'material',
      },
    },
    {
      id: 'internal',
      image: 'gears-internal',
      label: 'Internal ring',
      description: 'Inward-facing teeth in a ring with six mounting holes.',
      focus: {
        context: ".material('#b9a9cc')",
        token: 'material',
      },
    },
  ],
  'gear-assembly': [
    {
      id: 'wheel',
      image: 'gear-assembly-wheel',
      label: 'Focus the middle gear',
      description:
        'Inspect the wheel in its solved mesh while the pinion and idler stay visible as context.',
      focus: {context: '[pinion, wheel, idler]', token: 'wheel'},
    },
    {
      id: 'mounted',
      image: 'gear-assembly',
      label: 'Mount the gear group',
      description:
        'Constrain the complete 120° train to the upper face of a mounting plate.',
      focus: {
        context:
          "export default group([mountingPlate, train], 'Mounted gear train')",
        token: 'group',
      },
    },
  ],
  'desktop-stand': [
    {
      id: 'body',
      image: 'desktop-stand-body',
      label: 'Build the body',
      description: 'Extrude the side outline and turn the body upright.',
      focus: {
        context: '.rotate(90, 90, 0)',
        token: 'rotate',
      },
    },
    {
      id: 'opening',
      image: 'desktop-stand-opening',
      label: 'Leave cable clearance',
      description: 'One cut opens the retaining lip for a charging cable.',
      focus: {
        context: 'body.cut([cableOpening])',
        token: 'cableOpening',
      },
    },
    {
      id: 'model',
      image: 'desktop-stand',
      label: 'See the stand',
      description: 'The finished one-piece model.',
      focus: {
        context: ".material('#8ed5d1')",
        token: 'material',
      },
    },
  ],
  relate: [
    {
      id: 'contact',
      image: 'relate-contact',
      label: 'Contact',
      description:
        'At on, the part touches the base. Its complete source box is highlighted; the later offset and rotation have not happened yet.',
      focus: {
        context: '.on(base.up), // Touch the base.',
        token: 'on',
      },
    },
    {
      id: 'target',
      image: 'relate-target',
      label: 'Target',
      description:
        'Inside on, base.up becomes the bright reference while the part remains visible.',
      focus: {
        context: '.on(base.up), // Touch the base.',
        token: 'base.up',
      },
    },
    {
      id: 'offset',
      image: 'relate-offset',
      label: 'Offset',
      description:
        'At offset, the part is the target in this transformation stage, with the other participants in the background. The later rotation is outside this preview.',
      focus: {
        context: 'offset(6, 0, 0)',
        token: 'offset',
      },
    },
    {
      id: 'rotation',
      image: 'relate',
      label: 'Rotation',
      description:
        'At rotate, the part turns about its chosen pivot. The model, pivot, and controls share this stage’s pose.',
      focus: {
        context: '.rotate(0, 0, 25)',
        token: 'rotate',
      },
    },
  ],
};

// Every runnable source, including reusable project parts, is checked by the example tests.
export const exampleEntries = [
  {file: 'packages/gears/parts.ts'},
  {file: 'packages/gears/assembly.ts'},
  {file: 'packages/screws.ts'},
  {
    file: 'projects/desktop-controller/enclosure.ts',
  },
  {
    file: 'projects/desktop-controller/panel.ts',
  },
  {
    file: 'projects/desktop-controller/model.ts',
  },
  {
    file: 'projects/phone-stand.ts',
  },
  {
    file: 'assemblies/screw-box/model.ts',
  },
  {file: 'assemblies/screw-box/box.ts'},
  {file: 'assemblies/screw-box/lid.ts'},
  {
    file: 'operations/cut.ts',
  },
  {file: 'operations/union.ts'},
  {
    file: 'constraints/combined-constraints.ts',
  },
  {file: 'constraints/transformations.ts'},
  {file: 'constraints/animation.ts'},
  {
    file: 'operations/group.ts',
  },
  {file: 'operations/distance.ts'},
  {file: 'operations/length.ts'},
  {file: 'operations/area.ts'},
  {file: 'operations/volume.ts'},
  {
    file: 'materials.ts',
  },
  {file: 'packages/materials.ts'},
  {
    file: 'text.ts',
  },
  {
    file: 'operations/rotate.ts',
  },
  {file: 'operations/revolve.ts'},
  {file: 'operations/sweep.ts'},
  {file: 'operations/origin.ts'},
  {
    file: 'primitives/primitives.ts',
  },
  {
    file: 'constraints/relate.ts',
  },
  {
    file: 'topology-paths.ts',
  },
  {
    file: 'operations/loft.ts',
  },
  {
    file: 'operations/intersect.ts',
  },
  {
    file: 'operations/shell.ts',
  },
  {
    file: 'annotations.ts',
  },
  {
    file: 'expose.ts',
  },
  {
    file: 'primitives/custom-primitives.ts',
  },
  {
    file: 'npm/model.ts',
  },
  {file: 'packages/layout/linear.ts'},
  {file: 'packages/layout/grille.ts'},
  {file: 'packages/layout/ventilation.ts'},
  {file: 'packages/layout/grid.ts'},
  {file: 'packages/layout/radial.ts'},
  {file: 'packages/layout/flex.ts'},
  {file: 'packages/layout/flex-space.ts'},
  {file: 'packages/layout/flex-wrap.ts'},
  {file: 'packages/layout/fill-grid.ts'},

  {
    file: 'sketches/constraints.ts',
  },
  {
    file: 'sketches/mounting-plate.ts',
  },
  {
    file: 'sketches/regions.ts',
  },
] as const;

// Existing user files take precedence over relocated public example links.
export const movedExamplePaths: Readonly<Record<string, string>> = {
  '/examples/packages/gears.ts': '/examples/packages/gears/parts.ts',
  '/examples/packages/gear-assembly.ts': '/examples/packages/gears/assembly.ts',
  '/examples/packages/material-presets.ts': '/examples/packages/materials.ts',
  '/examples/materials/materials.ts': '/examples/materials.ts',
  '/examples/text/text.ts': '/examples/text.ts',
  '/examples/expose/expose.ts': '/examples/expose.ts',
  '/examples/topology-paths/topology-paths.ts': '/examples/topology-paths.ts',
  '/examples/components/knob.ts': '/examples/annotations.ts',
  '/examples/constraints/relation-preview.ts':
    '/examples/constraints/relate.ts',
  '/examples/operations/group-origins.ts': '/examples/operations/group.ts',
  '/examples/operations/origin-and-rotation.ts':
    '/examples/operations/rotate.ts',
  '/examples/operations/boolean-operations.ts': '/examples/operations/cut.ts',
  '/examples/assemblies/fastener-joint/lid.ts':
    '/examples/assemblies/screw-box/lid.ts',
  '/examples/assemblies/fastener-joint/box.ts':
    '/examples/assemblies/screw-box/box.ts',
  '/examples/assemblies/fastener-joint/model.ts':
    '/examples/assemblies/screw-box/model.ts',
  '/examples/patterns/post-array/model.ts':
    '/examples/packages/layout/linear.ts',

  '/examples/basics/boolean-operations.ts': '/examples/operations/cut.ts',
  '/examples/basics/group-origins.ts': '/examples/operations/group.ts',
  '/examples/basics/origin-and-rotation.ts': '/examples/operations/rotate.ts',
  '/examples/basics/loft.ts': '/examples/operations/loft.ts',
  '/examples/basics/intersect.ts': '/examples/operations/intersect.ts',
  '/examples/basics/shell.ts': '/examples/operations/shell.ts',
  '/examples/basics/combined-constraints.ts':
    '/examples/constraints/combined-constraints.ts',
  '/examples/basics/relation-preview.ts': '/examples/constraints/relate.ts',
  '/examples/basics/primitives.ts': '/examples/primitives/primitives.ts',
  '/examples/basics/custom-primitives.ts':
    '/examples/primitives/custom-primitives.ts',
  '/examples/basics/text.ts': '/examples/text.ts',
  '/examples/basics/expose.ts': '/examples/expose.ts',
  '/examples/basics/materials.ts': '/examples/materials.ts',
  '/examples/basics/topology-paths.ts': '/examples/topology-paths.ts',

  '/examples/assemblies/desktop-stand.ts': '/examples/projects/phone-stand.ts',
  '/examples/basics/nameplate.ts': '/examples/text.ts',
  '/examples/basics/first-model.ts': '/examples/primitives/primitives.ts',
  '/examples/website/first-model.ts': '/examples/primitives/primitives.ts',
  '/examples/website/fastener.ts': '/examples/assemblies/screw-box/model.ts',
  '/examples/website/locating-pin.ts': '/examples/expose.ts',
  '/examples/website/relation-preview.ts': '/examples/constraints/relate.ts',
  '/examples/custom-primitives.ts': '/examples/primitives/custom-primitives.ts',
  '/examples/design-arguments.ts': '/examples/annotations.ts',
  '/examples/bound-rotation.ts': '/examples/operations/loft.ts',
  '/examples/sketch-on-surface.ts': '/examples/sketches/mounting-plate.ts',
  '/examples/sketch-modeling.ts': '/examples/sketches/regions.ts',
  '/examples/sketches.ts': '/examples/sketches/constraints.ts',
  '/examples/fasteners.ts': '/examples/assemblies/screw-box/model.ts',
  '/examples/shell.ts': '/examples/operations/shell.ts',
  '/examples/boolean-operations.ts': '/examples/operations/cut.ts',
  '/examples/combined-constraints.ts':
    '/examples/constraints/combined-constraints.ts',
  '/examples/relations-and-elements.ts': '/examples/expose.ts',
  '/examples/geometric-alignment.ts':
    '/examples/projects/desktop-controller/model.ts',
  '/examples/exposed-topology.ts':
    '/examples/projects/desktop-controller/enclosure.ts',
  '/examples/primitives.ts': '/examples/primitives/primitives.ts',
  '/examples/group-origins.ts': '/examples/operations/group.ts',
  '/examples/origin-and-rotation.ts': '/examples/operations/rotate.ts',
};
