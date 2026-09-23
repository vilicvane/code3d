import * as THREE from 'three';
import type {SketchSnapshot} from '@code3d/core/tooling';
import {
  createRenderedSketch,
  disposeObject,
  ModelRenderer,
} from '../../src/rendering/model-renderer.ts';
import {createViewCamera} from '../../src/rendering/view-camera.ts';

export async function measureConstruction() {
  const container = document.querySelector<HTMLElement>('main')!;
  const renderer = new ModelRenderer(container);
  renderer.grid.visible = false;
  renderer.scene.background = new THREE.Color('#10120f');
  const ref = (id: number) => ({layer: 's', id});
  const snapshot: SketchSnapshot = {
    id: 's',
    constraints: [],
    redundant: [],
    degreesOfFreedom: 0,
    entities: [
      {kind: 'point', id: 1, position: [-8, 0]},
      {kind: 'point', id: 2, position: [8, 0]},
      {kind: 'line', id: 3, points: [ref(1), ref(2)], construction: true},
      {kind: 'point', id: 4, position: [-8, 3]},
      {kind: 'point', id: 5, position: [8, 3]},
      {kind: 'line', id: 6, points: [ref(4), ref(5)]},
      {kind: 'point', id: 7, position: [-4, -4]},
      {kind: 'circle', id: 8, center: ref(7), radius: 2, construction: true},
      {kind: 'point', id: 9, position: [4, -4]},
      {kind: 'point', id: 10, position: [6, -4]},
      {kind: 'point', id: 11, position: [4, -2]},
      {
        kind: 'arc',
        id: 12,
        center: ref(9),
        radius: 2,
        points: [ref(10), ref(11)],
        direction: 'ccw',
        construction: true,
      },
    ],
  };
  const object = createRenderedSketch([snapshot], 'primary');
  renderer.scene.add(object);
  const results = [];
  try {
    for (const projection of ['perspective', 'orthographic'] as const)
      for (const [width, height, ratio, scale, distance] of [
        [640, 400, 1, 1, 24],
        [800, 500, 2, 2, 60],
        [640, 400, 1, 0.5, 24],
      ]) {
        renderer.renderer.setPixelRatio(ratio);
        renderer.renderer.setSize(width, height);
        renderer.camera = createViewCamera(projection, width / height);
        renderer.camera.position.set(
          projection === 'perspective' ? distance / 2 : 0,
          distance,
          0,
        );
        renderer.camera.up.set(0, 0, -1);
        renderer.camera.lookAt(0, 0, 0);
        if (renderer.camera instanceof THREE.OrthographicCamera) {
          renderer.camera.left = -20;
          renderer.camera.right = 20;
          renderer.camera.top = (20 * height) / width;
          renderer.camera.bottom = -renderer.camera.top;
        }
        renderer.camera.updateProjectionMatrix();
        object.scale.setScalar(scale);
        renderer.renderFrame();
        const gl = renderer.renderer.getContext();
        const pixels = new Uint8Array(
          gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
        );
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        const project = (x: number, y: number) => {
          const p = new THREE.Vector3(x, 0, -y)
            .applyMatrix4(object.matrixWorld)
            .project(renderer.camera);
          return [((p.x + 1) * width) / 2, ((p.y + 1) * height) / 2];
        };
        const visible = (x: number, y: number) => {
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              const i =
                (Math.round(y * ratio + dy) * gl.drawingBufferWidth +
                  Math.round(x * ratio + dx)) *
                4;
              if (pixels[i + 1] > 120 && pixels[i] > 90 && pixels[i + 2] < 100)
                return true;
            }
          return false;
        };
        const runs = (y: number) => {
          const from = project(-8, y),
            to = project(8, y);
          const values = [];
          let length = 0;
          for (
            let x = Math.max(0, Math.ceil(from[0] + 5));
            x < Math.min(width, to[0] - 5);
            x++
          ) {
            if (visible(x, from[1])) length++;
            else if (length) {
              values.push(length);
              length = 0;
            }
          }
          if (length) values.push(length);
          return values;
        };
        const circle = Array.from({length: 720}, (_, i) => {
          const angle = (i / 720) * Math.PI * 2;
          return visible(
            ...(project(-4 + Math.cos(angle) * 2, -4 + Math.sin(angle) * 2) as [
              number,
              number,
            ]),
          );
        });
        results.push({
          projection,
          width,
          ratio,
          scale,
          dashed: runs(0),
          solid: runs(3),
          circleFraction: circle.filter(Boolean).length / circle.length,
        });
      }
    // The export uses its own renderer and target resolution, so it must refresh dashes too.
    object.scale.setScalar(1.2);
    const blob = await renderer.captureImage(960, 600);
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    await img.decode();
    container.replaceChildren(img);
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const context = canvas.getContext('2d')!;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 299, 960, 3).data;
    const exported = [];
    let run = 0;
    for (let x = 0; x < 960; x++) {
      const visible = [0, 1, 2].some(y => pixels[(y * 960 + x) * 4 + 1] > 120);
      if (visible) run++;
      else if (run) {
        exported.push(run);
        run = 0;
      }
    }
    if (run) exported.push(run);
    return {samples: results, exported};
  } finally {
    disposeObject(object);
    renderer.dispose();
    renderer.renderer.forceContextLoss();
  }
}
