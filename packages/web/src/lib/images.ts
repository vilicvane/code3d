import type {ImageMetadata} from 'astro';

const images = import.meta.glob<{default: ImageMetadata}>(
  '../assets/models/*.png',
  {eager: true},
);
export function modelImage(id: string): ImageMetadata {
  const entry = images[`../assets/models/${id}.png`];
  if (!entry)
    throw new Error(
      `Missing model image ${id}. Run npm run render:web-images after building App.`,
    );
  return entry.default;
}
