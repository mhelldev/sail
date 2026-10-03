import * as THREE from 'three';
import type { TerrainParams } from './height';
import type { WorkerRequest, WorkerResponse } from './terrain.worker';

export const CHUNK_SIZE = 2000; // metres
const VIEW_RADIUS = 11000; // metres of terrain kept around the boat
const DROP_RADIUS = VIEW_RADIUS + CHUNK_SIZE; // hysteresis so chunks don't flicker at the edge
const LODS: Array<{ maxDist: number; res: number }> = [
  { maxDist: 3000, res: 64 }, // ~31 m grid
  { maxDist: 7000, res: 32 }, // ~62 m
  { maxDist: Infinity, res: 16 }, // ~125 m
];
const UPDATE_DISTANCE = 150; // re-plan when the boat has moved this far
const MAX_IN_FLIGHT_PER_WORKER = 2;

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  res: number; // resolution currently shown (0 = nothing yet)
  wantedRes: number;
  pendingRes: number; // resolution being built (0 = none)
  mesh?: THREE.Mesh;
  empty: boolean;
}

interface Job {
  id: number;
  chunk: Chunk;
  res: number;
  version: number;
}

/** Streams terrain chunks around the boat, built by a pool of Web Workers. */
export class TerrainManager {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
  });
  /** Chunk build times in ms, for the debug panel. */
  readonly stats = { chunks: 0, meshes: 0, queued: 0, lastBuildMs: 0 };

  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly chunks = new Map<string, Chunk>();
  private readonly jobs = new Map<number, Job & { worker: number }>();
  private queue: Job[] = [];
  private nextJobId = 1;
  private version = 1;
  private readonly lastPlan = new THREE.Vector2(Infinity, Infinity);
  private readonly shoreRequests = new Map<number, (data: Uint8Array) => void>();

  constructor(coastUrl: string, origin: { lat: number; lon: number }, params: TerrainParams) {
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(i, e.data);
      worker.postMessage({ type: 'init', coastUrl, origin, params } satisfies WorkerRequest);
      this.workers.push(worker);
      this.busy.push(0);
    }
  }

  /** Signed coast distance grid for the water's shore map, computed on a worker. */
  computeShore(x0: number, z0: number, step: number, res: number): Promise<Uint8Array> {
    const id = this.nextJobId++;
    const worker = this.busy.indexOf(Math.min(...this.busy));
    return new Promise((resolve) => {
      this.shoreRequests.set(id, resolve);
      this.workers[worker].postMessage({ type: 'shore', id, x0, z0, step, res } satisfies WorkerRequest);
    });
  }

  /** Rebuild everything with new parameters (from the tuning panel). */
  setParams(params: TerrainParams): void {
    this.version++;
    for (const w of this.workers) w.postMessage({ type: 'params', params } satisfies WorkerRequest);
    for (const chunk of this.chunks.values()) {
      chunk.pendingRes = 0;
      chunk.res = 0; // forces a rebuild; the old mesh stays until the new one arrives
    }
    this.queue = [];
    this.lastPlan.set(Infinity, Infinity);
  }

  update(boatX: number, boatZ: number): void {
    if (this.lastPlan.distanceTo(new THREE.Vector2(boatX, boatZ)) >= UPDATE_DISTANCE) {
      this.lastPlan.set(boatX, boatZ);
      this.plan(boatX, boatZ);
    }
    this.dispatch();
  }

  private plan(boatX: number, boatZ: number): void {
    const centerDist = (c: Chunk) =>
      Math.hypot((c.cx + 0.5) * CHUNK_SIZE - boatX, (c.cz + 0.5) * CHUNK_SIZE - boatZ);
    const range = Math.ceil(VIEW_RADIUS / CHUNK_SIZE);
    const bcx = Math.floor(boatX / CHUNK_SIZE);
    const bcz = Math.floor(boatZ / CHUNK_SIZE);

    for (let cz = bcz - range; cz <= bcz + range; cz++) {
      for (let cx = bcx - range; cx <= bcx + range; cx++) {
        const key = `${cx},${cz}`;
        let chunk = this.chunks.get(key);
        if (!chunk) {
          chunk = { key, cx, cz, res: 0, wantedRes: 0, pendingRes: 0, empty: false };
          if (centerDist(chunk) > VIEW_RADIUS) continue;
          this.chunks.set(key, chunk);
        }
      }
    }

    for (const chunk of this.chunks.values()) {
      const d = centerDist(chunk);
      if (d > DROP_RADIUS) {
        this.remove(chunk);
        continue;
      }
      chunk.wantedRes = LODS.find((l) => d < l.maxDist)!.res;
    }

    // Queue builds where the shown/pending resolution differs from what we want, nearest first.
    this.queue = [...this.chunks.values()]
      .filter((c) => c.wantedRes !== (c.pendingRes || c.res))
      // An empty (all-water) chunk only needs another look at a finer resolution, which may find small islands.
      .filter((c) => !(c.empty && c.res !== 0 && c.wantedRes <= c.res))
      .sort((a, b) => centerDist(a) - centerDist(b))
      .map((chunk) => ({ id: this.nextJobId++, chunk, res: chunk.wantedRes, version: this.version }));
  }

  private dispatch(): void {
    while (this.queue.length) {
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) {
        if (this.busy[i] < MAX_IN_FLIGHT_PER_WORKER && (best < 0 || this.busy[i] < this.busy[best])) best = i;
      }
      if (best < 0) break;
      const job = this.queue.shift()!;
      if (!this.chunks.has(job.chunk.key)) continue;
      job.chunk.pendingRes = job.res;
      this.jobs.set(job.id, { ...job, worker: best });
      this.busy[best]++;
      this.workers[best].postMessage({
        type: 'build',
        id: job.id,
        x0: job.chunk.cx * CHUNK_SIZE,
        z0: job.chunk.cz * CHUNK_SIZE,
        size: CHUNK_SIZE,
        res: job.res,
      } satisfies WorkerRequest);
    }
    this.stats.queued = this.queue.length;
  }

  private onMessage(worker: number, msg: WorkerResponse): void {
    if (msg.type === 'shore') {
      this.shoreRequests.get(msg.id)?.(msg.data);
      this.shoreRequests.delete(msg.id);
      return;
    }
    if (msg.type !== 'chunk') return;
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    this.busy[worker]--;
    this.stats.lastBuildMs = msg.ms;

    const chunk = job.chunk;
    // Ignore results for chunks that were dropped or rebuilt with newer parameters.
    if (this.chunks.get(chunk.key) !== chunk || job.version !== this.version) return;
    if (chunk.pendingRes === job.res) chunk.pendingRes = 0;

    this.disposeMesh(chunk);
    chunk.res = job.res;
    chunk.empty = msg.empty;
    if (!msg.empty) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(msg.positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(msg.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(msg.indices, 1));
      geo.boundingBox = new THREE.Box3(
        new THREE.Vector3(0, msg.minHeight, 0),
        new THREE.Vector3(CHUNK_SIZE, msg.maxHeight, CHUNK_SIZE),
      );
      geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      chunk.mesh = mesh;
      this.group.add(mesh);
    }
    this.updateStats();
  }

  private remove(chunk: Chunk): void {
    this.disposeMesh(chunk);
    this.chunks.delete(chunk.key);
    this.updateStats();
  }

  private disposeMesh(chunk: Chunk): void {
    if (!chunk.mesh) return;
    this.group.remove(chunk.mesh);
    chunk.mesh.geometry.dispose();
    chunk.mesh = undefined;
  }

  private updateStats(): void {
    this.stats.chunks = this.chunks.size;
    this.stats.meshes = this.group.children.length;
  }
}
