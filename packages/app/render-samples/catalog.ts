import type {ImageView} from '../src/rendering/image-camera';
import type {SourceToken} from './source-focus';

export const renderSamples = [
  {
    id: 'layout-ventilation',
    title: 'Ventilation in a construction space',
    description:
      'Fill a related construction space with fins that follow its placement, without including the space in the result.',
    category: 'Practical models',
    file: 'layout/ventilation.ts',
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
    file: 'layout/fill-grid.ts',
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
    file: 'layout/grille.ts',
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
    file: 'layout/radial.ts',
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
  {file: 'iso-screws.ts'},
  {file: 'gb-screws.ts'},
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
  {
    file: 'operations/group.ts',
  },
  {file: 'operations/distance.ts'},
  {
    file: 'materials.ts',
  },
  {
    file: 'text.ts',
  },
  {
    file: 'operations/rotate.ts',
  },
  {file: 'operations/revolve.ts'},
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
  {file: 'layout/linear.ts'},
  {file: 'layout/grille.ts'},
  {file: 'layout/ventilation.ts'},
  {file: 'layout/grid.ts'},
  {file: 'layout/radial.ts'},
  {file: 'layout/flex.ts'},
  {file: 'layout/flex-space.ts'},
  {file: 'layout/flex-wrap.ts'},
  {file: 'layout/fill-grid.ts'},

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
  '/examples/patterns/post-array/model.ts': '/examples/layout/linear.ts',

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
  '/examples/material-presets.ts': '/examples/assemblies/screw-box/model.ts',
  '/examples/geometric-alignment.ts':
    '/examples/projects/desktop-controller/model.ts',
  '/examples/exposed-topology.ts':
    '/examples/projects/desktop-controller/enclosure.ts',
  '/examples/primitives.ts': '/examples/primitives/primitives.ts',
  '/examples/group-origins.ts': '/examples/operations/group.ts',
  '/examples/origin-and-rotation.ts': '/examples/operations/rotate.ts',
};
