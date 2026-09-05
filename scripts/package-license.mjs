import {copyFile} from 'node:fs/promises';

// npm runs prepack in the workspace being packed. Keep the root text canonical.
await copyFile(new URL('../LICENSE', import.meta.url), 'LICENSE');
