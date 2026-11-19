/**
 * @fileoverview Reads basemap vector tiles from a PMTiles archive in R2.
 *
 * Layer: worker feature, repository (server only).
 *
 * The basemap (land, water, roads, borders and place names) is one
 * Protomaps planet archive in the PMTiles format: a single file holding
 * every tile, with directories that say where each tile's bytes are. The
 * `pmtiles` library reads it with small range requests. This repository
 * plugs R2 into it as the byte source (Adapter pattern), so no tile ever
 * passes through a third party.
 *
 * Archives are versioned by object key (for example
 * `planet/20261118.pmtiles`), so replacing the basemap is a new key plus a
 * config change, never an overwrite.
 */
import {PMTiles, TileType, type Source} from 'pmtiles';
import {z} from 'zod';

/** Thrown when the configured archive isn't in the bucket (or none is set). */
export class BasemapUnavailableError extends Error {
  constructor() {
    super('The basemap archive is not available.');
    this.name = 'BasemapUnavailableError';
  }
}

/** What the basemap's TileJSON needs from the archive. */
export interface BasemapInfo {
  /** Lowest zoom level with tiles. */
  readonly minZoom: number;
  /** Highest zoom level with tiles; maps show these tiles enlarged beyond it. */
  readonly maxZoom: number;
  /** West, south, east, north in degrees. */
  readonly bounds: readonly [number, number, number, number];
  /** The vector layers in the tiles, as named in the archive's metadata. */
  readonly vectorLayers: readonly {readonly id: string}[];
}

/** Basemap tile access. */
export interface BasemapRepository {
  /**
   * Reads one tile.
   *
   * @returns The decompressed vector tile, or `null` when the archive has
   *     no tile there (open ocean, or beyond its zoom range).
   * @throws {BasemapUnavailableError} When the archive is missing.
   */
  readTile(z: number, x: number, y: number): Promise<Uint8Array | null>;
  /**
   * Reads the archive's zoom range, bounds and layer names.
   *
   * @throws {BasemapUnavailableError} When the archive is missing.
   */
  readInfo(): Promise<BasemapInfo>;
}

/** The parts of the archive metadata we use; everything else is ignored. */
const ArchiveMetadataSchema = z.object({
  vector_layers: z
    .array(z.object({id: z.string().min(1).max(100)}))
    .max(100)
    .catch([]),
});

/**
 * Adapts an R2 object to the `pmtiles` byte-source interface (Adapter
 * pattern): each read is one ranged `get`.
 *
 * @param bucket The bucket holding the archive.
 * @param key The archive's object key.
 * @returns A source the `PMTiles` reader can use.
 */
export function createR2Source(bucket: R2Bucket, key: string): Source {
  return {
    getKey: () => key,
    async getBytes(offset, length) {
      const object = await bucket.get(key, {range: {offset, length}});
      if (object === null) {
        throw new BasemapUnavailableError();
      }
      return {data: await object.arrayBuffer(), etag: object.etag};
    },
  };
}

/**
 * Creates the basemap repository for one archive.
 *
 * @param bucket The `BASEMAP` bucket.
 * @param archiveKey The configured archive key, or `null` when none is set.
 * @returns Tile and info readers. With no archive configured every read
 *     throws {@link BasemapUnavailableError}.
 * @example
 * const basemap = createBasemapRepository(env.BASEMAP, config.basemapArchive);
 * const tile = await basemap.readTile(3, 4, 2);
 */
export function createBasemapRepository(
  bucket: R2Bucket,
  archiveKey: string | null,
): BasemapRepository {
  const archive =
    archiveKey === null
      ? null
      : new PMTiles(createR2Source(bucket, archiveKey));

  /** The archive, after checking it holds vector tiles. */
  const vectorArchive = async (): Promise<PMTiles> => {
    if (archive === null) {
      throw new BasemapUnavailableError();
    }
    const header = await archive.getHeader();
    if (header.tileType !== TileType.Mvt) {
      // A deployment mistake (a raster archive), not something a visitor
      // did; surfaces as a 500.
      throw new Error('The basemap archive does not hold vector tiles.');
    }
    return archive;
  };

  return {
    async readTile(z, x, y) {
      const tiles = await vectorArchive();
      const header = await tiles.getHeader();
      if (z < header.minZoom || z > header.maxZoom) {
        return null;
      }
      const tile = await tiles.getZxy(z, x, y);
      return tile === undefined ? null : new Uint8Array(tile.data);
    },

    async readInfo() {
      const tiles = await vectorArchive();
      const header = await tiles.getHeader();
      const metadata = ArchiveMetadataSchema.safeParse(
        await tiles.getMetadata(),
      );
      return {
        minZoom: header.minZoom,
        maxZoom: header.maxZoom,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        vectorLayers: metadata.success ? metadata.data.vector_layers : [],
      };
    },
  };
}
