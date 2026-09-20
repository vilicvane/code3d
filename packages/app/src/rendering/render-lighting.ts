import * as THREE from 'three';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {generateMagicSquareNoise} from 'three/addons/shaders/GTAOShader.js';
import type {ViewCamera} from './view-camera';

type Surface = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

/** Render-only shadows and contact shading, shared by the viewport and PNG. */
export class RenderLighting {
  private ao?: GTAOPass;
  private quad?: FullScreenQuad;
  private readonly size = new THREE.Vector2();
  private readonly bounds = new THREE.Box3();
  private readonly partBounds = new THREE.Box3();
  private readonly occlusion = {value: null as THREE.Texture | null};
  private readonly materials = new Map<
    THREE.Material,
    {material: THREE.Material; dispose(): void}
  >();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly key: THREE.DirectionalLight,
  ) {}

  render(renderer: THREE.WebGLRenderer, camera: ViewCamera): void {
    const {scene, key} = this;
    const surfaces: {
      mesh: Surface;
      castShadow: boolean;
      receiveShadow: boolean;
      material: THREE.Material;
    }[] = [];
    const overlays: THREE.Object3D[] = [];
    this.bounds.makeEmpty();
    scene.updateMatrixWorld(true);
    scene.traverseVisible(object => {
      if (object instanceof THREE.Mesh) {
        const mesh = object as Surface;
        const material = mesh.material;
        // Transparent/cutout surfaces retain their authored compositing and do
        // not become solid occluders in the depth/normal pass.
        if (
          material.visible &&
          !material.transparent &&
          material.opacity === 1 &&
          material.depthTest &&
          material.depthWrite &&
          material.alphaTest === 0 &&
          !material.alphaHash &&
          !(
            material instanceof THREE.MeshPhysicalMaterial &&
            material.transmission > 0
          )
        ) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          this.bounds.union(
            this.partBounds
              .copy(mesh.geometry.boundingBox!)
              .applyMatrix4(mesh.matrixWorld),
          );
          surfaces.push({
            mesh,
            castShadow: mesh.castShadow,
            receiveShadow: mesh.receiveShadow,
            material,
          });
        } else overlays.push(mesh);
      } else if (object instanceof THREE.Line || object instanceof THREE.Points)
        overlays.push(object);
    });
    if (!surfaces.length || this.bounds.isEmpty()) {
      renderer.render(scene, camera);
      return;
    }

    const radius = this.bounds.getSize(new THREE.Vector3()).length() / 2;
    const position = key.position.clone();
    const target = key.target.position.clone();
    const castShadow = key.castShadow;
    const shadows = renderer.shadowMap.enabled;
    const autoUpdate = renderer.shadowMap.autoUpdate;
    const autoClear = renderer.autoClear;
    const renderTarget = renderer.getRenderTarget();
    try {
      // Fit the directional shadow to the visible solids, independent of their
      // units, translation and camera zoom. Preserve the preset's light direction.
      this.bounds.getCenter(key.target.position);
      key.position
        .copy(position)
        .sub(target)
        .normalize()
        .multiplyScalar(radius * 2)
        .add(key.target.position);
      key.target.updateMatrixWorld();
      const shadow = key.shadow;
      shadow.mapSize.set(2048, 2048);
      Object.assign(shadow.camera, {
        left: -radius,
        right: radius,
        top: radius,
        bottom: -radius,
        near: radius * 0.05,
        far: radius * 4,
      });
      shadow.camera.updateProjectionMatrix();
      shadow.bias = -0.0001;
      shadow.normalBias = radius / 2048;
      shadow.radius = 3;
      key.castShadow = true;
      renderer.shadowMap.enabled = false;
      for (const object of overlays) object.visible = false;
      this.occlude(renderer, camera, radius * 0.12);
      for (const object of overlays) object.visible = true;
      for (const {mesh, material} of surfaces) {
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.material = this.shadedMaterial(material);
      }
      // Keep Three's full color/transmission pipeline intact. AO modulates
      // indirect illumination in lit materials, not the completed image.
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.autoUpdate = true;
      renderer.autoClear = autoClear;
      renderer.render(scene, camera);
    } finally {
      for (const {mesh, castShadow, receiveShadow, material} of surfaces) {
        mesh.material = material;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
      }
      for (const object of overlays) object.visible = true;
      key.position.copy(position);
      key.target.position.copy(target);
      key.target.updateMatrixWorld();
      key.castShadow = castShadow;
      renderer.shadowMap.enabled = shadows;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(renderTarget);
    }
  }

  dispose(): void {
    for (const entry of this.materials.values()) entry.dispose();
    if (this.ao) {
      this.ao.dispose();
      // The upstream pass does not release these two owned materials.
      this.ao.gtaoMaterial.dispose();
      this.ao.blendMaterial.dispose();
    }
    this.quad?.dispose();
  }

  private shadedMaterial(source: THREE.Material): THREE.Material {
    if (!(
      source instanceof THREE.MeshStandardMaterial ||
      source instanceof THREE.MeshLambertMaterial ||
      source instanceof THREE.MeshPhongMaterial
    ))
      return source;
    const cached = this.materials.get(source);
    if (cached) return cached.material;
    const material = source.clone();
    material.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile(shader, renderer);
      shader.uniforms.code3dOcclusion = this.occlusion;
      shader.uniforms.code3dResolution = {value: this.size};
      shader.fragmentShader =
        `uniform sampler2D code3dOcclusion;\nuniform vec2 code3dResolution;\n${shader.fragmentShader}`.replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
        {
          float ambientOcclusion = mix(1.0, texture2D(code3dOcclusion, gl_FragCoord.xy / code3dResolution).r, 0.85);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #ifdef USE_SHEEN
            sheenSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined(USE_ENVMAP) && defined(STANDARD)
            float dotNV = saturate(dot(geometryNormal, geometryViewDir));
            reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
          #endif
        }`,
        );
    };
    material.customProgramCacheKey = () =>
      `${source.customProgramCacheKey()}:code3d-contact-lighting`;
    const dispose = () => {
      source.removeEventListener('dispose', dispose);
      material.dispose();
      this.materials.delete(source);
    };
    source.addEventListener('dispose', dispose);
    this.materials.set(source, {material, dispose});
    return material;
  }

  private occlude(
    renderer: THREE.WebGLRenderer,
    camera: ViewCamera,
    radius: number,
  ): void {
    if (!this.ao) {
      this.ao = new GTAOPass(this.scene, camera);
      this.ao.output = GTAOPass.OUTPUT.Off;
      this.ao.normalMaterial.side = THREE.DoubleSide;
      // Deterministic rotations keep independent viewport/export contexts equal.
      this.ao.pdNoiseTexture.dispose();
      this.ao.pdNoiseTexture = generateMagicSquareNoise();
      this.ao.pdMaterial.uniforms.tNoise.value = this.ao.pdNoiseTexture;
      this.ao.updateGtaoMaterial({samples: 32});
      this.ao.updatePdMaterial({samples: 32, lumaPhi: 2});
      this.quad = new FullScreenQuad(this.ao.pdMaterial);
    }
    const ao = this.ao;
    ao.camera = camera;
    const perspective = camera instanceof THREE.PerspectiveCamera ? 1 : 0;
    if (ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== perspective) {
      ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = perspective;
      ao.gtaoMaterial.needsUpdate = true;
    }
    renderer.getDrawingBufferSize(this.size);
    const scale = Math.min(1, 1024 / Math.max(this.size.x, this.size.y));
    const width = Math.round(this.size.x * scale);
    const height = Math.round(this.size.y * scale);
    if (ao.width !== width || ao.height !== height) ao.setSize(width, height);
    ao.updateGtaoMaterial({radius, thickness: radius * 2});
    ao.updatePdMaterial({radius: (8 * height) / 480, depthPhi: radius * 0.4});
    const target = renderer.getRenderTarget();
    ao.render(renderer, ao.gtaoRenderTarget, ao.pdRenderTarget, 0, false);
    renderer.autoClear = false;
    // A second bilateral pass smooths contact noise without crossing depth or
    // normal discontinuities. Reuse the now-unneeded raw AO target.
    ao.pdMaterial.uniforms.tDiffuse.value = ao.pdRenderTarget.texture;
    ao.pdMaterial.uniforms.index.value = 1;
    renderer.setRenderTarget(ao.gtaoRenderTarget);
    this.quad!.render(renderer);
    ao.pdMaterial.uniforms.tDiffuse.value = ao.gtaoRenderTarget.texture;
    ao.pdMaterial.uniforms.index.value = 0;
    renderer.setRenderTarget(target);
    this.occlusion.value = ao.gtaoRenderTarget.texture;
  }
}
