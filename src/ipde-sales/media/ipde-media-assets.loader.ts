import { readFile } from 'node:fs/promises';
import {
  formatIpdeMediaZodIssues,
  IpdeMediaAssetsConfigSchema,
} from './ipde-media-assets.schemas';
import { IpdeMediaAssetsConfigError } from './ipde-media-assets.errors';
import { IpdeMediaAssetsConfig } from './ipde-media-assets.types';

export async function loadIpdeMediaAssetsConfig(
  mediaAssetsPath: string,
): Promise<IpdeMediaAssetsConfig> {
  const raw = await readJson(mediaAssetsPath);
  const parsed = IpdeMediaAssetsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IpdeMediaAssetsConfigError(
      'INVALID_MEDIA_ASSETS_CONFIG',
      formatIpdeMediaZodIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

async function readJson(path: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    throw new IpdeMediaAssetsConfigError(
      'MEDIA_ASSETS_CONFIG_NOT_READABLE',
      'IPDE media assets configuration could not be read',
    );
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new IpdeMediaAssetsConfigError(
      'MEDIA_ASSETS_CONFIG_INVALID_JSON',
      'IPDE media assets configuration contains invalid JSON',
    );
  }
}
