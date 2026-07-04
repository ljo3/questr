# 🧭 Questr

> Turn any place on Earth into an adventure — explore, play, and collect the world.

![Questr](https://img.shields.io/badge/built%20with-React%20%2B%20Vite-61dafb?style=flat-square&logo=react)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
[![Deploy](https://img.shields.io/badge/deploy-Cloudflare%20Pages-orange?style=flat-square&logo=cloudflare)](https://questr.pages.dev)

**Live:** [questr.pages.dev](https://questr.pages.dev) · **Slides:** [rawcdn.githack.com](https://rawcdn.githack.com/ljo3/questr/main/slides.html) · **Repo:** [github.com/ljo3/questr](https://github.com/ljo3/questr)

Questr is a static, zero-backend web app that turns any location on Earth into a game. Search by address or coordinates, drop a pin anywhere on the map, and instantly get elevation, live weather, sunrise/sunset, timezone, and DMS coordinates — then play **Quiz Hunt** and **Guess the Spot** on the real landmarks around you, earning passport XP and filling your travel journal as you go.

---

## Features

| Feature | Details |
|---|---|
| **Address → Coordinates** | Type any address or place name, get lat/lon |
| **Coordinates → Address** | Enter lat/lon, get a clean human-readable address |
| **Map click** | Click anywhere on the map to reverse geocode that point |
| **Locate Me** | One-click GPS button to jump to your current location |
| **Elevation** | Meters above sea level via Open-Meteo |
| **Live Weather** | Condition, temperature, humidity, wind, precipitation, cloud cover, UV index |
| **Sun & Time** | Sunrise, sunset, timezone name, UTC offset |
| **Coordinate formats** | Decimal degrees and DMS (Degrees°Minutes'Seconds") |
| **Geohash** | Compact 8-character location hash |
| **6 Map styles** | Street, Dark, Light, Satellite, Terrain, Topo |
| **Dark / Light mode** | Follows system preference, toggle in header |
| **Copy to clipboard** | Copy coordinates or full address with one click |
| **📖 Easter-egg hunts & quizzes** | Find POIs against the clock, guess-the-spot, earn passport XP |
| **🖼️ Photo collage** | Upload 3–6 trip photos → AI-themed travel-journal page (AWS + Actions) |
| **Fully static** | No server, no database — deploys anywhere |

---

## Tech Stack

- **[React 18](https://react.dev/)** + **[Vite](https://vitejs.dev/)** — UI and build
- **[React-Leaflet](https://react-leaflet.js.org/)** — interactive map
- **[Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/)** — geocoding & reverse geocoding (free, no key)
- **[Open-Meteo](https://open-meteo.com/)** — elevation, weather, UV, sunrise/sunset (free, no key)
- **[Esri World Imagery](https://www.esri.com/)** — satellite tiles
- **[CartoDB](https://carto.com/)** — dark & light tiles
- **[Stadia Maps / Stamen](https://stadiamaps.com/)** — terrain tiles
- **[OpenTopoMap](https://opentopomap.org/)** — topographic tiles
- **[Python](https://python.org/) + [Pillow](https://python-pillow.org/)** — collage rendering engine (GitHub Actions)
- **[Claude vision](https://www.anthropic.com/)** — theme detection & layout judging (optimizer/evaluator loop)
- **[AWS S3 + Lambda](https://aws.amazon.com/)** — photo storage & presigned-upload signing endpoint

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

The app runs at `http://localhost:5173` by default.

---

## Deployment

Questr is a fully static site — the `dist/` folder after `npm run build` is all you need.

### Cloudflare Pages (recommended)

> **⚠️ Setup TODO — spin up the `questr` project.** The docs point at `questr.pages.dev`, but the Cloudflare project still needs to be created (or the old `travel-concierge` project renamed) for that URL to resolve. Do this before the demo:
> 1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
> 2. Select the **`ljo3/questr`** repo
> 3. Project name: **`questr`** · Build command: **`npm run build`** · Output dir: **`dist`**
> 4. **Save and Deploy** → live at `https://questr.pages.dev` (auto-deploys on every push to `main`)

**Option A — Git integration:**
1. Push to GitHub or GitLab
2. Go to Cloudflare Dashboard → Pages → Create project → Connect Git
3. Set:
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Deploy — auto-deploys on every push

**Option B — Direct upload:**
```bash
npm run build
npx wrangler pages deploy dist --project-name questr
```

Or drag-and-drop the `dist/` folder in the Cloudflare Pages dashboard.

### Other hosts

Any static host works: Netlify, Vercel, S3, etc. Just point it at the `dist/` folder.

---

## 🖼️ Photo Collage / Travel Journal

Upload 3–6 photos from the Journal panel and Questr builds a themed collage
"journal page". All heavy lifting stays in **AWS + GitHub Actions** — the
Cloudflare-hosted page holds **no secrets**.

```
Browser (Questr, Cloudflare Pages)
   │  POST {action:"sign"}          ┌─────────────────────────────┐
   ├───────────────────────────────▶│  AWS Lambda (Function URL)  │
   │  ◀── presigned PUT URL ────────│  · presigns S3 PUT (IAM role)│
   │                                │  · fires repo_dispatch (PAT) │
   │  PUT photo ──▶  S3  <date>/…   └─────────────────────────────┘
   │  POST {action:"build"} ───────────────┐
   │                                        ▼
   │                         GitHub Actions (collage.yml)
   │                         python -m collage.build --date <date>
   │                           download → theme → optimize/judge → render
   │                           upload  <date>/collage.jpg  (public-read)
   ◀── poll & display collage.jpg ─────────┘
```

The engine (`collage/`) runs **fully offline** with a deterministic heuristic
fallback — no AWS, no Anthropic key needed to try it:

```bash
python -m collage.build --local ./collage/sample --no-upload --out /tmp/out.jpg
```

With `ANTHROPIC_API_KEY` set, Claude vision reads the photos' theme and judges
each candidate layout in an optimizer/evaluator loop; otherwise the heuristic
scorer picks the winner.

### One-time setup

<details>
<summary><b>1. S3 bucket</b> — <code>photo-bucket-333886071196-eu-west-3-an</code> (eu-west-3)</summary>

**CORS** (so the browser can PUT via the presigned URL):

```json
[{
  "AllowedOrigins": ["https://questr.pages.dev", "http://localhost:5173"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

**Public read for the finished collages only** (bucket policy):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadCollages",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::photo-bucket-333886071196-eu-west-3-an/*/collage.jpg"
  }]
}
```
</details>

<details>
<summary><b>2. AWS Lambda</b> — the signing endpoint (<code>lambda/handler.py</code>)</summary>

- Runtime **Python 3.12**, handler `handler.handler`, a **Function URL** (auth `NONE`).
- **Execution role** needs `s3:PutObject` on `…/*` (to presign uploads).
- **Environment variables:**
  | Var | Value |
  |---|---|
  | `PHOTO_BUCKET` | `photo-bucket-333886071196-eu-west-3-an` |
  | `GH_REPO` | `ljo3/questr` |
  | `GH_TOKEN` | GitHub PAT with `repo` (or fine-grained *Dispatch*) scope |
  | `ALLOW_ORIGIN` | `https://questr.pages.dev` |

Copy the Function URL into the frontend build env: `VITE_QUESTR_SIGN_URL`.
</details>

<details>
<summary><b>3. GitHub Actions secrets</b> — for <code>.github/workflows/collage.yml</code></summary>

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 read (photos) + write (collage) |
| `AWS_REGION` | `eu-west-3` (optional, defaults) |
| `PHOTO_BUCKET` | bucket name (optional, defaults) |
| `ANTHROPIC_API_KEY` | enables Claude vision (optional — heuristic fallback otherwise) |

The workflow runs nightly (22:00 UTC) and on the `build-collage`
`repository_dispatch` fired by the Lambda when someone taps **Create collage now**.
</details>

<details>
<summary><b>4. Frontend env</b></summary>

```bash
# .env (Cloudflare Pages build variable)
VITE_QUESTR_SIGN_URL=https://<your-lambda-id>.lambda-url.eu-west-3.on.aws/
```
When unset, the collage UI shows a friendly "not configured yet" message.
</details>

---

## API Usage & Limits

All APIs used are **free with no API key required**.

| API | Usage policy |
|---|---|
| Nominatim | Max 1 req/sec, requires valid Referer in production. Fine for personal use. |
| Open-Meteo | Free for non-commercial use, no rate limit for reasonable traffic. |
| Esri, CartoDB, Stadia, OpenTopoMap | Free tile servers for reasonable public use. |

For high-traffic production use, consider self-hosting Nominatim or switching to a commercial geocoder.

---

## Project Structure

```
src/
├── App.jsx       # Main component — all UI, state, and API calls
├── App.css       # Styles with CSS custom properties for theming
├── index.css     # Base reset
└── main.jsx      # React entry point
index.html        # HTML shell
vite.config.js    # Vite config

collage/          # Python collage engine (runs in GitHub Actions)
├── build.py      # CLI entry point (--date / --local / --no-upload)
├── config.py     # bucket, region, model, canvas, loop settings
├── s3io.py       # list/download photos, upload collage
├── theme.py      # Claude (or heuristic) theme detection
├── layouts.py    # 5 algorithmic templates (grid/hero/filmstrip/columns/polaroid)
├── render.py     # Pillow rasteriser (cover-crop, rounded, rotate, footer)
├── evaluate.py   # Claude judge + heuristic scorer
├── optimize.py   # optimizer/evaluator loop (templates → mutations → winner)
└── sample/       # synthetic photos for offline testing

lambda/
└── handler.py    # AWS Lambda: /sign presigned PUT + /build repo_dispatch

.github/workflows/
└── collage.yml   # nightly cron + on-demand repository_dispatch
```

---

Made with ❤️ by **Lawrence**



TODO:

The photo collage / travel journal feature is complete end-to-end. Here's what shipped:

Python engine (collage/) — verified running offline

build.py orchestrates: download → detect_theme → optimizer/evaluator loop → render → upload
Fixed the polaroid dead-space bug (rows now pack to photo height and center vertically); confirmed via a 5-template contact sheet — grid centers its short last row, hero/filmstrip/columns fill cleanly, polaroid is tight
Runs fully offline with a deterministic heuristic fallback; Claude vision (claude-opus-4-8) kicks in when ANTHROPIC_API_KEY is set
GitHub Actions (.github/workflows/collage.yml)

Nightly cron (22:00 UTC) + repository_dispatch (build-collage) for on-demand + manual workflow_dispatch
Per-day concurrency guard so the same date never builds twice at once
AWS Lambda (lambda/handler.py) — the single Function URL keeping all secrets server-side

{action:"sign"} → presigned S3 PUT via the execution role's IAM (no static keys in the browser), returns date-prefixed key + eventual public collage URL
{action:"build"} → fires the GitHub repository_dispatch
CORS preflight handled
Frontend (src/App.jsx + App.css) — build passes ✓

Photo picker (tap or drag-drop, 3–6 photos, thumbnails with remove buttons) inside the Journal modal
"Create collage now" button → presigns + uploads each photo → triggers the build → polls the public S3 URL and displays the finished collage inline
Reads the Lambda URL from VITE_QUESTR_SIGN_URL; shows a friendly "not configured yet" note when unset
README — full setup docs (architecture diagram, S3 CORS + collage-only public-read policy, Lambda env vars, Actions secrets, frontend env) plus updated Features/Tech Stack/Project Structure.

One note: npm run lint can't run — the eslint binary isn't present in this repo's node_modules (it's referenced in the script but not installed as a dep). That's pre-existing, not from these changes; npm run build compiles clean.