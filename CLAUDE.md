# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server at http://localhost:5173
npm run build      # Production build → dist/
npm run lint       # ESLint (zero warnings tolerance)
```

There are no tests.

## Architecture

This is a **single-component React app** — all logic lives in [src/App.jsx](src/App.jsx) alongside inlined SVG icon components and module-level utility functions. [src/App.css](src/App.css) drives all styling via CSS custom properties (`data-theme="dark|light"` on `<html>`).

**Layout**: a two-column `<main>` — `.panel` (left, search + results) and `.map-container` (right, Leaflet map). On mobile, `.map-fullscreen` toggles the map to cover the screen.

**State flow**: every lookup path — address search, coordinate search, map click, Locate Me — funnels into `lookupCoords(lat, lon, keepZoom?)`, which fires `reverseGeocode` + `fetchElevation` in parallel, updates `result`, then triggers `loadMoreInfo` in the background (non-critical, fails silently).

**Map interaction**: `MapUpdater` responds only to `navTarget.id` changes (not center/zoom) to avoid fighting user pan/zoom. `MapClickHandler` wraps `useMapEvents` and also keeps `zoomRef` in sync so `lookupCoords` can preserve the current zoom level on map clicks.

**External APIs** (all free, no keys required):
- **Nominatim** — forward and reverse geocoding (`/search`, `/reverse`)
- **Open-Meteo** — elevation (`/v1/elevation`) and weather/UV/sun (`/v1/forecast`)
- Tile providers: OSM, CartoDB, Esri, Stadia/Stamen, OpenTopoMap

**Deployment**: Cloudflare Pages (`npm run build` → `dist/`). The app is fully static — no backend, no base-path config needed.
