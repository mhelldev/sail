/// <reference lib="webworker" />
// Builds terrain chunks off the main thread. Each worker loads the coastline itself.

import { Coastline, type CoastData } from '../geo/coastline';
import { LocalProjection } from '../geo/projection';
import { HarborData } from '../harbors/harborData';
import { FlattenSites } from './flatten';
import { buildChunk, type ChunkRequest } from './buildChunk';
import { encodeShore, SHORE_RANGE } from '../water/waves';
import { createTerrainSampler, type TerrainParams, type TerrainSampler } from './height';

export type WorkerRequest =
  | { type: 'init'; coastUrl: string; harborsUrl: string; origin: { lat: number; lon: number }; params: TerrainParams }
  | { type: 'params'; params: TerrainParams }
  | ({ type: 'build'; id: number } & ChunkRequest)
  | { type: 'shore'; id: number; x0: number; z0: number; step: number; res: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'shore'; id: number; data: Uint8Array }
  | {
      type: 'chunk';
      id: number;
      empty: boolean;
      positions: Float32Array;
      colors: Float32Array;
      indices: Uint32Array;
      minHeight: number;
      maxHeight: number;
      ms: number;
    };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let coast: Coastline | undefined;
let sampler: TerrainSampler | undefined;
/** Flat ground for harbour villages and lighthouses (same sites as on the main thread). */
let flatten = new FlattenSites();
const queue: WorkerRequest[] = [];

// Errors in async code don't reach the worker's error event, so report them explicitly.
const report = (err: unknown) =>
  ctx.postMessage({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) } satisfies WorkerResponse);

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg).catch(report);
    return;
  }
  if (!coast) queue.push(msg);
  else handle(msg);
};

async function init(msg: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  const projection = new LocalProjection(msg.origin.lat, msg.origin.lon);
  const [data, harbors] = await Promise.all([
    fetch(msg.coastUrl).then((r) => r.json()) as Promise<CoastData>,
    HarborData.load(msg.harborsUrl, projection),
  ]);
  flatten = new FlattenSites(harbors.flattenSites());
  sampler = createTerrainSampler(msg.params, flatten);
  coast = Coastline.fromData(data, projection);
  ctx.postMessage({ type: 'ready' } satisfies WorkerResponse);
  for (const m of queue.splice(0)) handle(m);
}

function handle(msg: WorkerRequest): void {
  if (msg.type === 'params') {
    sampler = createTerrainSampler(msg.params, flatten);
    return;
  }
  if (msg.type === 'shore' && coast) {
    const sd = coast.sampleGrid(msg.x0, msg.z0, msg.step, msg.res, SHORE_RANGE);
    const data = encodeShore(sd);
    ctx.postMessage({ type: 'shore', id: msg.id, data } satisfies WorkerResponse, [data.buffer]);
    return;
  }
  if (msg.type !== 'build' || !coast || !sampler) return;
  const t = performance.now();
  const mesh = buildChunk(msg, coast, sampler);
  const response: WorkerResponse = { type: 'chunk', id: msg.id, ...mesh, ms: performance.now() - t };
  ctx.postMessage(response, mesh.empty ? [] : [mesh.positions.buffer, mesh.colors.buffer, mesh.indices.buffer]);
}
