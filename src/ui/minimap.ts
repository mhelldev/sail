import type { Coastline } from '../geo/coastline';
import type { HarborData } from '../harbors/harborData';

const SIZE = 180; // CSS pixels
const RES = 120; // land samples per side
const RANGES = [5000, 15000, 40000, 120000, 400000, 2000000]; // metres from centre to edge
/** Beyond this range harbour and lighthouse dots would only clutter the map. */
const MARKER_RANGE = 120000;
const REFRESH = 0.4; // seconds between land redraws

/** North-up minimap centred on the boat. Land comes from the coastline's crossing test. */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly land = document.createElement('canvas');
  private readonly landCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly label = document.createElement('div');
  private rangeIndex = 1;
  private sinceRefresh = Infinity;
  private landCenter = { x: 0, z: 0 };

  constructor(
    parent: HTMLElement,
    private readonly coast: Coastline,
    private readonly harbors?: HarborData,
  ) {
    const wrap = document.createElement('div');
    wrap.className = 'minimap';
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = this.canvas.height = SIZE * dpr;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.land.width = this.land.height = RES;
    this.landCtx = this.land.getContext('2d')!;
    this.image = this.landCtx.createImageData(RES, RES);
    this.label.className = 'minimap-range';
    wrap.append(this.canvas, this.label);
    parent.appendChild(wrap);
    wrap.title = 'Click to change the range';
    wrap.addEventListener('click', () => this.zoom());
  }

  zoom(): void {
    this.rangeIndex = (this.rangeIndex + 1) % RANGES.length;
    this.sinceRefresh = Infinity;
  }

  update(dt: number, x: number, z: number, headingDeg: number): void {
    const range = RANGES[this.rangeIndex];
    this.sinceRefresh += dt;
    if (this.sinceRefresh >= REFRESH) {
      this.sinceRefresh = 0;
      this.drawLand(x, z, range);
    }

    const ctx = this.ctx;
    const half = SIZE / 2;
    const scale = SIZE / (range * 2);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();
    // The land image was sampled around landCenter; shift it so the boat stays centred.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.land,
      half + (this.landCenter.x - x) * scale - half,
      half + (this.landCenter.z - z) * scale - half,
      SIZE,
      SIZE,
    );
    this.drawHarbors(x, z, range, scale);
    ctx.restore();

    ctx.save();
    ctx.translate(half, half);
    ctx.rotate((headingDeg * Math.PI) / 180);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b1d2a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', half, 13);
    this.label.textContent = range >= 1000 ? `${(range / 1000).toLocaleString('en')} km` : `${range} m`;
  }

  /** Lighthouses as small yellow dots, harbours as anchors-ish markers, names when zoomed in. */
  private drawHarbors(x: number, z: number, range: number, scale: number): void {
    if (!this.harbors || range > MARKER_RANGE) return;
    const ctx = this.ctx;
    const half = SIZE / 2;
    const toScreen = (px: number, pz: number) => [half + (px - x) * scale, half + (pz - z) * scale];
    const r = range * 1.42;
    ctx.fillStyle = '#ffd166';
    for (const l of this.harbors.lighthouses.near(x, z, r)) {
      const [sx, sy] = toScreen(l.x, l.z);
      ctx.beginPath();
      ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    const near = this.harbors.harbors
      .near(x, z, r)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    ctx.lineWidth = 1.2;
    for (const h of near) {
      const [sx, sy] = toScreen(h.x, h.z);
      ctx.fillStyle = h.isHarbour ? '#ffffff' : '#bfe3ff';
      ctx.strokeStyle = '#0b1d2a';
      ctx.beginPath();
      ctx.arc(sx, sy, h.isHarbour ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Names only when zoomed in: closest first, skipping any that would overlap one already drawn.
    if (range > 15000) return;
    ctx.font = '600 9px system-ui, sans-serif';
    const placed: Array<[number, number, number, number]> = [];
    for (const h of near.slice(0, 8)) {
      const [sx, sy] = toScreen(h.x, h.z);
      const w = ctx.measureText(h.name).width;
      // Labels to the right of the marker, or to the left near the right edge; always inside the map.
      const left = sx + 5 + w > SIZE - 12;
      const x0 = Math.min(SIZE - 10 - w, Math.max(10, left ? sx - 5 - w : sx + 5));
      const box: [number, number, number, number] = [x0 - 1, sy - 7, x0 + w + 1, sy + 4];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      placed.push(box);
      ctx.textAlign = 'left';
      ctx.lineWidth = 2.5;
      ctx.strokeText(h.name, x0, sy + 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(h.name, x0, sy + 3);
      if (placed.length >= 4) break;
    }
  }

  private drawLand(x: number, z: number, range: number): void {
    const step = (range * 2) / RES;
    const mask = this.coast.sampleLandMask(x - range + step / 2, z - range + step / 2, step, RES);
    const px = this.image.data;
    for (let i = 0; i < mask.length; i++) {
      const [r, g, b] = mask[i] ? [126, 160, 92] : [22, 74, 104];
      px[i * 4] = r;
      px[i * 4 + 1] = g;
      px[i * 4 + 2] = b;
      px[i * 4 + 3] = 235;
    }
    this.landCtx.putImageData(this.image, 0, 0);
    this.landCenter = { x, z };
  }
}
