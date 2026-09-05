import type {APIRoute} from 'astro';
import sharp from 'sharp';
import mark from '../../../../assets/brand/mark.svg?raw';

const markUrl = `data:image/svg+xml;base64,${Buffer.from(mark).toString('base64')}`;
const source = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#11130f"/>
  <image href="${markUrl}" x="58" y="52" width="59" height="44"/>
  <g font-family="Arial,sans-serif">
    <text x="125" y="87" fill="#ecefe5" font-size="38" font-weight="700">Code3D</text>
    <text x="62" y="250" fill="#ecefe5" font-size="70" font-weight="600">The power of code.</text>
    <text x="62" y="345" fill="#a3ad95" font-size="60">The feel of direct manipulation.</text>
    <text x="64" y="465" fill="#d8ff3e" font-size="21" letter-spacing="3">CODE AND GEOMETRY, CONNECTED</text>
    <text x="64" y="561" fill="#a3ad95" font-size="20">Solid modeling with TypeScript · Prototype 01</text>
  </g>
</svg>`;

export const GET: APIRoute = async () => {
  const image = await sharp(Buffer.from(source)).png().toBuffer();
  return new Response(new Uint8Array(image), {
    headers: {'Content-Type': 'image/png'},
  });
};
