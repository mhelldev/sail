import type { Coastline } from '../geo/coastline';

const SIZE = 180; // CSS pixels
const RES = 120; // land samples per side
const RANGES = [5000, 15000, 40000, 120000]; // metres from centre to edge
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
    this.label.textContent = `${range >= 1000 ? range / 1000 + ' km' : range + ' m'}`;
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
