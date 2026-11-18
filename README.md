# OrbitalGaze

OrbitalGaze ([orbitalgaze.com](https://orbitalgaze.com)) is an interactive 3D
globe for exploring the world through public webcams. Spin the Earth, zoom in
anywhere, and watch scenic, weather, traffic, and wildlife cameras that their
operators publish for public viewing. Satellite, flight-path, and weather
layers are planned.

## Running it locally

Prerequisites: Node.js (the version in `.nvmrc`) and pnpm (enable with
`corepack enable`). No Cloudflare account is needed. The database, file
storage, and queues all run locally.

```bash
pnpm install     # install dependencies
pnpm dev         # start the app at http://localhost:5173
pnpm verify      # formatting, linting, type checks, and all tests
```

The local environment uses its own sample data and can't reach the hosted
staging or production environments.

## How it's built

| Part                | Technology                                                 |
| ------------------- | ---------------------------------------------------------- |
| Globe and interface | TypeScript, React, Vite, CesiumJS, Tailwind CSS, shadcn/ui |
| API and edge logic  | Hono on Cloudflare Workers                                 |
| Data                | Cloudflare D1 (SQLite) and R2                              |
| Background jobs     | Cloudflare Cron Triggers and Queues                        |
| Tests               | Vitest, Playwright                                         |

Source layout:

| Path          | Contents                                                       |
| ------------- | -------------------------------------------------------------- |
| `src/client/` | The browser app: globe, camera player, search, and filters     |
| `src/worker/` | The Cloudflare Worker: API routes, feed proxy, scheduled jobs  |
| `src/shared/` | Types, validation schemas, and pure helpers used by both sides |
| `migrations/` | Database schema migrations                                     |
| `tests/`      | End-to-end tests                                               |

Every source file begins with a comment explaining its role, and every
function and component is documented where it's defined.

## Camera sources

OrbitalGaze shows only cameras whose operators publish them for public
viewing, under each source's terms and attribution requirements. Camera
operators who want a feed removed can open an issue.

## License

Copyright (c) 2026 Garrison Hutcherson. All rights reserved. The source is
public to read, but it isn't open source. See [LICENSE](LICENSE) for details.
