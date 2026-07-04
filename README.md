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
| **🖼️ Photo collage** | Upload 3–6 trip photos → AI-themed travel-journal page (self-hosted API + S3) |
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
- **[Python](https://python.org/) + [Pillow](https://python-pillow.org/)** — collage rendering engine (runs on the box, or offline)
- **Vision via [OpenRouter](https://openrouter.ai/)** — theme detection & layout judging (optimizer/evaluator loop; model slug is swappable)
- **[AWS S3](https://aws.amazon.com/s3/)** — collage storage (public-read), written by a self-hosted **[FastAPI](https://fastapi.tiangolo.com/)** service

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
"journal page". The browser POSTs the photos to a small **self-hosted API**
(one always-on box), which runs the collage engine and uploads the finished
image to S3 — the Cloudflare-hosted page holds **no secrets**.

```
Browser (Questr, Cloudflare Pages)
   │  POST /build  (multipart: 3–6 photos)
   ▼
Collage API  ──►  optimize/evaluate engine  ──►  S3  <date>/collage-<title>-<time>.jpg
(server/, on a box)      (OpenRouter + Pillow)      (public-read, unique per build)
   │  202 {collageUrl}                                        ▲
   ◀────────────── browser polls collageUrl ──────────────────┘  shows it inline
```

> **Why a box and not Lambda?** The original design used an AWS Lambda Function
> URL, but this AWS account blocks anonymous public Function URLs. Self-hosting
> the endpoint sidesteps that and also folds the build step in — no GitHub
> Actions, no GitHub token. See [`server/`](server) and [`infra/`](infra).

The engine (`collage/`) runs **fully offline** with a deterministic heuristic
fallback — no AWS, no API key needed to try it:

```bash
python -m collage.build --local ./collage/sample --no-upload --out /tmp/out.jpg
```

With `OPENROUTER_API_KEY` set, the vision model reads the photos' theme and
judges each candidate layout in an optimizer/evaluator loop; otherwise the
heuristic scorer picks the winner. The model defaults to
`anthropic/claude-opus-4.8` and is overridable via `COLLAGE_MODEL` (any vision
model OpenRouter serves).

### Deploying the pipeline

1. **AWS** — create the S3 bucket policy/CORS and the least-privilege
   `questr-signer` IAM user → [`infra/README.md`](infra/README.md).
2. **The box** — provision a small VPS, drop in the secrets, point a hostname at
   it (TLS via Caddy) → [`server/README.md`](server/README.md).
3. **Frontend** — set `VITE_QUESTR_API_URL=https://<host>` in `.env` and in
   Cloudflare Pages, then redeploy. When unset, the collage UI shows a friendly
   "not configured yet" message.

### 🤖 Agentic build from a template (edit a file, get a collage)

There's also a **GitHub-driven** path: give it a *template image* and it builds
a collage that emulates it — no UI, just a commit.

1. Open [`collage-template.md`](collage-template.md) on GitHub and edit the
   `template:` URL in the front matter to any reference collage/layout image
   (optionally list your own photo URLs under `photos:`).
2. Commit. The workflow
   [`.github/workflows/collage-from-template.yml`](.github/workflows/collage-from-template.yml)
   runs [`collage/from_template.py`](collage/from_template.py): it downloads the
   template, asks the vision model to **emulate its layout, mood and palette**,
   runs the optimize/evaluate loop with the **judge scoring each candidate by
   resemblance to your template**, commits the finished
   `collage/output/collage.jpg` back, and rewrites the file's **Result** section
   with a preview.

```
edit collage-template.md ──► GitHub Actions ──► collage/from_template.py
  (template: <image URL>)          │              (emulate template + build)
                                   ▼
   commit: collage/output/collage.jpg + updated Result section  (+ S3 if configured)
```

The bot commit carries `[skip ci]` so it doesn't retrigger itself. It works with
zero secrets (heuristic fallback + committed image); to enable vision and S3,
add repo **secrets** `OPENROUTER_API_KEY`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` and repo **variables** `AWS_REGION`, `PHOTO_BUCKET`
(optionally `COLLAGE_MODEL`).

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

collage/          # Python collage engine (runs on the box, or offline)
├── build.py      # CLI entry point (--date / --local / --no-upload)
├── from_template.py  # agentic build: parse collage-template.md → emulate template
├── remote.py     # fetch template/photo images from URLs (stdlib only)
├── config.py     # bucket, region, model, canvas, loop settings
├── s3io.py       # list/download photos, upload collage
├── theme.py      # vision (or heuristic) theme detection (+ template-aware)
├── layouts.py    # 5 algorithmic templates (grid/hero/filmstrip/columns/polaroid)
├── render.py     # Pillow rasteriser (cover-crop, rounded, rotate, footer)
├── evaluate.py   # vision judge + heuristic scorer (+ template resemblance)
├── optimize.py   # optimizer/evaluator loop (templates → mutations → winner)
└── sample/       # synthetic photos for offline testing

collage-template.md   # edit the template: URL + push → Actions builds a collage
.github/workflows/
└── collage-from-template.yml   # the GitHub-driven agentic build

server/           # Self-hosted collage API (the always-on box)
├── app.py        # FastAPI: POST /build + GET /healthz
├── setup.sh      # one-shot Ubuntu provisioner (deps, systemd, Caddy, ufw)
├── questr-api.service  # systemd unit
└── Caddyfile     # auto-HTTPS reverse proxy

infra/            # AWS setup: S3 CORS/policy + scoped questr-signer IAM user
```

---

Made with ❤️ by **Lawrence**