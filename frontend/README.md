# FireTrackr web dashboard

From this directory, run `npm ci` and `npm run dev`. Configure public browser
settings in `.env` using `.env.example`; see the [project instructions](../CLAUDE.md)
for API setup. `npm run build` produces `dist/`; `npm run preview` serves it locally.

## Dashboard URLs

| Screen | Path |
| --- | --- |
| Command | `/command` |
| Metrics | `/metrics` |
| Response & Operations | `/analysis/response` |
| Coverage Planning | `/analysis/coverage` |
| Operational Reports | `/analysis/reports` |
| Incident register / details | `/incidents` / `/incidents/42` |
| Personnel / Teams / Trucks | `/personnel` / `/teams` / `/trucks` |
| Stations / selected station | `/stations` / `/stations?station=2` |
| Settings | `/settings` |

Analysis incident details use `/analysis/response/incidents/42`; dispatch details
use `/analysis/response/dispatches/8?incident=42` (the incident query is optional).
These IDs are examples. Browser Back/Forward restores screens without reloading
the dashboard session. The first history entry can still go back to the site
visited before FireTrackr; navigation does not trap the browser inside the app.

Protected bookmarks show login when signed out, then return to the requested
screen after sign-in. Root/unknown paths open Command when signed in, or login
otherwise. Incident bookmarks require the updated backend's administrator-only
`GET /api/incidents/{fire_id}` endpoint.

## Static hosting

Vite development and preview already serve the SPA for application paths.
For production static hosting, serve `dist/` and configure a **rewrite** from
`/*` to `/index.html` with HTTP status 200. Serve existing assets normally;
keep the requested browser URL. Pasted links and refreshes on deep paths then
reach React instead of a server 404.

If the API shares the same origin, handle API, uploads, WebSocket and public
`/report/{token}` paths before the SPA fallback. Existing Vite proxies retain
those backend paths. This code does not change deployed hosting settings.

## Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
