import {
  Color3,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  ReflectionProbe,
  type Scene,
  ShadowGenerator,
  type Camera,
  Vector3,
} from '@babylonjs/core';
import { SUN_DIR } from './sea';

export interface Rendering {
  shadows: ShadowGenerator;
  sun: DirectionalLight;
}

/**
 * Lights, soft shadows, a sky reflection for metal and paint, and a light
 * post-process: filmic tone mapping, anti-aliasing and a gentle bloom.
 */
export function setupRendering(scene: Scene, camera: Camera, lowPower: boolean): Rendering {
  const hemi = new HemisphericLight('sky-light', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55;
  hemi.diffuse = new Color3(0.85, 0.93, 1);
  hemi.groundColor = new Color3(0.25, 0.4, 0.45);

  const sun = new DirectionalLight('sun', SUN_DIR.clone(), scene);
  sun.position = SUN_DIR.scale(-300);
  sun.intensity = 2.6;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 700;

  const shadows = new ShadowGenerator(lowPower ? 1024 : 2048, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  shadows.normalBias = 0.02;
  shadows.darkness = 0.35;
  sun.autoUpdateExtends = true;

  // Environment for PBR: render the sky (and only the sky) into a cube map once.
  const probe = new ReflectionProbe('sky-probe', 128, scene);
  const sky = scene.getMeshByName('sky');
  if (sky) probe.renderList?.push(sky);
  for (const m of scene.meshes) if (m.name.startsWith('cloud-')) probe.renderList?.push(m);
  probe.refreshRate = 0; // RENDER_ONCE
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.9;

  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.05;
  scene.imageProcessingConfiguration.contrast = 1.12;

  const pipeline = new DefaultRenderingPipeline('post', true, scene, [camera]);
  pipeline.samples = lowPower ? 1 : 4;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = !lowPower;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 48;
  pipeline.bloomScale = 0.5;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.exposure = 1.05;
  pipeline.imageProcessing.contrast = 1.18;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 1.2;
  pipeline.imageProcessing.vignetteStretch = 0.4;
  pipeline.imageProcessing.colorCurvesEnabled = true;
  pipeline.imageProcessing.colorCurves!.globalSaturation = 28;
  pipeline.sharpenEnabled = !lowPower;
  pipeline.sharpen.edgeAmount = 0.15;

  return { shadows, sun };
}
