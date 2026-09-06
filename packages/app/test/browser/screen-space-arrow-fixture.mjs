import * as THREE from 'three';
import {ScreenSpaceArrowHead} from '../../src/rendering/screen-space-arrow-head.ts';

export function measureDirectionHeads() {
  const renderer = new THREE.WebGLRenderer({antialias: true});
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('black');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  const parent = new THREE.Group();
  const head = new ScreenSpaceArrowHead(
    new THREE.Vector3(0, 1, 1).normalize(),
    new THREE.Color('white'),
  );
  parent.add(head);
  scene.add(parent);
  const results = [];
  try {
    for (const [distance, scale, ratio, width, height] of [
      [20, 1, 1, 360, 240],
      [200, 1, 1, 360, 240],
      [20, 1000, 1, 360, 240],
      [20, 0.001, 1, 720, 480],
      [20, 1, 2, 360, 240],
      [200, 1000, 2, 720, 480],
    ]) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      parent.scale.set(scale * 0.5, scale, scale * 2);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
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
      let left = Infinity,
        right = -Infinity,
        bottom = Infinity,
        top = -Infinity;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 20) continue;
        const x = (i / 4) % gl.drawingBufferWidth;
        const y = Math.floor(i / 4 / gl.drawingBufferWidth);
        left = Math.min(left, x);
        right = Math.max(right, x);
        bottom = Math.min(bottom, y);
        top = Math.max(top, y);
      }
      results.push({
        distance,
        scale,
        ratio,
        width: (right - left + 1) / ratio,
        height: (top - bottom + 1) / ratio,
        tipX: (left + right + 1) / 2 / ratio,
        tipY: (top + 1) / ratio,
        expectedTip: [width / 2, height / 2],
      });
    }
  } finally {
    head.geometry.dispose();
    head.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return results;
}
