import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const SUN_ELEVATION = 32; // degrees
const SUN_AZIMUTH = 210; // compass degrees
const FOG_COLOR = 0xbfd4e0;

/** Sky dome, sun light with a shadow box following the boat, fog and environment reflections. */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  private readonly sunDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    // Compass azimuth → world: east = +X, north = -Z.
    this.sunDir.set(Math.sin(theta) * Math.sin(phi), Math.cos(phi), -Math.cos(theta) * Math.sin(phi));

    const sky = new Sky();
    sky.scale.setScalar(40000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    // Bake the sky into an environment map so water and boat reflect it.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1000);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(u);
    skyScene.add(skyCopy);
    scene.environment = pmrem.fromScene(skyScene).texture;
    scene.environmentIntensity = 0.8;
    pmrem.dispose();

    scene.fog = new THREE.Fog(FOG_COLOR, 1500, 9000);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -25;
    s.right = s.top = 25;
    s.near = 1;
    s.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1d3a4a, 0.6));
  }

  /** Keep the shadow camera centred on the boat. */
  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 100);
  }
}
