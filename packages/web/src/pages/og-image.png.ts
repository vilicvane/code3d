import type {APIRoute} from 'astro';
import sharp from 'sharp';
import source from '../assets/social.svg?raw';

export const GET: APIRoute = async () => {
  const image = await sharp(Buffer.from(source)).png().toBuffer();
  return new Response(new Uint8Array(image), {
    headers: {'Content-Type': 'image/png'},
  });
};
