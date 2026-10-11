import * as THREE from 'three';
import { ENGINE, FUEL_CAPACITY, type Engine } from '../boat/engine';

const W = 512;
const H = 210; // same aspect as the gauge screen on the engine panel
const REFRESH = 0.12;
const FONT = 'system-ui, -apple-system, sans-serif';

/**
 * The engine panel's gauges: rev counter, fuel gauge, and the warning lights (oil pressure and
 * battery charge light up with the key on and the engine stopped; LOW FUEL; NEUTRAL). A small canvas
 * redrawn a few times per second while the player is near.
 */
export class EngineDisplay {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private since = Infinity;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.draw(null);
  }

  update(dt: number, engine: Engine, visible: boolean): void {
    this.since += dt;
    if (!visible || this.since < REFRESH) return;
    this.since = 0;
    this.draw(engine);
    this.texture.needsUpdate = true;
  }

  private draw(engine: Engine | null): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0d10';
    ctx.fillRect(0, 0, W, H);
    const powered = !!engine?.ignition;
    // Rev counter, 0 … 3500 rpm.
    this.gauge(110, 112, 88, (engine?.rpm ?? 0) / 3500, ['0', '1', '2', '3'], 'RPM ×1000', powered, (k) => k > ENGINE.maxRpm / 3500);
    // Fuel, E … F; the bottom quarter in red.
    this.gauge(W - 110, 112, 88, (engine?.fuel ?? 0) / FUEL_CAPACITY, ['E', '½', 'F'], 'FUEL', powered, (k) => k < 0.2);
    // Warning lights between the gauges.
    const lights: Array<[string, string, boolean]> = [
      ['OIL', '#ff3b30', !!engine?.warnings],
      ['BATT', '#ffb020', !!engine?.warnings],
      ['LOW FUEL', '#ffb020', powered && (engine?.fuel ?? 0) < FUEL_CAPACITY * 0.15],
      ['NEUTRAL', '#34c759', powered && !!engine?.inNeutral],
    ];
    ctx.textAlign = 'center';
    ctx.font = `700 15px ${FONT}`;
    lights.forEach(([label, color, on], i) => {
      const y = 40 + i * 44;
      ctx.fillStyle = on ? color : '#1f262c';
      ctx.beginPath();
      ctx.roundRect(W / 2 - 44, y - 16, 88, 30, 6);
      ctx.fill();
      ctx.fillStyle = on ? '#0a0d10' : '#46525c';
      ctx.fillText(label, W / 2, y + 5);
    });
  }

  /** Round dial with a needle at k (0 … 1) over a 240° sweep. */
  private gauge(cx: number, cy: number, r: number, k: number, labels: string[], title: string, lit: boolean, red: (k: number) => boolean): void {
    const ctx = this.ctx;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    ctx.fillStyle = lit ? '#121a20' : '#0d1215';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Scale, with the red zone.
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const a = a0 + t * sweep;
      ctx.strokeStyle = red(t) ? '#e0443e' : lit ? '#e8f1f5' : '#5b6670';
      ctx.lineWidth = i % 5 === 0 ? 3 : 1.5;
      const r0 = i % 5 === 0 ? r - 16 : r - 9;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
      ctx.stroke();
    }
    ctx.fillStyle = lit ? '#e8f1f5' : '#5b6670';
    ctx.font = `600 16px ${FONT}`;
    ctx.textAlign = 'center';
    labels.forEach((label, i) => {
      const a = a0 + (i / (labels.length - 1)) * sweep;
      ctx.fillText(label, cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30) + 6);
    });
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(title, cx, cy + r * 0.62);
    const a = a0 + Math.max(0, Math.min(1, k)) * sweep;
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10);
    ctx.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
    ctx.stroke();
    ctx.fillStyle = '#2a333a';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}
