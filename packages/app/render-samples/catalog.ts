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
      'Give a reusable part meaningful mounting faces. Let the next model work with those names.',
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
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  category: string;
  file: string;
  focus: SourceToken;
  tags: readonly string[];
}[];

export const firstModelContexts = [
  {
    id: 'base',
    label: 'Inspect the base',
    description: 'Focus on the rounded plate and its connection to the source.',
    focus: {context: 'group([base, post])', token: 'base'},
  },
  {
    id: 'post',
    label: 'Inspect the post',
    description:
      'Focus on the cylinder, with surrounding geometry for context.',
    focus: {context: 'group([base, post])', token: 'post'},
  },
  {
    id: 'model',
    label: 'See them together',
    description:
      'Select the group to see both parts with their relation resolved.',
    focus: {context: 'group([base, post])', token: 'group'},
  },
] as const;
