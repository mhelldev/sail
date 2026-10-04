import * as THREE from 'three';
import type { Boat } from '../boat/boat';
import { polarFactor, relativeWind, windAngle } from '../boat/sailing';
import type { Harbor } from '../harbors/harborData';
import type { Wind } from '../weather/wind';
import type { Minimap } from './minimap';

const MS_TO_KNOTS = 1.943844;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

const W = 1024;
const H = 716; // same aspect as the screen on the boat (0.8 × 0.56 m)
const MAP = 600; // chart plotter, square, top left
const REFRESH = 0.2; // seconds between redraws (and texture uploads)

const FONT = 'system-ui, -apple-system, sans-serif';
const INK = '#e8f1f5';
const DIM = '#7f97a6';
const ACCENT = '#ffd166';
const WARN = '#ff6b6b';

export interface NavInfo {
  lat: number;
  lon: number;
  /** Signed distance to the coast in metres, positive on land. */
  coastDistance: number;
  maxDistance: number;
  grounded: boolean;
  nearestHarbor?: { harbor: Harbor; distance: number };
}

function formatCoord(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const deg = Math.floor(a);
  const min = (a - deg) * 60;
  return `${deg}°${min.toFixed(2).padStart(5, '0')}′${v >= 0 ? pos : neg}`;
}

const formatDistance = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);

function pointOfSail(angle: number): string {
  if (angle < 35) return 'In irons';
  if (angle < 60) return 'Close-hauled';
  if (angle < 80) return 'Close reach';
  if (angle < 110) return 'Beam reach';
  if (angle < 155) return 'Broad reach';
  return 'Running';
}

/**
 * The boat's instruments as one screen on the deckhouse's aft wall: a chart plotter (the map, position,
 * coast and harbour), a wind instrument, the log (speed, heading) and the sail trim. Drawn into a
 * canvas a few times per second and shown as a texture; the screen lights itself (no tone mapping).
 */
export class InstrumentPanel {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private sinceDraw = Infinity;
  private mapDt = 0;

  constructor(private readonly chart: Minimap) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4; // usually seen at an angle
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
  }

  /**
   * @param nav asked for only when the screen is redrawn
   * @param visible false while the player is far from the boat: then nothing is drawn or uploaded
   */
  update(dt: number, boat: Boat, wind: Wind, nav: () => NavInfo, visible: boolean): void {
    this.sinceDraw += dt;
    this.mapDt += dt;
    if (!visible || this.sinceDraw < REFRESH) return;
    this.sinceDraw = 0;
    this.chart.update(this.mapDt, boat.position.x, boat.position.z, boat.state.heading);
    this.mapDt = 0;
    this.draw(boat, wind, nav());
    this.texture.needsUpdate = true;
  }

  private draw(boat: Boat, wind: Wind, nav: NavInfo): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#081016';
    ctx.fillRect(0, 0, W, H);

    // Chart plotter.
    const m = 20;
    ctx.drawImage(this.chart.canvas, m, m, MAP, MAP);
    ctx.strokeStyle = '#1f3442';
    ctx.lineWidth = 2;
    ctx.strokeRect(m, m, MAP, MAP);
    ctx.font = `600 22px ${FONT}`;
    ctx.textAlign = 'right';
    this.label(this.chart.rangeLabel, m + MAP - 12, m + MAP - 14, INK);
    ctx.textAlign = 'left';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(`${formatCoord(nav.lat, 'N', 'S')}   ${formatCoord(nav.lon, 'E', 'W')}`, m, H - 52);
    const d = Math.abs(nav.coastDistance);
    const coast = nav.grounded
      ? 'AGROUND · turn away from the shore'
      : `Coast ${d >= nav.maxDistance ? `> ${nav.maxDistance / 1000} km` : formatDistance(d)}`;
    ctx.fillStyle = nav.grounded || nav.coastDistance > -100 ? WARN : DIM;
    ctx.fillText(coast, m, H - 18);
    const h = nav.nearestHarbor;
    if (h) {
      ctx.textAlign = 'right';
      ctx.fillStyle = DIM;
      ctx.fillText(`⚓ ${h.harbor.name} · ${formatDistance(h.distance)}`, m + MAP, H - 18);
    }

    // Right column: wind, log, sail.
    const x0 = m + MAP + 24;
    const cx = (x0 + W - m) / 2;
    const { heading, speed } = boat.state;
    this.windDial(cx, 150, 118, relativeWind(heading, wind.direction));
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(`${(wind.speed * MS_TO_KNOTS).toFixed(0)} kn from ${compass(wind.direction)}`, cx, 304);

    ctx.fillStyle = DIM;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText('SPEED', cx, 352);
    ctx.fillStyle = INK;
    ctx.font = `700 104px ${FONT}`;
    ctx.fillText((speed * MS_TO_KNOTS).toFixed(1), cx - 24, 448);
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = DIM;
    ctx.textAlign = 'left';
    ctx.fillText('kn', cx + 76, 448);
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(`HDG ${Math.round(heading).toString().padStart(3, '0')}° ${compass(heading)}`, cx, 506);

    const angle = windAngle(heading, wind.direction);
    ctx.font = `600 28px ${FONT}`;
    ctx.fillStyle = boat.turbo ? ACCENT : INK;
    ctx.fillText(boat.turbo ? 'TURBO' : boat.sailUp ? pointOfSail(angle) : 'Sail down', cx, 574);
    const barW = W - m - x0 - 20;
    ctx.fillStyle = '#1a2a35';
    ctx.fillRect(x0 + 10, 598, barW, 16);
    ctx.fillStyle = '#5cc8a1';
    ctx.fillRect(x0 + 10, 598, barW * (boat.sailUp ? polarFactor(angle) : 0), 16);
    ctx.fillStyle = DIM;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText('SAIL TRIM', cx, 646);
  }

  /** Text with a dark outline, readable on any map colour. */
  private label(text: string, x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#081016';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** Relative wind: the boat from above, the arrow on the side the wind comes from, pointing at it. */
  private windDial(cx: number, cy: number, r: number, relDeg: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = '#2b4352';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    // Close-hauled sectors (red to port, green to starboard).
    ctx.lineWidth = 10;
    for (const [from, to, color] of [[-60, -30, '#c0392b'], [30, 60, '#27ae60']] as const) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r - 8, ((from - 90) * Math.PI) / 180, ((to - 90) * Math.PI) / 180);
      ctx.stroke();
    }
    ctx.fillStyle = '#c9d6de';
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.bezierCurveTo(18, -26, 20, 18, 13, 48);
    ctx.lineTo(-13, 48);
    ctx.bezierCurveTo(-20, 18, -18, -26, 0, -52);
    ctx.fill();
    ctx.rotate((relDeg * Math.PI) / 180);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(0, -60);
    ctx.lineTo(16, -88);
    ctx.lineTo(5, -88);
    ctx.lineTo(5, -r + 6);
    ctx.lineTo(-5, -r + 6);
    ctx.lineTo(-5, -88);
    ctx.lineTo(-16, -88);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
