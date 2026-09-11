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
  extrudeResultSourceDecoration,
} from './operation-decorations';

export const sourceDecorationProviders = [
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
  loftResultSourceDecoration,
  extrudeResultSourceDecoration,
  elementSourceDecoration,
  relationSourceDecoration,
  originSourceDecoration,
  parameterSourceDecoration,
];
