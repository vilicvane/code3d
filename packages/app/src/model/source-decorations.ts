import {
  elementSourceDecoration,
  relationSourceDecoration,
} from './element-decorations';
import {originSourceDecoration} from './origin-decorations';
import {parameterSourceDecoration} from './parameter-decorations';
import {
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
  loftResultSourceDecoration,
} from './operation-decorations';

export const sourceDecorationProviders = [
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
  loftResultSourceDecoration,
  elementSourceDecoration,
  relationSourceDecoration,
  originSourceDecoration,
  parameterSourceDecoration,
];
