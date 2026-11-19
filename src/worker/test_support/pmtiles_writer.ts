/**
 * @fileoverview Builds small PMTiles archives in memory for tests.
 *
 * Layer: worker test support.
 *
 * Tests need a real archive to read through R2, but committing map data
 * would add OpenStreetMap-licensed files to the repository. This writer
 * produces a valid PMTiles v3 archive from a handful of fake tiles instead,
 * following the published specification: a 127-byte header, one root
 * directory, JSON metadata, then the tile bytes. Nothing is compressed,
 * which the format allows.
 */
import {Compression, TileType, zxyToTileId} from 'pmtiles';

/** One tile to put in the archive. */
export interface FakeTile {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  /** The tile's bytes, stored as-is. */
  readonly data: Uint8Array;
}

/** Options for {@link buildPmtilesArchive}. */
export interface PmtilesArchiveOptions {
  /** The tiles; each z/x/y at most once. */
  readonly tiles: readonly FakeTile[];
  /** Metadata JSON; defaults to one vector layer named `earth`. */
  readonly metadata?: Record<string, unknown>;
  /** Tile type; defaults to vector tiles. */
  readonly tileType?: TileType;
}

/** Size of the fixed PMTiles v3 header. */
const HEADER_BYTES = 127;

/** Appends `value` as an unsigned LEB128 varint. */
function pushVarint(out: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  out.push(remaining);
}

/** Encodes a root directory of entries sorted by tile ID. */
function encodeDirectory(
  entries: readonly {tileId: number; offset: number; length: number}[],
): Uint8Array {
  const out: number[] = [];
  pushVarint(out, entries.length);
  // Tile IDs as deltas, then run lengths (1 each), lengths, and offsets
  // (0 means "right after the previous tile", otherwise offset + 1).
  let previousId = 0;
  for (const entry of entries) {
    pushVarint(out, entry.tileId - previousId);
    previousId = entry.tileId;
  }
  for (let index = 0; index < entries.length; index += 1) {
    pushVarint(out, 1);
  }
  for (const entry of entries) {
    pushVarint(out, entry.length);
  }
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    const contiguous =
      previous !== undefined &&
      entry.offset === previous.offset + previous.length;
    pushVarint(out, contiguous ? 0 : entry.offset + 1);
  });
  return Uint8Array.from(out);
}

/**
 * Builds a PMTiles v3 archive.
 *
 * @param options The tiles, metadata and tile type.
 * @returns The archive bytes, ready to `put` in a bucket.
 * @example
 * const bytes = buildPmtilesArchive({tiles: [{z: 0, x: 0, y: 0, data}]});
 * await env.BASEMAP.put('test/world.pmtiles', bytes);
 */
export function buildPmtilesArchive(
  options: PmtilesArchiveOptions,
): Uint8Array {
  // Step 1: lay the tiles out in tile-ID order.
  const sorted = [...options.tiles]
    .map(tile => ({...tile, tileId: zxyToTileId(tile.z, tile.x, tile.y)}))
    .sort((a, b) => a.tileId - b.tileId);
  let tileOffset = 0;
  const entries = sorted.map(tile => {
    const entry = {
      tileId: tile.tileId,
      offset: tileOffset,
      length: tile.data.byteLength,
    };
    tileOffset += tile.data.byteLength;
    return entry;
  });

  // Step 2: encode the directory and metadata.
  const directory = encodeDirectory(entries);
  const metadata = new TextEncoder().encode(
    JSON.stringify(options.metadata ?? {vector_layers: [{id: 'earth'}]}),
  );
  const zooms = sorted.map(tile => tile.z);
  const minZoom = zooms.length === 0 ? 0 : Math.min(...zooms);
  const maxZoom = zooms.length === 0 ? 0 : Math.max(...zooms);

  // Step 3: write the header, then the sections back to back.
  const directoryOffset = HEADER_BYTES;
  const metadataOffset = directoryOffset + directory.byteLength;
  const tileDataOffset = metadataOffset + metadata.byteLength;
  const archive = new Uint8Array(tileDataOffset + tileOffset);
  const view = new DataView(archive.buffer);
  archive.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  const u64 = (position: number, value: number): void => {
    view.setBigUint64(position, BigInt(value), true);
  };
  u64(8, directoryOffset);
  u64(16, directory.byteLength);
  u64(24, metadataOffset);
  u64(32, metadata.byteLength);
  u64(40, 0); // No leaf directories.
  u64(48, 0);
  u64(56, tileDataOffset);
  u64(64, tileOffset);
  u64(72, sorted.length);
  u64(80, sorted.length);
  u64(88, sorted.length);
  view.setUint8(96, 1); // Clustered.
  view.setUint8(97, Compression.None);
  view.setUint8(98, Compression.None);
  view.setUint8(99, options.tileType ?? TileType.Mvt);
  view.setUint8(100, minZoom);
  view.setUint8(101, maxZoom);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, minZoom);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  archive.set(directory, directoryOffset);
  archive.set(metadata, metadataOffset);
  sorted.forEach((tile, index) => {
    const entry = entries[index];
    if (entry !== undefined) {
      archive.set(tile.data, tileDataOffset + entry.offset);
    }
  });
  return archive;
}
