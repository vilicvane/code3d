import * as THREE from 'three';

/** A filled direction marker whose tip stays on the geometric endpoint. */
export class ScreenSpaceArrowHead extends THREE.Mesh<
  THREE.BufferGeometry,
  THREE.ShaderMaterial
> {
  private readonly viewport = new THREE.Vector4();

  constructor(direction: THREE.Vector3, color: THREE.Color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, -0.5, -1, 0, 0.5, -1, 0], 3),
    );
    super(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          color: {value: color},
          opacity: {value: 1},
          resolution: {value: new THREE.Vector2()},
          headSize: {value: new THREE.Vector2(6, 10)},
        },
        vertexShader: `
          uniform vec2 resolution;
          uniform vec2 headSize;
          void main() {
            vec4 tip = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            vec4 tangent = projectionMatrix * modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0);
            // The projected tangent derivative avoids crossing the near plane
            // when a reference's local unit is large relative to the camera.
            vec2 direction = (tangent.xy * tip.w - tip.xy * tangent.w) * resolution;
            // A direction straight into the camera has no screen direction.
            direction /= max(length(direction), 0.000001);
            vec2 side = vec2(direction.y, -direction.x);
            vec2 offset = side * position.x * headSize.x + direction * position.y * headSize.y;
            gl_Position = tip;
            gl_Position.xy += offset * 2.0 / resolution * tip.w;
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          uniform float opacity;
          void main() {
            gl_FragColor = vec4(color, opacity);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.name = 'direction-arrow-head';
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    this.frustumCulled = false;
    this.raycast = () => undefined;
  }

  override onBeforeRender(renderer: THREE.WebGLRenderer): void {
    renderer.getViewport(this.viewport);
    this.material.uniforms.resolution.value.set(
      this.viewport.z,
      this.viewport.w,
    );
    this.material.uniforms.opacity.value = this.material.opacity;
  }
}
