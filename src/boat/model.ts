import * as THREE from 'three';

// Procedural sailboat, ~10 m long. Local axes: forward = -Z, starboard = +X, up = +Y.
// The waterline is at y = 0.

const LENGTH = 10;
const HALF_BEAM = 1.7;
const STATIONS = 28;
const SECTION_STEPS = 12;
const MAST_Z = -1.2;
const MAST_TOP = 12.2;
const BOOM_Y = 3.1;
const BOOM_LENGTH = 4.4;

const halfWidth = (t: number) =>
  t < 0.55
    ? HALF_BEAM * Math.pow(Math.sin(((t / 0.55) * Math.PI) / 2), 0.75)
    : HALF_BEAM * (1 - 0.25 * ((t - 0.55) / 0.45) ** 2);
const deckY = (t: number) => 1.0 + 0.3 * (1 - t) ** 2;
const keelY = (t: number) => {
  if (t < 0.3) return THREE.MathUtils.lerp(deckY(0) * 0.4, -0.7, THREE.MathUtils.smoothstep(t, 0, 0.3));
  if (t > 0.75) return THREE.MathUtils.lerp(-0.7, -0.3, (t - 0.75) / 0.25);
  return -0.7;
};
const stationZ = (t: number) => -LENGTH / 2 + LENGTH * t;

/** Hull cross-section at t (0 = bow, 1 = stern), from the port deck edge, under the keel, to starboard. */
function section(t: number): THREE.Vector3[] {
  const w = halfWidth(t);
  const top = deckY(t);
  const bottom = keelY(t);
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= SECTION_STEPS; k++) {
    const phi = (Math.PI * k) / SECTION_STEPS;
    const y = top - (top - bottom) * Math.pow(Math.sin(phi), 0.55);
    pts.push(new THREE.Vector3(-w * Math.cos(phi), y, stationZ(t)));
  }
  return pts;
}

/**
 * Watertight hull: one indexed shell (smooth normals) plus a flat transom.
 * All triangles wind outwards, so the hull renders single-sided.
 */
function createHull(): THREE.BufferGeometry {
  const cols = SECTION_STEPS + 1;
  const shell: number[] = [];
  for (let s = 0; s <= STATIONS; s++) for (const p of section(s / STATIONS)) shell.push(p.x, p.y, p.z);
  const shellIndex: number[] = [];
  for (let s = 0; s < STATIONS; s++) {
    for (let k = 0; k < SECTION_STEPS; k++) {
      const a = s * cols + k;
      shellIndex.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(shell, 3));
  shellGeo.setIndex(shellIndex);
  shellGeo.computeVertexNormals();

  // Transom: fan over the last section, closed along the deck edge, facing aft.
  const last = section(1);
  const centre = last.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(last.length);
  const transom: number[] = [];
  for (let k = 0; k < SECTION_STEPS; k++) transom.push(...centre.toArray(), ...last[k].toArray(), ...last[k + 1].toArray());
  transom.push(...centre.toArray(), ...last[SECTION_STEPS].toArray(), ...last[0].toArray());
  const transomGeo = new THREE.BufferGeometry();
  transomGeo.setAttribute('position', new THREE.Float32BufferAttribute(transom, 3));
  transomGeo.setAttribute('normal', new THREE.Float32BufferAttribute(transom.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));

  return mergeNonIndexed(shellGeo.toNonIndexed(), transomGeo);
}

function mergeNonIndexed(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const join = (name: string) => {
    const arrays = geos.map((g) => g.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      out.set(a, o);
      o += a.length;
    }
    return new THREE.BufferAttribute(out, 3);
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', join('position'));
  geo.setAttribute('normal', join('normal'));
  return geo;
}

/** Hull paint by height: antifouling below the waterline, a boot stripe, white topsides. */
function createHullMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHullY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHullY;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        float aa = fwidth(vHullY);
        vec3 paint = vec3(0.55, 0.13, 0.11);
        paint = mix(paint, vec3(0.06, 0.13, 0.24), smoothstep(0.05 - aa, 0.05 + aa, vHullY));
        paint = mix(paint, vec3(0.92, 0.91, 0.88), smoothstep(0.2 - aa, 0.2 + aa, vHullY));
        diffuseColor.rgb *= pow(paint, vec3(2.2)); // sRGB picks → linear
        `,
      );
  };
  return mat;
}

/** Deck surface sharing the hull's deck edge exactly, so there is no gap between them. */
function createDeck(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let s = 0; s < STATIONS; s++) {
    const t0 = s / STATIONS;
    const t1 = (s + 1) / STATIONS;
    const [w0, w1] = [halfWidth(t0), halfWidth(t1)];
    const [y0, y1] = [deckY(t0), deckY(t1)];
    const [z0, z1] = [stationZ(t0), stationZ(t1)];
    positions.push(-w0, y0, z0, w1, y1, z1, w0, y0, z0);
    positions.push(-w0, y0, z0, -w1, y1, z1, w1, y1, z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Triangular sail lying in the local YZ plane with its tack at the origin.
 * The belly bulges towards +X; mirror with scale.x to put it on the other side.
 */
function createSail(head: THREE.Vector3, clew: THREE.Vector3, depth = 0.1): THREE.BufferGeometry {
  const rows = 10;
  const cols = 8;
  const grid: THREE.Vector3[][] = [];
  for (let r = 0; r <= rows; r++) {
    const h = r / rows;
    const luff = head.clone().multiplyScalar(h);
    const leech = clew.clone().lerp(head, h);
    const chord = luff.distanceTo(leech);
    const row: THREE.Vector3[] = [];
    for (let c = 0; c <= cols; c++) {
      const v = c / cols;
      const p = luff.clone().lerp(leech, v);
      p.x = depth * chord * Math.sin(Math.PI * v) * (1 - 0.3 * v);
      row.push(p);
    }
    grid.push(row);
  }
  const positions: number[] = [];
  const push = (p: THREE.Vector3) => positions.push(p.x, p.y, p.z);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      push(grid[r][c]);
      push(grid[r][c + 1]);
      push(grid[r + 1][c]);
      push(grid[r][c + 1]);
      push(grid[r + 1][c + 1]);
      push(grid[r + 1][c]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function shadowed<T extends THREE.Object3D>(obj: T): T {
  obj.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return obj;
}

export class BoatModel {
  /** Positioned and rotated (heading) by the controller. */
  readonly root = new THREE.Group();
  /** Pitch, roll and heel. */
  readonly tilt = new THREE.Group();

  private readonly wheel = new THREE.Group();
  private readonly boom = new THREE.Group();
  private readonly mainsail: THREE.Mesh;
  private readonly jibPivot = new THREE.Group();
  private readonly jib: THREE.Mesh;
  private readonly jibAxis: THREE.Vector3;
  private readonly windex = new THREE.Group();
  private sailAmount = 1;
  private bellySide = 1;

  constructor() {
    this.root.add(this.tilt);

    const teak = new THREE.MeshStandardMaterial({ color: 0xa47148, roughness: 0.8 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xe9e6dd, roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a35, roughness: 0.1, metalness: 0.3 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.35, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xfbf8ef, roughness: 0.85, side: THREE.DoubleSide });

    this.tilt.add(new THREE.Mesh(createHull(), createHullMaterial()));
    this.tilt.add(new THREE.Mesh(createDeck(), teak));

    // Keel fin and rudder.
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 1.4), dark);
    keel.position.set(0, -1.2, -0.4);
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.5), dark);
    rudder.position.set(0, -0.6, 4.4);
    this.tilt.add(keel, rudder);

    // Cabin with windows.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 2.9), cabinMat);
    cabin.position.set(0, 1.35, -0.6);
    this.tilt.add(cabin);
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 1.6), glass);
      win.position.set(side * 1.005, 1.42, -0.6);
      this.tilt.add(win);
    }

    // Cockpit steering pedestal and wheel (faces aft, spins around the Z axis).
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.85), metal);
    pedestal.position.set(0, 1.42, 3.4);
    this.tilt.add(pedestal);
    this.wheel.position.set(0, 1.9, 3.5);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 32), metal);
    this.wheel.add(rim);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0), metal);
      spoke.rotation.z = (i * Math.PI) / 6;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12), dark);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.tilt.add(this.wheel);

    // Mast.
    const mastHeight = MAST_TOP - 1.65;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, mastHeight), metal);
    mast.position.set(0, 1.65 + mastHeight / 2, MAST_Z);
    this.tilt.add(mast);

    // Boom + mainsail, pivoting around the mast.
    this.boom.position.set(0, BOOM_Y, MAST_Z);
    const boomBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BOOM_LENGTH), metal);
    boomBar.rotation.x = Math.PI / 2;
    boomBar.position.z = BOOM_LENGTH / 2;
    this.boom.add(boomBar);
    this.mainsail = new THREE.Mesh(
      createSail(new THREE.Vector3(0, MAST_TOP - 0.3 - BOOM_Y, 0), new THREE.Vector3(0, 0.05, BOOM_LENGTH - 0.1)),
      sailMat,
    );
    this.boom.add(this.mainsail);
    this.tilt.add(this.boom);

    // Forestay + jib, swinging around the forestay.
    const tack = new THREE.Vector3(0, deckY(0) - 0.05, -LENGTH / 2 + 0.05);
    const stayTop = new THREE.Vector3(0, MAST_TOP - 0.6, MAST_Z);
    const stayDir = stayTop.clone().sub(tack);
    const forestay = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, stayDir.length()), metal);
    forestay.position.copy(tack).addScaledVector(stayDir, 0.5);
    forestay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stayDir.clone().normalize());
    this.tilt.add(forestay);
    this.jibAxis = stayDir.clone().normalize();
    this.jibPivot.position.copy(tack);
    this.jib = new THREE.Mesh(
      createSail(stayDir.clone().multiplyScalar(0.88), new THREE.Vector3(0, 0.55, MAST_Z - tack.z - 0.2), 0.12),
      sailMat,
    );
    this.jibPivot.add(this.jib);
    this.tilt.add(this.jibPivot);

    // Wind indicator on top of the mast.
    this.windex.position.set(0, MAST_TOP + 0.1, MAST_Z);
    const vane = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xe63946 }));
    vane.rotation.x = -Math.PI / 2; // tip points to local -Z
    this.windex.add(vane);
    this.tilt.add(this.windex);

    shadowed(this.root);
  }

  /**
   * @param boomDeg boom angle (negative = swung to port)
   * @param relWindDeg wind relative to the bow (positive = from starboard)
   * @param wheelTurn wheel rotation around its axle in radians
   */
  update(boomDeg: number, relWindDeg: number, wheelTurn: number, sailUp: boolean, dt: number): void {
    this.sailAmount += ((sailUp ? 1 : 0) - this.sailAmount) * (1 - Math.exp(-2.5 * dt));
    const furl = Math.max(0.02, this.sailAmount);
    const boom = THREE.MathUtils.degToRad(boomDeg);
    // Sails bulge to leeward, i.e. the side the boom is swung to. Never scale to zero:
    // a degenerate scale breaks the normals and renders the sail black.
    if (Math.abs(boomDeg) > 1) this.bellySide = Math.sign(boomDeg);
    const belly = this.bellySide * THREE.MathUtils.clamp(Math.abs(boomDeg) / 8, 0.15, 1);

    this.boom.rotation.y = boom;
    this.mainsail.scale.set(belly, furl, 1);
    this.mainsail.visible = this.sailAmount > 0.03;

    this.jibPivot.quaternion.setFromAxisAngle(this.jibAxis, boom * 0.7);
    this.jib.scale.set(belly, furl, furl);
    this.jib.visible = this.sailAmount > 0.03;

    this.windex.rotation.y = -THREE.MathUtils.degToRad(relWindDeg);
    this.wheel.rotation.z = wheelTurn;
  }
}

/** Points used to sample the water surface (bow, stern, port, starboard). */
export const PROBES = {
  bow: -LENGTH / 2 + 1,
  stern: LENGTH / 2 - 1,
  beam: HALF_BEAM,
};
