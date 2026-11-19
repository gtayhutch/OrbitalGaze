/**
 * @fileoverview Tests for reading basemap tiles from an archive in R2.
 *
 * Layer: worker tests (workerd with a real local R2 bucket).
 */
import {env} from 'cloudflare:workers';
import {TileType} from 'pmtiles';
import {describe, expect, it} from 'vitest';

import {buildPmtilesArchive} from '../../test_support/pmtiles_writer';
import {
  BasemapUnavailableError,
  createBasemapRepository,
} from './basemap_repository';

/** Fake tile bytes that are easy to recognise. */
const WORLD = Uint8Array.from([1, 2, 3]);
const EUROPE = Uint8Array.from([4, 5, 6, 7]);

/** Stores a two-tile vector archive under `key`. */
async function storeArchive(
  key: string,
  tileType: TileType = TileType.Mvt,
): Promise<void> {
  await env.BASEMAP.put(
    key,
    buildPmtilesArchive({
      tiles: [
        {z: 0, x: 0, y: 0, data: WORLD},
        {z: 1, x: 1, y: 0, data: EUROPE},
      ],
      metadata: {vector_layers: [{id: 'earth'}, {id: 'water'}]},
      tileType,
    }),
  );
}

describe('createBasemapRepository', () => {
  it('reads the bytes of a tile that exists', async () => {
    await storeArchive('repo/hit.pmtiles');
    const basemap = createBasemapRepository(env.BASEMAP, 'repo/hit.pmtiles');

    expect(await basemap.readTile(0, 0, 0)).toEqual(WORLD);
    expect(await basemap.readTile(1, 1, 0)).toEqual(EUROPE);
  });

  it('returns null for an empty tile and beyond the zoom range', async () => {
    await storeArchive('repo/empty.pmtiles');
    const basemap = createBasemapRepository(env.BASEMAP, 'repo/empty.pmtiles');

    expect(await basemap.readTile(1, 0, 0)).toBeNull();
    expect(await basemap.readTile(9, 0, 0)).toBeNull();
  });

  it('reads the zoom range, bounds and vector layer names', async () => {
    await storeArchive('repo/info.pmtiles');
    const basemap = createBasemapRepository(env.BASEMAP, 'repo/info.pmtiles');

    expect(await basemap.readInfo()).toEqual({
      minZoom: 0,
      maxZoom: 1,
      bounds: [-180, -85, 180, 85],
      vectorLayers: [{id: 'earth'}, {id: 'water'}],
    });
  });

  it('reports a missing or unconfigured archive as unavailable', async () => {
    await expect(
      createBasemapRepository(env.BASEMAP, 'repo/missing.pmtiles').readTile(
        0,
        0,
        0,
      ),
    ).rejects.toBeInstanceOf(BasemapUnavailableError);
    await expect(
      createBasemapRepository(env.BASEMAP, null).readInfo(),
    ).rejects.toBeInstanceOf(BasemapUnavailableError);
  });

  it('refuses an archive that does not hold vector tiles', async () => {
    await storeArchive('repo/raster.pmtiles', TileType.Png);
    const basemap = createBasemapRepository(env.BASEMAP, 'repo/raster.pmtiles');

    await expect(basemap.readTile(0, 0, 0)).rejects.toThrow(
      'does not hold vector tiles',
    );
  });
});
