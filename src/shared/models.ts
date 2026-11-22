import type { LaptopModel, ModelIndexEntry } from './types';

const base = import.meta.env.BASE_URL;

export async function fetchModelIndex(): Promise<ModelIndexEntry[]> {
  const res = await fetch(`${base}models/index.json`);
  if (!res.ok) throw new Error(`Could not load model list (${res.status})`);
  return res.json();
}

export async function fetchModel(id: string): Promise<LaptopModel> {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid model id');
  const res = await fetch(`${base}models/${id}.json`);
  if (!res.ok) throw new Error(`Unknown laptop model "${id}"`);
  return res.json();
}
