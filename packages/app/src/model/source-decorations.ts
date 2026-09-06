import {
  elementSourceDecoration,
  relationSourceDecoration,
} from './element-decorations';
import {originSourceDecoration} from './origin-decorations';
import {
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
} from './operation-decorations';

export const sourceDecorationProviders = [
  booleanOperationSourceDecoration,
  edgeModificationSourceDecoration,
  elementSourceDecoration,
  relationSourceDecoration,
  originSourceDecoration,
];
