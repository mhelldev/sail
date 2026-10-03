/// <reference lib="webworker" />
// Builds terrain chunks off the main thread. Each worker loads the coastline itself.

import { Coastline, type CoastData } from '../geo/coastline';
import { LocalProjection } from '../geo/projection';
import { buildChunk, type ChunkRequest } from './buildChunk';
import { encodeShore, SHORE_RANGE } from '../water/waves';
import { createTerrainSampler, type TerrainParams, type TerrainSampler } from './height';

export type WorkerRequest =
  | { type: 'init'; coastUrl: string; origin: { lat: number; lon: number }; params: TerrainParams }
  | { type: 'params'; params: TerrainParams }
  | ({ type: 'build'; id: number } & ChunkRequest)
  | { type: 'shore'; id: number; x0: number; z0: number; step: number; res: number };

export type WorkerResponse =
  | { type: 'ready' }
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
const queue: WorkerRequest[] = [];

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    sampler = createTerrainSampler(msg.params);
    const data = (await fetch(msg.coastUrl).then((r) => r.json())) as CoastData;
    coast = Coastline.fromData(data, new LocalProjection(msg.origin.lat, msg.origin.lon));
    ctx.postMessage({ type: 'ready' } satisfies WorkerResponse);
    for (const m of queue.splice(0)) handle(m);
    return;
  }
  if (!coast) queue.push(msg);
  else handle(msg);
};

function handle(msg: WorkerRequest): void {
  if (msg.type === 'params') {
    sampler = createTerrainSampler(msg.params);
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
