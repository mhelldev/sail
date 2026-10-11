import * as THREE from 'three';

const W = 160;
const H = 80;

/**
 * The VHF's little LCD (shared by the set in the cabin and the remote unit in the cockpit): channel 16
 * with dual watch, an RX marker while a transmission comes in, blank when switched off. Only redrawn
 * when something changes.
 */
export class VhfDisplay {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private shown = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.update(false, false);
  }

  update(power: boolean, receiving: boolean): void {
    const key = `${power}${receiving}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.ctx;
    ctx.fillStyle = power ? '#9fc58a' : '#2c3329'; // backlit LCD, dark when off
    ctx.fillRect(0, 0, W, H);
    if (power) {
      ctx.fillStyle = '#1d2a18';
      ctx.font = '700 54px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('16', 12, 62);
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.fillText('DW', 92, 30);
      ctx.fillText('25W', 92, 66);
      if (receiving) {
        ctx.fillRect(126, 14, 28, 20);
        ctx.fillStyle = '#9fc58a';
        ctx.fillText('RX', 128, 30);
      }
    }
    this.texture.needsUpdate = true;
  }
}
