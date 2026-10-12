// The marina house up close: walls with a real door, the name board outside, and inside a small
// gallery — six framed photos of the place with labels (photographer, licence) and a poster with the
// Wikipedia intro. Built only for the house(s) near the player (`MarinaHouses`); from afar the
// village draws a plain box in its place. Layout: marinaHouse.ts.
//
// Inside, everything is unlit (MeshBasicMaterial with a little baked shading): the gallery is lit by
// its own lamps, day and night, and the sun never shines through the walls onto it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import alea from 'alea';
import { fitPicture, GALLERY_BENCH, HOUSE_DOOR, HOUSE_SIGN, HOUSE_STEPS, MARINA_HOUSE, WALL_SLOTS, type WallSlot } from './marinaHouse';
import type { MarinaInfo, MarinaInfoStore } from './marinaInfo';
import type { MarinaHouseSite } from './village';

const W = MARINA_HOUSE.width;
const D = MARINA_HOUSE.depth;
const H = MARINA_HOUSE.height;
const T = MARINA_HOUSE.wall;
const FLOOR = MARINA_HOUSE.floor;
const CEIL = MARINA_HOUSE.ceiling;
const DOOR_W = HOUSE_DOOR.halfWidth * 2;
const DOOR_H = HOUSE_DOOR.height;
const DOOR_SWING = 0.6; // seconds, matches DoorSound
const FRONT_WINDOWS = [-3.4, 3.4]; // x of the two windows beside the door
const WINDOW = { width: 1.5, bottom: FLOOR + 0.95, top: FLOOR + 2.35 };
const UPPER_WINDOW = { width: 1.1, bottom: 4.35, top: 5.55 };

const srgb = (hex: number) => new THREE.Color(hex);

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Box from (x0, y0, z0) to (x1, y1, z1) in house coordinates. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/**
 * Inside wall face: a vertical quad from (x0, z0) to (x1, z1) between y0 and y1, facing `normal`
 * side, with baked shading — darker towards the floor and the ceiling corners, `tone` overall.
 */
function wallFace(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tone: number): THREE.BufferGeometry {
  const rows = [y0, y0 + 0.35, (y0 + y1) / 2, y1 - 0.3, y1].filter((y) => y >= y0 && y <= y1);
  const pos: number[] = [];
  const col: number[] = [];
  const shade = (y: number) => tone * (y < y0 + 0.35 ? 0.86 + 0.14 * ((y - y0) / 0.35) : y > y1 - 0.3 ? 1 - 0.12 * ((y - (y1 - 0.3)) / 0.3) : 1);
  for (let i = 0; i + 1 < rows.length; i++) {
    const [a, b] = [rows[i], rows[i + 1]];
    // Two triangles, counter-clockwise seen from the room (normal side).
    const quad = [
      [x0, a, z0], [x1, a, z1], [x1, b, z1],
      [x0, a, z0], [x1, b, z1], [x0, b, z0],
    ];
    for (const [x, y, z] of quad) {
      pos.push(x, y, z);
      const s = shade(y);
      col.push(s, s, s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** Same as wallFace but with the door/window holes cut out of the front wall (seen from inside). */
function frontInside(tone: number): THREE.BufferGeometry {
  const z = D / 2 - T - 0.01;
  const xl = -W / 2 + T;
  const xr = W / 2 - T;
  const dl = -HOUSE_DOOR.halfWidth;
  const dr = HOUSE_DOOR.halfWidth;
  const parts: THREE.BufferGeometry[] = [];
  // Seen from inside (looking +Z) +X is on the left, so faces run from +X to -X.
  const face = (x0: number, x1: number, y0: number, y1: number) => parts.push(wallFace(x1, z, x0, z, y0, y1, tone));
  const [w0, w1] = [FRONT_WINDOWS[0] - WINDOW.width / 2, FRONT_WINDOWS[0] + WINDOW.width / 2];
  const [v0, v1] = [FRONT_WINDOWS[1] - WINDOW.width / 2, FRONT_WINDOWS[1] + WINDOW.width / 2];
  face(xl, w0, FLOOR, CEIL);
  face(w0, w1, FLOOR, WINDOW.bottom);
  face(w0, w1, WINDOW.top, CEIL);
  face(w1, dl, FLOOR, CEIL);
  face(dl, dr, FLOOR + DOOR_H, CEIL);
  face(dr, v0, FLOOR, CEIL);
  face(v0, v1, FLOOR, WINDOW.bottom);
  face(v0, v1, WINDOW.top, CEIL);
  face(v1, xr, FLOOR, CEIL);
  return mergeGeometries(parts)!;
}

/** Wooden floor boards. */
function floorCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rng = alea('floor');
  for (let i = 0; i < 8; i++) {
    const l = 0.82 + rng() * 0.18;
    g.fillStyle = `rgb(${Math.round(150 * l)},${Math.round(112 * l)},${Math.round(76 * l)})`;
    g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = 'rgba(60,40,25,0.55)';
    g.fillRect(0, i * 32, 256, 1.5);
    const joint = rng() * 256;
    g.fillRect(joint, i * 32, 1.5, 32);
    g.strokeStyle = 'rgba(90,60,35,0.18)';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      const y = i * 32 + 4 + rng() * 24;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + rng() * 6 - 3, 170, y + rng() * 6 - 3, 256, y);
      g.stroke();
    }
  }
  return c;
}

/** Soft pool of light from a gallery spot, for additive planes on the wall. */
function spotCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 40, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,236,200,1)');
  grad.addColorStop(0.55, 'rgba(255,226,180,0.45)');
  grad.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** Things every marina house shares (built once). */
export class MarinaHouseAssets {
  readonly outside = new THREE.MeshStandardMaterial({ color: srgb(MARINA_HOUSE.color), roughness: 0.85, flatShading: true });
  readonly trim = new THREE.MeshStandardMaterial({ color: srgb(0xdedad0), roughness: 0.8 });
  readonly stone = new THREE.MeshStandardMaterial({ color: srgb(0x8d8a83), roughness: 0.95, flatShading: true });
  readonly glassOutside = new THREE.MeshStandardMaterial({ color: srgb(0x1a2228), roughness: 0.25, metalness: 0.2, emissive: srgb(0xffb466), emissiveIntensity: 0 });
  readonly glassInside = new THREE.MeshBasicMaterial({ color: srgb(0xdfeaf2) });
  readonly door = new THREE.MeshStandardMaterial({ color: srgb(0x23395b), roughness: 0.6 });
  readonly brass = new THREE.MeshStandardMaterial({ color: srgb(0xc9a24a), roughness: 0.3, metalness: 0.8 });
  readonly walls = new THREE.MeshBasicMaterial({ color: srgb(0xf0ece4), vertexColors: true });
  readonly ceiling = new THREE.MeshBasicMaterial({ color: srgb(0xe2dfd8) });
  readonly floor: THREE.MeshBasicMaterial;
  readonly skirting = new THREE.MeshBasicMaterial({ color: srgb(0x3b3a38) });
  readonly frame = new THREE.MeshBasicMaterial({ color: srgb(0x1d1c1b) });
  readonly mat = new THREE.MeshBasicMaterial({ color: srgb(0xf7f5ef) });
  readonly bench = new THREE.MeshBasicMaterial({ color: srgb(0x6f5038) });
  readonly benchLegs = new THREE.MeshBasicMaterial({ color: srgb(0x2a2a2a) });
  readonly lamp = new THREE.MeshBasicMaterial({ color: srgb(0x2d2d2d) });
  readonly spot: THREE.MeshBasicMaterial;
  readonly signFrame = new THREE.MeshStandardMaterial({ color: srgb(0xc9a24a), roughness: 0.4, metalness: 0.6 });

  constructor() {
    const floor = canvasTexture(floorCanvas());
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(W / 2.4, D / 2.4);
    this.floor = new THREE.MeshBasicMaterial({ map: floor, color: srgb(0xdedede) });
    this.spot = new THREE.MeshBasicMaterial({ map: canvasTexture(spotCanvas()), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  /** Per frame: lit windows at night, darker glass from inside. */
  setNight(night: number): void {
    this.glassOutside.emissiveIntensity = night * 1.4;
    this.glassInside.color.copy(srgb(0xdfeaf2)).lerp(srgb(0x101a2c), night);
  }
}

// ---- Canvas pictures ------------------------------------------------------------------------------

/** Word-wrapped lines of `text` (paragraphs kept) for the current font. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
    lines.push(''); // paragraph gap
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Writes `text` in the largest font (≤ max px) that fits on one line of `width`. */
function fitLine(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, max: number, font: (px: number) => string): void {
  let px = max;
  g.font = font(px);
  while (px > 10 && g.measureText(text).width > width) g.font = font((px -= 2));
  g.fillText(text, x, y);
}

const SERIF = (px: number, weight = 600) => `${weight} ${px}px Georgia, 'Times New Roman', serif`;
const SANS = (px: number, weight = 400) => `${weight} ${px}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** The name board over the door. */
function signCanvas(name: string, isHarbour: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * HOUSE_SIGN.height) / HOUSE_SIGN.width);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d3557';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#e9c46a';
  g.lineWidth = 5;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#f4f1e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitLine(g, name, c.width / 2, c.height * 0.43, c.width - 90, 92, (px) => SERIF(px));
  g.fillStyle = '#e9c46a';
  g.font = SANS(24, 600);
  g.letterSpacing = '8px';
  g.fillText(isHarbour ? 'HARBOUR OFFICE' : 'MARINA OFFICE', c.width / 2, c.height * 0.82);
  return c;
}

/** Stand-in for a photo that isn't there (nothing found, offline): a little seascape painting. */
function seascapeCanvas(seed: string): HTMLCanvasElement {
  const rng = alea(seed);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const g = c.getContext('2d')!;
  const dusk = rng() < 0.35;
  const horizon = c.height * (0.48 + rng() * 0.14);
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, dusk ? '#3b4a7a' : '#6f9fc8');
  sky.addColorStop(1, dusk ? '#f0a46a' : '#dfe9ee');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, horizon);
  const sunX = c.width * (0.2 + rng() * 0.6);
  g.fillStyle = dusk ? 'rgba(255,214,150,0.9)' : 'rgba(255,250,230,0.85)';
  g.beginPath();
  g.arc(sunX, horizon - 30 - rng() * 60, 18 + rng() * 14, 0, Math.PI * 2);
  g.fill();
  // Clouds: soft dabs.
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(255,255,255,${0.08 + rng() * 0.18})`;
    g.beginPath();
    g.ellipse(rng() * c.width, rng() * horizon * 0.7, 30 + rng() * 60, 8 + rng() * 14, 0, 0, Math.PI * 2);
    g.fill();
  }
  const sea = g.createLinearGradient(0, horizon, 0, c.height);
  sea.addColorStop(0, dusk ? '#4a5a7a' : '#3f7392');
  sea.addColorStop(1, dusk ? '#1d2840' : '#1f4660');
  g.fillStyle = sea;
  g.fillRect(0, horizon, c.width, c.height - horizon);
  // Brush strokes for waves, the sun's glitter.
  for (let i = 0; i < 160; i++) {
    const y = horizon + Math.pow(rng(), 1.6) * (c.height - horizon);
    const near = (y - horizon) / (c.height - horizon);
    const glitter = Math.abs(rng() * c.width - sunX) < 40 + near * 60;
    g.strokeStyle = glitter ? 'rgba(255,240,200,0.55)' : `rgba(255,255,255,${0.06 + rng() * 0.12})`;
    g.lineWidth = 1 + near * 3;
    const x = glitter ? sunX + (rng() - 0.5) * (80 + near * 120) : rng() * c.width;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 10 + near * 40, y + (rng() - 0.5) * 2);
    g.stroke();
  }
  // A sailing boat.
  const bx = c.width * (0.15 + rng() * 0.7);
  const by = horizon + 18 + rng() * 40;
  const s = 0.7 + rng() * 0.6;
  g.fillStyle = '#2b2b2b';
  g.beginPath();
  g.moveTo(bx - 26 * s, by);
  g.lineTo(bx + 26 * s, by);
  g.lineTo(bx + 18 * s, by + 7 * s);
  g.lineTo(bx - 20 * s, by + 7 * s);
  g.fill();
  g.fillStyle = '#f6f1e4';
  g.beginPath();
  g.moveTo(bx, by - 2);
  g.lineTo(bx, by - 62 * s);
  g.lineTo(bx + 24 * s, by - 2);
  g.fill();
  g.beginPath();
  g.moveTo(bx - 3, by - 2);
  g.lineTo(bx - 3, by - 50 * s);
  g.lineTo(bx - 22 * s, by - 2);
  g.fill();
  return c;
}

/** Gallery label next to a picture: title, photographer, licence. */
function labelCanvas(title: string, line2: string, line3: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1c1c1c';
  g.textBaseline = 'top';
  g.font = SANS(32, 600);
  const lines = wrap(g, title, c.width - 40).slice(0, 2);
  lines.forEach((l, i) => g.fillText(l, 20, 16 + i * 38));
  g.fillStyle = '#4a4a4a';
  const y = 16 + lines.length * 38 + 8;
  fitLine(g, line2, 20, y, c.width - 40, 24, (px) => SANS(px));
  fitLine(g, line3, 20, y + 30, c.width - 40, 22, (px) => SANS(px, 300));
  return c;
}

/** The poster: the place's name, the Wikipedia intro and its attribution. */
function posterCanvas(name: string, info: MarinaInfo | undefined): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = Math.round((900 * 1.9) / 1.35);
  const g = c.getContext('2d')!;
  const pad = 56;
  g.fillStyle = '#f7f4ec';
  g.fillRect(0, 0, c.width, c.height);
  // Header band.
  g.fillStyle = '#1d3557';
  g.fillRect(0, 0, c.width, 230);
  g.fillStyle = '#e9c46a';
  g.font = SANS(26, 600);
  g.letterSpacing = '6px';
  g.textBaseline = 'top';
  g.fillText('WELCOME TO', pad, 50);
  g.letterSpacing = '0px';
  g.fillStyle = '#f4f1e8';
  fitLine(g, name, pad, 92, c.width - pad * 2, 76, (px) => SERIF(px));
  const article = info?.article;
  let y = 280;
  g.fillStyle = '#1c1c1c';
  if (article) {
    fitLine(g, article.title, pad, y, c.width - pad * 2, 50, (px) => SERIF(px));
    y += 74;
    g.fillStyle = '#c9a24a';
    g.fillRect(pad, y, 120, 4);
    y += 34;
  }
  const body = article?.text ?? 'Sorry — we have no information about this place yet. Enjoy the harbour, and fair winds!';
  const footer = 140;
  const room = c.height - footer - y;
  // Largest font for which the text fits; cut the last line if even the smallest doesn't.
  let px = 34;
  let lines: string[] = [];
  for (; px >= 20; px -= 2) {
    g.font = SERIF(px, 400);
    lines = wrap(g, body, c.width - pad * 2);
    if (lines.length * px * 1.42 <= room) break;
  }
  const lh = px * 1.42;
  const max = Math.floor(room / lh);
  if (lines.length > max) {
    lines = lines.slice(0, max);
    lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, ' …');
  }
  g.fillStyle = '#262626';
  lines.forEach((l, i) => g.fillText(l, pad, y + i * lh));
  // Attribution, as the licence asks.
  g.fillStyle = '#d9d3c4';
  g.fillRect(pad, c.height - footer + 20, c.width - pad * 2, 2);
  g.fillStyle = '#5a5a5a';
  if (article) {
    fitLine(g, `Text: Wikipedia, “${article.title}”`, pad, c.height - footer + 42, c.width - pad * 2, 24, (px) => SANS(px));
    fitLine(g, `CC BY-SA 4.0 · ${article.url.replace('https://', '')}`, pad, c.height - footer + 76, c.width - pad * 2, 20, (px) => SANS(px, 300));
  } else {
    fitLine(g, 'Marina office', pad, c.height - footer + 42, c.width - pad * 2, 24, (px) => SANS(px));
  }
  return c;
}

// ---- The house -------------------------------------------------------------------------------------

interface Picture {
  mesh: THREE.Mesh;
  label: THREE.Mesh;
  url?: string;
}

export class MarinaHouseModel {
  readonly group = new THREE.Group();
  /** the door leaf (click to open/close); rotates around its hinge */
  readonly door = new THREE.Group();
  doorOpen = false;
  /** everything inside, hidden while the player is further away */
  private readonly inside = new THREE.Group();
  private doorAmount = 0;
  private readonly pictures: Picture[] = [];
  private signMaterial?: THREE.MeshStandardMaterial;
  private readonly owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private disposed = false;

  constructor(
    site: MarinaHouseSite,
    private readonly harbor: { id: number; name: string; isHarbour: boolean },
    private readonly assets: MarinaHouseAssets,
    private readonly store: MarinaInfoStore,
    info: Promise<MarinaInfo | undefined>,
  ) {
    this.group.position.set(site.x, site.y, site.z);
    this.group.rotation.y = site.rotY;
    this.buildShell();
    this.buildInside();
    this.buildSign();
    this.group.add(this.inside);
    void info.then((i) => this.show(i));
  }

  /** The doorway is open enough to walk through. */
  get passable(): boolean {
    return this.doorOpen && this.doorAmount > 0.8;
  }

  /** @param night 0 day … 1 night: the name board is lit */
  update(dt: number, near: boolean, night: number): void {
    this.inside.visible = near;
    if (this.signMaterial) this.signMaterial.emissiveIntensity = 0.12 + 0.55 * night;
    this.doorAmount = THREE.MathUtils.clamp(this.doorAmount + (this.doorOpen ? dt : -dt) / DOOR_SWING, 0, 1);
    // Swings inwards and folds back against the wall.
    this.door.rotation.y = THREE.MathUtils.smoothstep(this.doorAmount, 0, 1) * Math.PI * 0.93;
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
    for (const p of this.pictures) if (p.url) this.store.release(p.url);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.group): THREE.Mesh {
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  }

  private texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const t = canvasTexture(canvas);
    this.owned.push(t);
    return t;
  }

  private basic(map: THREE.Texture, color = 0xffffff): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map, color: srgb(color) });
    this.owned.push(m);
    return m;
  }

  /** Walls (with the door and window holes), floor slab, window panes and sills; the door. */
  private buildShell(): void {
    const a = this.assets;
    const hw = W / 2;
    const hd = D / 2;
    const dh = HOUSE_DOOR.halfWidth;
    const walls: THREE.BufferGeometry[] = [
      slab(-hw, hw, 0, H, -hd, -hd + T), // back
      slab(-hw, -hw + T, 0, H, -hd + T, hd - T), // sides
      slab(hw - T, hw, 0, H, -hd + T, hd - T),
      slab(-dh, dh, FLOOR + DOOR_H, H, hd - T, hd), // over the door
      slab(-hw + T, hw - T, 0, FLOOR, -hd + T, hd - T), // floor slab
    ];
    // Front wall around the door and the two windows.
    const cuts = [-hw, ...FRONT_WINDOWS.flatMap((x) => [x - WINDOW.width / 2, x + WINDOW.width / 2]), hw];
    cuts.splice(3, 0, -dh, dh); // [-hw, w0l, w0r, -dh, dh, w1l, w1r, hw]
    const piece = (x0: number, x1: number, y0: number, y1: number) => walls.push(slab(x0, x1, y0, y1, hd - T, hd));
    piece(cuts[0], cuts[1], 0, H);
    piece(cuts[1], cuts[2], 0, WINDOW.bottom);
    piece(cuts[1], cuts[2], WINDOW.top, H);
    piece(cuts[2], cuts[3], 0, H);
    piece(cuts[4], cuts[5], 0, H);
    piece(cuts[5], cuts[6], 0, WINDOW.bottom);
    piece(cuts[5], cuts[6], WINDOW.top, H);
    piece(cuts[6], cuts[7], 0, H);
    const shell = this.mesh(mergeGeometries(walls)!, a.outside);
    shell.castShadow = shell.receiveShadow = true;

    // Stone plinth reaching well into the ground (the terrain near the shore may be lower than the
    // base), and the steps up to the door: a landing, then stairs down until they vanish in the ground.
    const deep = -3;
    const st = HOUSE_STEPS;
    const stones = [slab(-hw - 0.04, hw + 0.04, deep, FLOOR - 0.01, -hd - 0.04, hd + 0.04), slab(-st.halfWidth, st.halfWidth, deep, FLOOR - 0.005, hd, hd + st.landing)];
    for (let i = 1; i <= st.count; i++) {
      const z0 = hd + st.landing + (i - 1) * st.run;
      stones.push(slab(-st.halfWidth, st.halfWidth, deep - i * st.rise, FLOOR - (i - 0.5) * st.rise, z0, z0 + st.run));
    }
    const plinth = this.mesh(mergeGeometries(stones)!, a.stone);
    plinth.receiveShadow = true;

    // Glass: the front windows go through the wall (seen from both sides); the upper storey and the
    // side walls get panes on the outside only (there is no upstairs, and the gallery has no windows).
    const outside: THREE.BufferGeometry[] = [];
    const sills: THREE.BufferGeometry[] = [];
    for (const x of FRONT_WINDOWS) {
      outside.push(slab(x - WINDOW.width / 2, x + WINDOW.width / 2, WINDOW.bottom, WINDOW.top, hd - T / 2 - 0.01, hd - T / 2 + 0.01));
      sills.push(slab(x - WINDOW.width / 2 - 0.08, x + WINDOW.width / 2 + 0.08, WINDOW.bottom - 0.07, WINDOW.bottom, hd - 0.02, hd + 0.08));
    }
    const upper = (x: number, z: number, alongX: boolean) => {
      const half = UPPER_WINDOW.width / 2;
      outside.push(
        alongX
          ? slab(x - half, x + half, UPPER_WINDOW.bottom, UPPER_WINDOW.top, z - 0.01, z + 0.01)
          : slab(x - 0.01, x + 0.01, UPPER_WINDOW.bottom, UPPER_WINDOW.top, z - half, z + half),
      );
    };
    for (const x of [-3.4, 0, 3.4]) {
      upper(x, hd + 0.005, true);
      upper(x, -hd - 0.005, true);
    }
    for (const z of [-1.8, 1.8]) {
      upper(-hw - 0.005, z, false);
      upper(hw + 0.005, z, false);
      outside.push(slab(-hw - 0.015, -hw - 0.005, WINDOW.bottom, WINDOW.top, z - 0.6, z + 0.6));
      outside.push(slab(hw + 0.005, hw + 0.015, WINDOW.bottom, WINDOW.top, z - 0.6, z + 0.6));
    }
    this.mesh(mergeGeometries(outside)!, a.glassOutside);
    this.mesh(mergeGeometries(sills)!, a.trim);

    // Door frame and step.
    this.mesh(
      mergeGeometries([
        slab(-dh - 0.1, -dh, 0, FLOOR + DOOR_H + 0.1, hd - 0.02, hd + 0.06),
        slab(dh, dh + 0.1, 0, FLOOR + DOOR_H + 0.1, hd - 0.02, hd + 0.06),
        slab(-dh - 0.1, dh + 0.1, FLOOR + DOOR_H, FLOOR + DOOR_H + 0.1, hd - 0.02, hd + 0.06),
      ])!,
      a.trim,
    );

    // Door leaf, hinged on the left (−X) post at the inner face of the wall (so it can fold back
    // flat against it), with a small window and a brass handle on both sides.
    this.door.position.set(-dh, FLOOR, hd - T + 0.04);
    this.group.add(this.door);
    const leafW = DOOR_W - 0.02;
    const leafH = DOOR_H - 0.02;
    const leaf = this.mesh(new THREE.BoxGeometry(leafW, leafH, 0.06).translate(leafW / 2 + 0.01, leafH / 2, 0), a.door, this.door);
    leaf.castShadow = true;
    this.mesh(new THREE.BoxGeometry(0.5, 0.6, 0.07).translate(leafW / 2 + 0.01, leafH * 0.72, 0), a.glassOutside, this.door);
    this.mesh(new THREE.BoxGeometry(0.14, 0.04, 0.16).translate(leafW - 0.12, 1.05, 0), a.brass, this.door);
  }

  /** Lining, floor, ceiling, skirting, lamps, bench, window glass seen from inside. */
  private buildInside(): void {
    const a = this.assets;
    const x0 = -W / 2 + T + 0.01;
    const x1 = W / 2 - T - 0.01;
    const z0 = -D / 2 + T + 0.01;
    const z1 = D / 2 - T - 0.01;
    // Walls: the back one a touch brighter (it faces the lamps), the sides a touch darker.
    this.mesh(
      mergeGeometries([
        wallFace(x0, z0, x1, z0, FLOOR, CEIL, 1), // back, facing +Z
        wallFace(x0, z1, x0, z0, FLOOR, CEIL, 0.93), // left, facing +X
        wallFace(x1, z0, x1, z1, FLOOR, CEIL, 0.93), // right, facing -X
        frontInside(0.88),
      ])!,
      a.walls,
      this.inside,
    );
    const floor = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate(0, FLOOR + 0.002, 0);
    this.mesh(floor, a.floor, this.inside);
    const ceiling = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate(0, CEIL, 0);
    this.mesh(ceiling, a.ceiling, this.inside);
    const k = 0.1; // skirting height
    this.mesh(
      mergeGeometries([
        slab(x0, x1, FLOOR, FLOOR + k, z0, z0 + 0.015),
        slab(x0, x0 + 0.015, FLOOR, FLOOR + k, z0, z1),
        slab(x1 - 0.015, x1, FLOOR, FLOOR + k, z0, z1),
        slab(x0, -HOUSE_DOOR.halfWidth, FLOOR, FLOOR + k, z1 - 0.015, z1),
        slab(HOUSE_DOOR.halfWidth, x1, FLOOR, FLOOR + k, z1 - 0.015, z1),
      ])!,
      a.skirting,
      this.inside,
    );
    // The front windows from inside: daylight (dark at night).
    for (const x of FRONT_WINDOWS) {
      const pane = new THREE.PlaneGeometry(WINDOW.width, WINDOW.top - WINDOW.bottom).rotateY(Math.PI).translate(x, (WINDOW.bottom + WINDOW.top) / 2, D / 2 - T / 2 - 0.02);
      this.mesh(pane, a.glassInside, this.inside);
    }
    // Gallery bench: a wooden seat on two dark legs.
    const b = GALLERY_BENCH;
    this.mesh(slab(-b.halfWidth, b.halfWidth, FLOOR + b.top - 0.06, FLOOR + b.top, b.z - b.halfDepth, b.z + b.halfDepth), a.bench, this.inside);
    this.mesh(
      mergeGeometries([-1, 1].map((s) => slab(s * (b.halfWidth - 0.25) - 0.04, s * (b.halfWidth - 0.25) + 0.04, FLOOR, FLOOR + b.top - 0.06, b.z - b.halfDepth + 0.04, b.z + b.halfDepth - 0.04)))!,
      a.benchLegs,
      this.inside,
    );
    // Ceiling track with spots, one per wall.
    this.mesh(
      mergeGeometries([
        slab(-3.6, 3.6, CEIL - 0.04, CEIL, -1.3, -1.25),
        slab(-3.6, 3.6, CEIL - 0.04, CEIL, 1.25, 1.3),
        ...[-3.5, 0, 3.5].map((x) => new THREE.CylinderGeometry(0.06, 0.08, 0.2, 8).rotateX(0.5).translate(x, CEIL - 0.16, -1.28)),
        ...[-2.2, 2.2].map((x) => new THREE.CylinderGeometry(0.06, 0.08, 0.2, 8).rotateZ(x < 0 ? -0.5 : 0.5).translate(x * 1.8, CEIL - 0.16, 1.28)),
      ])!,
      a.lamp,
      this.inside,
    );
  }

  private buildSign(): void {
    const s = HOUSE_SIGN;
    const tex = this.texture(signCanvas(this.harbor.name, this.harbor.isHarbour));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    this.owned.push(mat);
    this.signMaterial = mat;
    const z = D / 2;
    this.mesh(new THREE.BoxGeometry(s.width + 0.1, s.height + 0.1, 0.05).translate(0, s.centreY, z + 0.025), this.assets.signFrame);
    this.mesh(new THREE.PlaneGeometry(s.width, s.height).translate(0, s.centreY, z + 0.052), mat);
  }

  /** Fills the walls: photos where there are some, seascape paintings in the other frames; the poster. */
  private show(info: MarinaInfo | undefined): void {
    if (this.disposed) return;
    const photos = info?.photos ?? [];
    let p = 0;
    for (const [i, slot] of WALL_SLOTS.entries()) {
      if (slot.kind === 'poster') {
        this.addPoster(slot, info);
        continue;
      }
      const photo = photos[p++];
      if (photo) {
        const pic = this.addPicture(slot, photo.aspect, seascapeCanvas(`${this.harbor.id}:${i}`), labelCanvas(photo.title, `Photo: ${photo.artist}`, `${photo.license} · Wikimedia Commons`));
        pic.url = photo.url;
        void this.store.photo(photo.url).then((canvas) => {
          if (!canvas || this.disposed) return;
          const mat = pic.mesh.material as THREE.MeshBasicMaterial;
          mat.map = this.texture(canvas);
          mat.needsUpdate = true;
        });
      } else {
        this.addPicture(slot, 0.75, seascapeCanvas(`${this.harbor.id}:${i}`), labelCanvas('Seascape', 'Oil on canvas', 'From the marina’s own collection'));
      }
    }
  }

  /** Placement of a slot as a matrix: local +Z = out of the wall into the room. */
  private slotGroup(slot: WallSlot): THREE.Group {
    const g = new THREE.Group();
    g.position.set(slot.x, slot.y, slot.z);
    g.rotation.y = slot.rotY;
    g.translateZ(0.012); // in front of the wall lining
    this.inside.add(g);
    return g;
  }

  private addPicture(slot: WallSlot, aspect: number, picture: HTMLCanvasElement, label: HTMLCanvasElement): Picture {
    const a = this.assets;
    const { width, height } = fitPicture(slot, aspect);
    const g = this.slotGroup(slot);
    // Light pool from the spot above, then frame, mat and the picture.
    this.mesh(new THREE.PlaneGeometry(width + 1.6, height + 1.7).translate(0, 0.25, 0.004), a.spot, g);
    this.mesh(new THREE.BoxGeometry(width + 0.2, height + 0.2, 0.04).translate(0, 0, 0.02), a.frame, g);
    this.mesh(new THREE.PlaneGeometry(width + 0.14, height + 0.14).translate(0, 0, 0.041), a.mat, g);
    const mesh = this.mesh(new THREE.PlaneGeometry(width, height).translate(0, 0, 0.043), this.basic(this.texture(picture)), g);
    // Label to the lower right, like in a museum.
    const lw = 0.44;
    const lh = (lw * label.height) / label.width;
    const labelMesh = this.mesh(new THREE.PlaneGeometry(lw, lh).translate(width / 2 + 0.1 + lw / 2, -height / 2 + lh / 2, 0.003), this.basic(this.texture(label)), g);
    const pic = { mesh, label: labelMesh };
    this.pictures.push(pic);
    return pic;
  }

  private addPoster(slot: WallSlot, info: MarinaInfo | undefined): void {
    const g = this.slotGroup(slot);
    const w = slot.maxWidth;
    const h = slot.maxHeight;
    this.mesh(new THREE.PlaneGeometry(w + 1.4, h + 1.4).translate(0, 0.25, 0.004), this.assets.spot, g);
    this.mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03).translate(0, 0, 0.015), this.assets.brass, g);
    this.mesh(new THREE.PlaneGeometry(w, h).translate(0, 0, 0.032), this.basic(this.texture(posterCanvas(this.harbor.name, info))), g);
  }
}
