import * as THREE from 'three';
import { lightPointsMaterial, NIGHT } from '../world/night';
import { addCabinProps } from './cabinProps';
import { Parts, type Rect } from './parts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BENCH, CABIN, COCKPIT, DOOR, FRONT_WINDOWS, HALF_BEAM, HELM, LENGTH, MAST_TOP, MAST_Z, PANEL, RAIL, SETTEE, SIDE_WINDOW, STAIRS, TABLE,
  deckY, halfWidth, keelY, stationT, stationZ,
} from './layout';

// Procedural ~12 m cruising yacht (layout in `layout.ts`). Local axes: forward = -Z,
// starboard = +X, up = +Y. The waterline is at y = 0.

const STATIONS = 40;
const SECTION_STEPS = 12;
const BOOM_Y = 2.9;
const BOOM_LENGTH = 5.2;

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

/** Half width of the opening in the deck (deckhouse, cockpit) at z, 0 where the deck is closed. */
function deckOpening(z: number): number {
  if (z >= CABIN.front && z < CABIN.back) return CABIN.halfWidth;
  if (z >= COCKPIT.front && z < COCKPIT.back) return COCKPIT.halfWidth;
  return 0;
}

/**
 * Flat deck out to the hull's deck edge, open where the deckhouse and the cockpit are. Slices
 * follow the hull stations plus the openings' ends.
 */
function createDeck(): THREE.BufferGeometry {
  const zs = new Set<number>();
  for (let s = 0; s <= STATIONS; s++) zs.add(stationZ(s / STATIONS));
  for (const z of [CABIN.front, CABIN.back, COCKPIT.back]) zs.add(z);
  const sorted = [...zs].sort((a, b) => a - b);
  const positions: number[] = [];
  const quad = (xa0: number, xb0: number, y0: number, z0: number, xa1: number, xb1: number, y1: number, z1: number) => {
    // xa < xb; winding up-facing.
    positions.push(xa0, y0, z0, xb1, y1, z1, xb0, y0, z0);
    positions.push(xa0, y0, z0, xa1, y1, z1, xb1, y1, z1);
  };
  for (let i = 0; i < sorted.length - 1; i++) {
    const [z0, z1] = [sorted[i], sorted[i + 1]];
    const [t0, t1] = [stationT(z0), stationT(z1)];
    const [w0, w1] = [halfWidth(t0), halfWidth(t1)];
    const [y0, y1] = [deckY(t0), deckY(t1)];
    const a = deckOpening((z0 + z1) / 2);
    if (a === 0) {
      quad(-w0, w0, y0, z0, -w1, w1, y1, z1);
    } else {
      quad(-w0, -a, y0, z0, -w1, -a, y1, z1);
      quad(a, w0, y0, z0, a, w1, y1, z1);
    }
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

  /** the steering wheel (grabbed by hand in first person) */
  readonly wheel = new THREE.Group();
  /** companionway door (click to open/close) */
  readonly door = new THREE.Group();
  /** the instruments' screen on the deckhouse's aft wall; its material comes from the instruments */
  readonly panel: THREE.Mesh;
  /** companionway open (target; the door and hatch move there over ~0.6 s) */
  doorOpen = false;
  private doorAmount = 0;
  private readonly hatch: THREE.Mesh;
  private readonly boom = new THREE.Group();
  private readonly mainsail: THREE.Mesh;
  private readonly jibPivot = new THREE.Group();
  private readonly jib: THREE.Mesh;
  private readonly jibAxis: THREE.Vector3;
  private readonly windex = new THREE.Group();
  private sailAmount = 1;
  private readonly glass: THREE.MeshStandardMaterial;
  private readonly interior: THREE.MeshStandardMaterial[];
  private readonly interiorBase = new Map<THREE.MeshStandardMaterial, number>();
  private readonly lamp: THREE.MeshBasicMaterial;
  private readonly navLights: THREE.Points;
  private readonly panes: THREE.Mesh;
  /** clock and barometer in the cabin */
  private readonly updateProps: (dt: number, windSpeed: number) => void;
  private bellySide = 1;

  constructor() {
    this.root.add(this.tilt);

    const std = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    const teak = std(0xa47148, 0.8);
    const gelcoat = std(0xe9e6dd, 0.55);
    const glass = std(0x1b2a35, 0.1, { metalness: 0.3, emissive: 0xffb860, emissiveIntensity: 0 });
    this.glass = glass;
    const metal = std(0xb8bec4, 0.35, { metalness: 0.7 });
    const dark = std(0x2b2b2b, 0.6);
    const sailMat = std(0xfbf8ef, 0.85, { side: THREE.DoubleSide });
    // Below deck the sun hardly reaches: the cabin's materials glow a little, as if a lamp were on.
    const lining = std(0xe8dccb, 0.8, { emissive: 0x2e261c });
    const wood = std(0x9a6a43, 0.6, { emissive: 0x1c1209 });
    const cushion = std(0x2f4f7a, 0.9, { emissive: 0x0a121e });
    this.interior = [lining, wood, cushion];
    this.lamp = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });

    this.tilt.add(new THREE.Mesh(createHull(), createHullMaterial()));
    this.tilt.add(new THREE.Mesh(createDeck(), teak));

    const parts = new Parts();
    const deckAt = (z: number) => deckY(stationT(z));

    // Keel fin and rudder.
    parts.box(dark, -0.1, 0.1, -2.1, -0.6, -1.4, 0.2);
    parts.box(dark, -0.05, 0.05, -1.2, -0.2, 5.0, 5.6);

    // Deckhouse: gelcoat outside, a lining inside, so the cabin can have its own (lit) look.
    const C = CABIN;
    const T = 0.05; // wall thickness
    const L = 0.015; // lining
    const front = deckAt(C.front);
    // Side and front walls with real openings, so you can look out of the cabin (and into it).
    const sideWin: Rect = { u0: SIDE_WINDOW.z0, u1: SIDE_WINDOW.z1, v0: SIDE_WINDOW.y0, v1: SIDE_WINDOW.y1 };
    const fronts: Rect[] = FRONT_WINDOWS.map((w) => ({ u0: w.x0, u1: w.x1, v0: w.y0, v1: w.y1 }));
    for (const sgn of [-1, 1]) {
      const [a, b] = sgn > 0 ? [C.halfWidth, C.halfWidth + T] : [-C.halfWidth - T, -C.halfWidth];
      parts.wall(gelcoat, 'x', a, b, C.front - T, C.back + T, deckAt(C.back) - 0.05, C.roofTop, [sideWin]);
      const [la, lb] = sgn > 0 ? [C.halfWidth - L, C.halfWidth] : [-C.halfWidth, -C.halfWidth + L];
      parts.wall(lining, 'x', la, lb, C.front, C.back, C.floor, C.roofBottom, [sideWin]);
    }
    parts.wall(gelcoat, 'z', C.front - T, C.front, -C.halfWidth - T, C.halfWidth + T, front - 0.05, C.roofTop, fronts);
    parts.wall(lining, 'z', C.front, C.front + L, -C.halfWidth, C.halfWidth, C.floor, C.roofBottom, fronts);
    // Panes (see-through) in dark frames.
    const pane = (axis: 'x' | 'z', t: number, r: Rect) => {
      const f = 0.025;
      const [t0, t1] = axis === 'x' ? (t > 0 ? [C.halfWidth - L, C.halfWidth + T] : [-C.halfWidth - T, -C.halfWidth + L]) : [C.front - T, C.front + L];
      parts.wall(dark, axis, t0, t1, r.u0, r.u1, r.v0, r.v1, [{ u0: r.u0 + f, u1: r.u1 - f, v0: r.v0 + f, v1: r.v1 - f }]);
      const mid = (t0 + t1) / 2;
      if (axis === 'x') windowPanes.push(new THREE.PlaneGeometry(r.u1 - r.u0, r.v1 - r.v0).rotateY(Math.PI / 2).translate(mid, (r.v0 + r.v1) / 2, (r.u0 + r.u1) / 2));
      else windowPanes.push(new THREE.PlaneGeometry(r.u1 - r.u0, r.v1 - r.v0).translate((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2, mid));
    };
    const windowPanes: THREE.BufferGeometry[] = [];
    pane('x', 1, sideWin);
    pane('x', -1, sideWin);
    for (const r of fronts) pane('z', 0, r);
    const panes = new THREE.Mesh(
      mergeGeometries(windowPanes),
      new THREE.MeshStandardMaterial({ color: 0x9fc4d6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.tilt.add(panes);
    this.panes = panes;
    parts.pair(gelcoat, DOOR.halfWidth, C.halfWidth + T, COCKPIT.floor, C.roofTop, C.back, C.back + T); // aft, beside the door
    parts.box(gelcoat, -C.halfWidth - T, C.halfWidth + T, C.roofTop - 0.06, C.roofTop, C.front - T, DOOR.hatchFront); // roof
    parts.pair(gelcoat, DOOR.halfWidth, C.halfWidth + T, C.roofTop - 0.06, C.roofTop, DOOR.hatchFront, C.back + T);
    parts.pair(lining, DOOR.halfWidth, C.halfWidth, C.floor, C.roofBottom, C.back - L, C.back);
    parts.box(lining, -C.halfWidth, C.halfWidth, C.roofBottom, C.roofTop - 0.06, C.front, DOOR.hatchFront);
    parts.pair(lining, DOOR.halfWidth, C.halfWidth, C.roofBottom, C.roofTop - 0.06, DOOR.hatchFront, C.back);

    // Cabin: floor, three steps down from the door, settees with backrests, a table.
    parts.box(wood, -C.halfWidth, C.halfWidth, C.floor - 0.05, C.floor, C.front, C.back);
    for (const s of STAIRS) parts.box(wood, -DOOR.halfWidth, DOOR.halfWidth, C.floor, s.top, s.z0, s.z1);
    parts.box(wood, -DOOR.halfWidth, DOOR.halfWidth, C.floor, COCKPIT.floor, C.back, C.back + T); // riser under the threshold
    parts.pair(wood, SETTEE.inner, SETTEE.outer, C.floor, SETTEE.top - 0.08, SETTEE.z0, SETTEE.z1);
    parts.pair(cushion, SETTEE.inner, SETTEE.outer - L, SETTEE.top - 0.08, SETTEE.top, SETTEE.z0, SETTEE.z1);
    parts.pair(cushion, SETTEE.outer - L - 0.1, SETTEE.outer - L, SETTEE.top, SETTEE.top + 0.42, SETTEE.z0, SETTEE.z1);
    parts.box(wood, -TABLE.halfWidth, TABLE.halfWidth, TABLE.top - 0.05, TABLE.top, TABLE.z0, TABLE.z1);
    parts.box(wood, -0.05, 0.05, C.floor, TABLE.top - 0.05, (TABLE.z0 + TABLE.z1) / 2 - 0.05, (TABLE.z0 + TABLE.z1) / 2 + 0.05);
    // Coffee, chart, books, clock… (and a lifebuoy outside).
    const props = addCabinProps(this.tilt, parts, this.lamp);
    this.interior.push(...props.materials);
    this.updateProps = props.update;

    // Cockpit: lowered floor, side benches, coamings, and the wheel on its pedestal.
    const P = COCKPIT;
    parts.box(teak, -P.halfWidth, P.halfWidth, P.floor - 0.05, P.floor, P.front, P.back);
    parts.pair(gelcoat, P.halfWidth, P.halfWidth + T, P.floor, deckAt(P.front) + 0.08, P.front, P.back + T);
    parts.box(gelcoat, -P.halfWidth, P.halfWidth, P.floor, deckAt(P.back) + 0.08, P.back, P.back + T);
    parts.pair(teak, BENCH.inner, BENCH.outer, P.floor, BENCH.top, BENCH.z0, BENCH.z1);
    parts.box(metal, -0.07, 0.07, P.floor, HELM.y - 0.05, HELM.z - 0.2, HELM.z - 0.06);
    parts.box(dark, -0.1, 0.1, HELM.y - 0.05, HELM.y + 0.07, HELM.z - 0.24, HELM.z - 0.06); // compass housing

    this.wheel.position.set(0, HELM.y, HELM.z);
    this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(HELM.radius, 0.035, 8, 32), metal));
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, HELM.radius * 2), metal);
      spoke.rotation.z = (i * Math.PI) / 6;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12), dark);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.tilt.add(this.wheel);

    // Companionway door, hinged on its port side; it swings out and folds back against the wall.
    this.door.position.set(-DOOR.halfWidth, P.floor, C.back + T / 2);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR.halfWidth * 2, DOOR.height - 0.02, 0.04).translate(DOOR.halfWidth, DOOR.height / 2, 0), teak);
    const porthole = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.05).translate(DOOR.halfWidth, DOOR.height * 0.68, 0), glass);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.08).translate(DOOR.halfWidth * 2 - 0.1, DOOR.height * 0.45, 0), metal);
    this.door.add(leaf, porthole, handle);
    this.tilt.add(this.door);
    // Sliding hatch over the steps.
    this.hatch = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR.halfWidth * 2 + 0.06, 0.05, C.back + T - DOOR.hatchFront).translate(0, C.roofTop + 0.005, (DOOR.hatchFront + C.back + T) / 2),
      gelcoat,
    );
    this.tilt.add(this.hatch);

    // Instruments on the aft wall, starboard of the door: a dark bezel and the screen in front.
    parts.box(dark, PANEL.x - PANEL.width / 2 - 0.03, PANEL.x + PANEL.width / 2 + 0.03, PANEL.y - PANEL.height / 2 - 0.03, PANEL.y + PANEL.height / 2 + 0.03, C.back + T, PANEL.z - 0.002);
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.width, PANEL.height), new THREE.MeshBasicMaterial({ color: 0x0b1d2a }));
    this.panel.position.set(PANEL.x, PANEL.y, PANEL.z);
    this.tilt.add(this.panel);

    // Railing: stanchions along the deck edge, two wires, a pulpit at the bow, a gate at the stern.
    const railPoint = (t: number, side: number, h: number) =>
      new THREE.Vector3(side * (halfWidth(t) - RAIL.inset), deckY(t) + h, stationZ(t));
    const ts = [0.05, 0.14, 0.25, 0.37, 0.49, 0.61, 0.73, 0.85, 0.985];
    const sternZ = LENGTH / 2 - RAIL.inset;
    const sternY = deckY(1);
    for (const side of [-1, 1]) {
      for (const t of ts) parts.rod(metal, railPoint(t, side, 0), railPoint(t, side, RAIL.height), 0.018);
      const gate = new THREE.Vector3(side * RAIL.gateHalfWidth, sternY, sternZ);
      parts.rod(metal, gate, gate.clone().setY(sternY + RAIL.height), 0.018);
      for (const h of [RAIL.height, RAIL.height / 2]) {
        const pts = [new THREE.Vector3(0, deckY(0.015) + h, stationZ(0.015)), ...ts.map((t) => railPoint(t, side, h))];
        pts.push(new THREE.Vector3(side * RAIL.gateHalfWidth, sternY + h, sternZ));
        for (let i = 0; i < pts.length - 1; i++) parts.rod(metal, pts[i], pts[i + 1], h === RAIL.height ? 0.016 : 0.008);
      }
    }
    // Boarding ladder under the gate.
    for (const x of [-0.18, 0.18]) parts.rod(metal, new THREE.Vector3(x, sternY, sternZ + 0.05), new THREE.Vector3(x, -0.7, sternZ + 0.25), 0.015);
    for (const y of [0.85, 0.4, -0.05, -0.5]) {
      const z = sternZ + 0.05 + ((sternY - y) / (sternY + 0.7)) * 0.2;
      parts.rod(metal, new THREE.Vector3(-0.18, y, z), new THREE.Vector3(0.18, y, z), 0.015);
    }

    // Mast (on the foredeck, in front of the deckhouse).
    const mastBase = deckAt(MAST_Z);
    parts.rod(metal, new THREE.Vector3(0, mastBase, MAST_Z), new THREE.Vector3(0, MAST_TOP, MAST_Z), 0.08);
    parts.build(this.tilt);

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

    // Navigation lights: masthead white, port (-X) red, starboard (+X) green, near the bow.
    const bowT = 0.12;
    const bowY = deckY(bowT) + 0.35;
    const side = halfWidth(bowT) * 0.95;
    const lights: Array<[number, number, number, number]> = [
      [0, MAST_TOP + 0.35, MAST_Z, 0xfff4dc],
      [-side, bowY, stationZ(bowT), 0xff2a1a],
      [side, bowY, stationZ(bowT), 0x18ff5a],
      [0, deckY(1) + 0.75, LENGTH / 2 - 0.1, 0xfff4dc], // stern light
    ];
    const geo = new THREE.BufferGeometry();
    const c = new THREE.Color();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap(([x, y, z]) => [x, y, z]), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(lights.flatMap(([, , , hex]) => c.setHex(hex).toArray()), 3));
    this.navLights = new THREE.Points(geo, lightPointsMaterial(7));
    this.navLights.frustumCulled = false;
    this.tilt.add(this.navLights);

    shadowed(this.root);
    // Glass lets the sun in. The screen glows by itself and must not get shadow speckles.
    this.panes.castShadow = false;
    this.panel.castShadow = this.panel.receiveShadow = false;
  }

  /** Door and hatch fully open: the companionway can be walked through. */
  get companionwayOpen(): boolean {
    return this.doorOpen && this.doorAmount > 0.8;
  }

  /**
   * @param boomDeg boom angle (negative = swung to port)
   * @param relWindDeg wind relative to the bow (positive = from starboard)
   * @param wheelTurn wheel rotation around its axle in radians
   */
  /** @param windSpeed m/s, for the barometer in the cabin */
  update(boomDeg: number, relWindDeg: number, wheelTurn: number, sailUp: boolean, dt: number, windSpeed = 0): void {
    this.updateProps(dt, windSpeed);
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

    // Companionway: the door swings out to port and folds flat against the wall, the hatch slides forward.
    this.doorAmount = THREE.MathUtils.clamp(this.doorAmount + (this.doorOpen ? dt : -dt) / 0.6, 0, 1);
    const k = THREE.MathUtils.smoothstep(this.doorAmount, 0, 1);
    this.door.rotation.y = -k * Math.PI * 0.97;
    this.hatch.position.z = -k * (CABIN.back - DOOR.hatchFront);

    // At night: navigation lights on, warm light behind the windows, the cabin lamp brighter.
    const night = NIGHT.value;
    (this.navLights.material as THREE.PointsMaterial).opacity = night;
    this.navLights.visible = night > 0.01;
    this.glass.emissiveIntensity = night * 1.4;
    for (const m of this.interior) {
      if (!this.interiorBase.has(m)) this.interiorBase.set(m, m.emissiveIntensity);
      m.emissiveIntensity = this.interiorBase.get(m)! * (1 + night * 0.6);
    }
  }
}

/** Points used to sample the water surface (bow, stern, port, starboard). */
export const PROBES = {
  bow: -LENGTH / 2 + 1.2,
  stern: LENGTH / 2 - 1.2,
  beam: HALF_BEAM,
};
