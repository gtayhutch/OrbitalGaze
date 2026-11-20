# OrbitalGaze

OrbitalGaze ([orbitalgaze.com](https://orbitalgaze.com)) is an interactive 3D
globe for exploring the world through public webcams. Spin the Earth, zoom in
anywhere, and watch scenic, weather, traffic, and wildlife cameras that their
operators publish for public viewing. Turn on the earthquake layer to explore
USGS events from the past 24 hours, or the satellites layer to watch every
active satellite move at its real height, from the space stations to the
geostationary ring. Switch between a dark map and NASA satellite imagery.
Flight-path and weather layers are planned.

## Running it locally

Use Node.js 26 (see `.nvmrc`) and pnpm 12.18.0 (see `package.json`). The
database, object storage, and queues run locally without a Cloudflare account.

```bash
pnpm install     # install dependencies
pnpm dev         # start the app at http://localhost:5173
pnpm verify      # formatting, linting, type checking, build, and tests
```

`pnpm db:seed` loads sample cameras into the local database. Type checks use
the TypeScript 7.0.2 compiler. Type-aware ESLint rules use the TypeScript 6.0.3
compiler API through Microsoft's compatibility package.

## How it's built

| Part                | Technology                                           |
| ------------------- | ---------------------------------------------------- |
| Globe and interface | React, Vite, MapLibre GL JS, Tailwind CSS, shadcn/ui |
| API and edge logic  | Hono on Cloudflare Workers                           |
| Data                | Cloudflare D1 (SQLite) and R2                        |
| Map                 | Protomaps vector tiles, served from R2               |
| Satellites          | deck.gl, satellite.js (SGP4) in a Web Worker         |
| Background jobs     | Cloudflare Cron Triggers and Queues                  |
| Tests               | Vitest, Playwright                                   |

Source layout:

| Path          | Contents                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------- |
| `src/client/` | Globe, webcam player and search, earthquake and satellite layers, map styles, and share links |
| `src/worker/` | API routes, camera ingestion, layer snapshot jobs, and map and imagery tiles                  |
| `src/shared/` | Types, validation schemas, and pure helpers used by both sides                                |
| `migrations/` | Database schema migrations                                                                    |
| `tests/`      | End-to-end tests                                                                              |

Every source file begins with a comment explaining its role, and every
function and component is documented where it's defined.

## Data sources

- [Windy Webcams](https://www.windy.com/) provides the public webcam catalog,
  images, and opt-in player embeds. Camera operators who want a feed removed
  can open an issue.
- The [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) provides
  earthquake data. The layer shows magnitude, depth, local event time, and
  attribution.
- [CelesTrak](https://celestrak.org/) provides the orbital elements of
  active satellites, downloaded a few times a day. Positions are computed in
  your browser with the SGP4 model ([satellite.js](https://github.com/shashwatak/satellite-js)).
  Military satellites are left out.
- The satellite map style shows NASA's Blue Marble imagery from the
  [Global Imagery Browse Services (GIBS)](https://nasa-gibs.github.io/gibs-api-docs/),
  part of NASA's Earth Science Data and Information System (ESDIS), served
  through our own cache.
- The map uses [OpenStreetMap](https://www.openstreetmap.org/copyright) data
  (© OpenStreetMap contributors, ODbL) from a [Protomaps](https://protomaps.com)
  planet build, served from our own storage. Label fonts are Noto Sans (SIL
  Open Font License) and map icons come from Protomaps' basemap assets (MIT);
  see `public/basemap/NOTICE.txt`. `pnpm basemap:seed` loads a small
  synthetic map for local development.

## License

Copyright (c) 2026 Garrison Hutcherson. All rights reserved. The source is
public to read, but it isn't open source. See [LICENSE](LICENSE) for details.
