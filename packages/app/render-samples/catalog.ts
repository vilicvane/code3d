import type {SourceToken} from './source-focus';

export const renderSamples = [
  {
    id: 'first-model',
    title: 'A place to start',
    description:
      'A rounded base, a cylindrical post, and one relation that brings them together.',
    category: 'The essentials',
    file: 'website/first-model.ts',
    focus: {context: 'group([base, post])', token: 'group'},
    tags: ['box', 'cylinder', 'fillet', 'relate', 'group'],
  },
  {
    id: 'fastener',
    title: 'Parts that fit',
    description:
      'A socket cap screw and its matching counterbored plate, composed through named elements.',
    category: 'An assembly',
    file: 'website/fastener.ts',
    focus: {
      context: "group([plate, screw], 'M6 fastener demo')",
      token: 'group',
    },
    tags: ['cut', 'chamfer', 'ISO4762', 'relate'],
  },
  {
    id: 'locating-pin',
    title: 'A model with an API',
    description:
      'Give a reusable part named mounting bounds and an axis. Let the next model work with those names.',
    category: 'Reusable design',
    file: 'website/locating-pin.ts',
    focus: {context: 'group([plate, pin, cap])', token: 'group'},
    tags: ['expose', 'cylinder', 'relate', 'group'],
  },
  {
    id: 'custom-primitives',
    title: 'Geometry of your own',
    description:
      'Twisted knobs with D-shaped shaft bores, built with Replicad and adjustable through their own parameter tools.',
    category: 'Custom primitives',
    file: 'custom-primitives.ts',
    focus: {context: 'group(', token: 'group'},
    tags: ['definePrimitive', 'replicad', '@code3d.param', 'relate'],
  },
  {
    id: 'shell',
    title: 'Make room inside',
    description:
      'Hollow a box with uniform walls, then pick the faces to leave open.',
    category: 'Shells and openings',
    file: 'shell.ts',
    focus: {context: "enclosure.paint('#d8ff3e')", token: 'paint'},
    tags: ['box', 'shell', 'surface selection'],
  },
  {
    id: 'bound-rotation',
    title: 'Bend through three profiles',
    description:
      'Position a circle, an octagon, and a rectangle with bound contacts and pivot rotations, then loft through them.',
    category: 'Placement and rotation',
    file: 'bound-rotation.ts',
    focus: {
      context: "loft([start, via, end]).paint('#d8ff3e')",
      token: 'paint',
    },
    tags: ['relate', 'on', 'pivot', 'rotate', 'loft'],
  },
  {
    id: 'geometric-alignment',
    title: 'Let the geometry line up',
    description:
      'Align axes, supporting circles, points, and planes, then choose offsets and rotations explicitly.',
    category: 'Geometric relations',
    file: 'geometric-alignment.ts',
    focus: {context: 'export default group(', token: 'group'},
    tags: ['align', 'flip', 'offset', 'pivot', 'rotate'],
  },
  {
    id: 'relation-preview',
    title: 'Read a relation, one step at a time',
    description:
      'Move between contact, target, offset, and rotation to follow the current pose and its two reference elements.',
    category: 'Source and viewport',
    file: 'website/relation-preview.ts',
    focus: {context: '.rotate(0, 0, 25)', token: 'rotate'},
    tags: ['relate', 'on', 'offset', 'pivot', 'inspect'],
  },
  {
    id: 'topology-paths',
    title: 'Follow a face to its source',
    description:
      'A tapered loft with named inlet, outlet, and side surfaces. Its cap IDs record the source profiles.',
    category: 'Topology and reuse',
    file: 'topology-paths.ts',
    focus: {
      context: 'body.expose({inlet, outlet, side})',
      token: 'expose',
    },
    tags: ['loft', 'surface', 'edges', 'expose'],
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  category: string;
  file: string;
  focus: SourceToken;
  tags: readonly string[];
}[];

const firstModelContexts = [
  {
    id: 'base',
    image: 'first-model-base',
    label: 'Inspect the base',
    description: 'Focus on the rounded plate and its connection to the source.',
    focus: {context: 'group([base, post])', token: 'base'},
  },
  {
    id: 'post',
    image: 'first-model-post',
    label: 'Inspect the post',
    description:
      'Focus on the cylinder, with surrounding geometry for context.',
    focus: {context: 'group([base, post])', token: 'post'},
  },
  {
    id: 'model',
    image: 'first-model',
    label: 'See them together',
    description:
      'Select the group to see both parts with their relation resolved.',
    focus: {context: 'group([base, post])', token: 'group'},
  },
] as const;

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
  'first-model': firstModelContexts,
  'relation-preview': [
    {
      id: 'contact',
      image: 'relation-preview-contact',
      label: 'Contact',
      description:
        'At on, the part touches the base. Its complete source box is highlighted; the later offset and rotation have not happened yet.',
      focus: {context: '.on(base.up) // Touch the base.', token: 'on'},
    },
    {
      id: 'target',
      image: 'relation-preview-target',
      label: 'Target',
      description:
        'Inside on, base.up becomes the bright reference. The part is still visible, and the neighboring object stays in the background.',
      focus: {context: '.on(base.up) // Touch the base.', token: 'base.up'},
    },
    {
      id: 'offset',
      image: 'relation-preview-offset',
      label: 'Offset',
      description:
        'At offset, the part moves in the target frame. Focus returns to self, while the later rotation remains outside this preview.',
      focus: {context: '.offset(6, 0, 0)', token: 'offset'},
    },
    {
      id: 'rotation',
      image: 'relation-preview',
      label: 'Rotation',
      description:
        'At rotate, the part turns about its chosen pivot. The box, contact reference, and controls share this stage’s pose.',
      focus: {context: '.rotate(0, 0, 25)', token: 'rotate'},
    },
  ],
};
