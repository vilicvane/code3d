import {originSourceDecoration} from './origin-decorations';
import {parameterSourceDecoration} from './parameter-decorations';
import {edgeModificationSourceDecoration} from './operation-decorations';

export const sourceDecorationProviders = [
  edgeModificationSourceDecoration,
  originSourceDecoration,
  parameterSourceDecoration,
];
