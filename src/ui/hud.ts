import type { Boat } from '../boat/boat';
import { polarFactor, relativeWind, windAngle } from '../boat/sailing';
import type { Wind } from '../weather/wind';

const MS_TO_KNOTS = 1.943844;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

export interface NavInfo {
  lat: number;
  lon: number;
  /** Signed distance to the coast in metres, positive on land. */
  coastDistance: number;
  maxDistance: number;
}

function formatCoord(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const deg = Math.floor(a);
  const min = (a - deg) * 60;
  return `${deg}°${min.toFixed(2).padStart(5, '0')}′${v >= 0 ? pos : neg}`;
}

function pointOfSail(angle: number): string {
  if (angle < 35) return 'In irons';
  if (angle < 60) return 'Close-hauled';
  if (angle < 80) return 'Close reach';
  if (angle < 110) return 'Beam reach';
  if (angle < 155) return 'Broad reach';
  return 'Running';
}

export class Hud {
  private readonly speed: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly wind: HTMLElement;
  private readonly sail: HTMLElement;
  private readonly arrow: SVGGElement;
  private readonly efficiency: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly coast: HTMLElement;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-panel">
        <div class="hud-big"><span data-speed>0.0</span><small> kn</small></div>
        <div class="hud-row">Heading <b data-heading></b></div>
        <div class="hud-row">Wind <b data-wind></b></div>
        <div class="hud-row" data-sail></div>
        <div class="hud-row hud-nav" data-pos></div>
        <div class="hud-row hud-nav" data-coast></div>
        <div class="hud-bar"><div data-eff></div></div>
      </div>
      <svg class="hud-wind" viewBox="-50 -50 100 100" aria-label="Relative wind">
        <circle r="44" />
        <path class="hud-boat" d="M0,-24 C8,-12 9,8 6,22 L-6,22 C-9,8 -8,-12 0,-24 Z" />
        <g data-arrow><path class="hud-arrow" d="M0,-20 L7,-33 L2,-33 L2,-46 L-2,-46 L-2,-33 L-7,-33 Z" /></g>
      </svg>
      <div class="hud-help">
        <b>←/→</b> or <b>A/D</b> steer · <b>S</b> sail up/down · <b>T</b> turbo ·
        <b>1</b> chase · <b>2</b> deck · <b>3</b> top · <b>M</b> map range · <b>C</b> coastline · <b>G</b> tuning
      </div>`;
    parent.appendChild(el);
    const q = <T extends Element>(sel: string) => el.querySelector(sel) as T;
    this.speed = q('[data-speed]');
    this.heading = q('[data-heading]');
    this.wind = q('[data-wind]');
    this.sail = q('[data-sail]');
    this.arrow = q('[data-arrow]');
    this.efficiency = q('[data-eff]');
    this.pos = q('[data-pos]');
    this.coast = q('[data-coast]');
  }

  update(boat: Boat, wind: Wind, nav?: NavInfo): void {
    if (nav) {
      this.pos.textContent = `${formatCoord(nav.lat, 'N', 'S')}  ${formatCoord(nav.lon, 'E', 'W')}`;
      const d = Math.abs(nav.coastDistance);
      const dist = d >= nav.maxDistance ? `> ${nav.maxDistance / 1000} km` : d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      this.coast.textContent = nav.coastDistance > 0 ? `ON LAND · ${dist} inland` : `Coast ${dist}`;
      this.coast.classList.toggle('hud-warn', nav.coastDistance > -100);
    }
    const { heading, speed } = boat.state;
    const angle = windAngle(heading, wind.direction);
    this.speed.textContent = (speed * MS_TO_KNOTS).toFixed(1);
    this.heading.textContent = `${Math.round(heading)}° ${compass(heading)}`;
    this.wind.textContent = `${(wind.speed * MS_TO_KNOTS).toFixed(0)} kn from ${compass(wind.direction)} (${Math.round(wind.direction)}°)`;
    this.sail.textContent = boat.turbo ? 'TURBO' : boat.sailUp ? `Sail up · ${pointOfSail(angle)}` : 'Sail down';
    this.efficiency.style.width = `${boat.sailUp ? polarFactor(angle) * 100 : 0}%`;
    // Arrow sits on the side the wind comes from and points at the boat.
    this.arrow.setAttribute('transform', `rotate(${relativeWind(heading, wind.direction)})`);
  }
}
