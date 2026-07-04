import { useState, useEffect, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

const MAP_STYLES = [
  {
    id: 'street',
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
  },
  {
    id: 'dark',
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxNativeZoom: 19,
  },
  {
    id: 'light',
    label: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxNativeZoom: 19,
  },
  {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxNativeZoom: 19,
  },
  {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png',
    attribution: 'Map tiles by <a href="https://stamen.com">Stamen Design</a>, hosted by <a href="https://stadiamaps.com/">Stadia Maps</a>. Data by <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxNativeZoom: 18,
  },
  {
    id: 'topo',
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxNativeZoom: 17,
  },
]

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Only flies when navTarget.id changes — ignores user-initiated zoom/pan
function MapUpdater({ navTarget }) {
  const map = useMap()
  useEffect(() => {
    if (navTarget) {
      map.flyTo(navTarget.center, navTarget.zoom, { duration: 1.2 })
    }
  }, [navTarget?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function MapResizeObserver() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

function MapClickHandler({ onMapClick, zoomRef }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng)
    },
    zoomend(e) {
      zoomRef.current = e.target.getZoom()
    },
  })
  return null
}

async function fetchElevation(lat, lon) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`
  )
  if (!res.ok) throw new Error('Elevation fetch failed')
  const data = await res.json()
  return data.elevation?.[0] ?? null
}

async function geocodeAddress(address) {
  const encoded = encodeURIComponent(address)
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
    { headers: { 'Accept-Language': 'en' } }
  )
  if (!res.ok) throw new Error('Geocoding request failed')
  const data = await res.json()
  if (!data.length) throw new Error('No results found for this address')
  const { lat, lon, display_name } = data[0]
  return { lat: parseFloat(lat), lon: parseFloat(lon), displayName: display_name }
}

// Build a clean human-readable address from Nominatim addressdetails
function formatAddress(data) {
  const a = data.address ?? {}
  const parts = []

  // Most specific first: building name, then number + road
  if (a.tourism || a.amenity || a.building) parts.push(a.tourism ?? a.amenity ?? a.building)
  if (a.house_number && a.road) parts.push(`${a.house_number} ${a.road}`)
  else if (a.road) parts.push(a.road)

  // Locality / neighbourhood
  const locality = a.suburb ?? a.neighbourhood ?? a.hamlet ?? a.village ?? a.town
  if (locality && locality !== (a.city ?? a.municipality)) parts.push(locality)

  // City / municipality
  const city = a.city ?? a.municipality ?? a.county
  if (city) parts.push(city)

  // Postcode + country
  if (a.postcode) parts.push(a.postcode)
  if (a.country) parts.push(a.country)

  // Fall back to Nominatim's own display_name if we couldn't build anything meaningful
  return parts.length >= 2 ? parts.join(', ') : data.display_name
}

async function reverseGeocode(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1`,
    { headers: { 'Accept-Language': 'en' } }
  )
  if (!res.ok) throw new Error('Reverse geocoding request failed')
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return formatAddress(data)
}

// ── Extra metrics helpers ─────────────────────────────────

function toDMS(deg, isLat) {
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const mFull = (abs - d) * 60
  const m = Math.floor(mFull)
  const s = ((mFull - m) * 60).toFixed(1)
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')
  return `${d}°${m}'${s}" ${dir}`
}

const GH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
function toGeohash(lat, lon, precision = 8) {
  let idx = 0, bit = 0, evenBit = true, geohash = ''
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180
  while (geohash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2
      if (lon >= mid) { idx = idx * 2 + 1; lonMin = mid } else { idx = idx * 2; lonMax = mid }
    } else {
      const mid = (latMin + latMax) / 2
      if (lat >= mid) { idx = idx * 2 + 1; latMin = mid } else { idx = idx * 2; latMax = mid }
    }
    evenBit = !evenBit
    if (++bit === 5) { geohash += GH_BASE32[idx]; bit = 0; idx = 0 }
  }
  return geohash
}

const GEORISQUES_RISKS = {
  inondation:                       { emoji: '🌊', label: 'Flood' },
  remonteeNappe:                    { emoji: '💧', label: 'Groundwater rise' },
  seisme:                           { emoji: '🫨', label: 'Earthquake' },
  mouvementTerrain:                 { emoji: '⛰️', label: 'Ground movement' },
  retraitGonflementArgile:          { emoji: '🏗️', label: 'Clay shrinkage' },
  reculTraitCote:                   { emoji: '🌊', label: 'Coastal erosion' },
  risqueCotier:                     { emoji: '🌊', label: 'Coastal risk' },
  avalanche:                        { emoji: '🏔️', label: 'Avalanche' },
  feuForet:                         { emoji: '🔥', label: 'Forest fire' },
  eruptionVolcanique:               { emoji: '🌋', label: 'Volcanic eruption' },
  cyclone:                          { emoji: '🌪️', label: 'Strong winds' },
  radon:                            { emoji: '☢️', label: 'Radon' },
  icpe:                             { emoji: '🏭', label: 'Industrial sites' },
  nucleaire:                        { emoji: '☢️', label: 'Nuclear' },
  canalisationsMatieresDangereuses: { emoji: '⚗️', label: 'Hazardous pipelines' },
  pollutionSols:                    { emoji: '🧪', label: 'Soil pollution' },
  ruptureBarrage:                   { emoji: '💦', label: 'Dam breach' },
  risqueMinier:                     { emoji: '⛏️', label: 'Mining risk' },
}

function riskSeverity(libelle) {
  if (!libelle) return 'medium'
  const l = libelle.toLowerCase()
  if (l.includes('important') || l.includes('élevé') || l.includes('fort')) return 'high'
  if (l.includes('faible')) return 'low'
  return 'medium'
}

function activeRisks(riskObj) {
  return Object.entries(riskObj ?? {})
    .filter(([, v]) => v?.present)
    .map(([key, v]) => ({
      key,
      emoji: GEORISQUES_RISKS[key]?.emoji ?? '⚠️',
      label: GEORISQUES_RISKS[key]?.label ?? key,
      severity: riskSeverity(v.libelleStatutCommune),
    }))
}

async function fetchGeorisques(lat, lon) {
  const r1 = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=code,nom`)
  if (!r1.ok) return null
  const communes = await r1.json()
  if (!communes.length) return null
  const { code, nom } = communes[0]
  const r2 = await fetch(
    `https://georisques.gouv.fr/api/v1/resultats_rapport_risque?code_insee=${code}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!r2.ok) return null
  const data = await r2.json()
  return {
    commune: nom,
    codeInsee: code,
    natural: activeRisks(data.risquesNaturels),
    tech: activeRisks(data.risquesTechnologiques),
  }
}

const WMO = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['❄️', 'Snow grains'],
  80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'],
  85: ['🌨️', 'Snow showers'], 86: ['❄️', 'Heavy snow showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm + hail'], 99: ['⛈️', 'Thunderstorm + heavy hail'],
}

function formatTime(isoStr) {
  return isoStr?.split('T')[1]?.slice(0, 5) ?? '—'
}

function formatOffset(seconds) {
  const h = Math.floor(Math.abs(seconds) / 3600)
  const m = Math.floor((Math.abs(seconds) % 3600) / 60)
  const sign = seconds >= 0 ? '+' : '-'
  return `UTC${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

async function fetchMoreInfo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weathercode,cloud_cover` +
    `&daily=sunrise,sunset,uv_index_max&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Weather fetch failed')
  const d = await res.json()
  const c = d.current
  const day = d.daily
  const [wEmoji, wLabel] = WMO[c.weathercode] ?? ['🌡️', `Code ${c.weathercode}`]
  return {
    weatherEmoji: wEmoji,
    weatherLabel: wLabel,
    temp: `${c.temperature_2m}${d.current_units.temperature_2m}`,
    humidity: `${c.relative_humidity_2m}%`,
    wind: `${c.wind_speed_10m} ${d.current_units.wind_speed_10m}`,
    precipitation: `${c.precipitation} ${d.current_units.precipitation}`,
    cloudCover: `${c.cloud_cover}%`,
    uvIndex: day.uv_index_max[0]?.toFixed(1) ?? '—',
    sunrise: formatTime(day.sunrise[0]),
    sunset: formatTime(day.sunset[0]),
    timezone: d.timezone.replace('_', ' '),
    utcOffset: formatOffset(d.utc_offset_seconds),
    dmsLat: toDMS(lat, true),
    dmsLon: toDMS(lon, false),
    geohash: toGeohash(lat, lon),
  }
}

// ── Easter Egg Hunt (POIs via Overpass) ───────────────────

const HUNT_SECONDS = 180
const JOURNAL_KEY = 'tc-travel-journal'

// ── Photo collage (AWS Lambda signing endpoint) ───────────
// Function URL of the Questr Lambda that presigns S3 uploads and triggers the
// GitHub Actions collage build. Set VITE_QUESTR_SIGN_URL at build time; when
// unset the collage UI shows a friendly "not configured yet" note.
const SIGN_URL = (import.meta.env.VITE_QUESTR_SIGN_URL || '').replace(/\/$/, '')
const COLLAGE_MIN = 3
const COLLAGE_MAX = 6

const POI_TYPES = {
  attraction:          { emoji: '🎡', label: 'Attraction', points: 10 },
  museum:              { emoji: '🏛️', label: 'Museum', points: 20 },
  gallery:             { emoji: '🖼️', label: 'Gallery', points: 20 },
  viewpoint:           { emoji: '🔭', label: 'Viewpoint', points: 15 },
  zoo:                 { emoji: '🦁', label: 'Zoo', points: 25 },
  theme_park:          { emoji: '🎢', label: 'Theme park', points: 30 },
  aquarium:            { emoji: '🐠', label: 'Aquarium', points: 25 },
  monument:            { emoji: '🗿', label: 'Monument', points: 20 },
  memorial:            { emoji: '🕯️', label: 'Memorial', points: 10 },
  castle:              { emoji: '🏰', label: 'Castle', points: 30 },
  ruins:               { emoji: '🏚️', label: 'Ruins', points: 15 },
  fort:                { emoji: '🛡️', label: 'Fort', points: 20 },
  archaeological_site: { emoji: '⛏️', label: 'Archaeological site', points: 25 },
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

async function fetchPOIs(lat, lon, radius = 2500, cap = 15) {
  const tourism = Object.keys(POI_TYPES).filter(k => !(k in { monument: 1, memorial: 1, castle: 1, ruins: 1, fort: 1, archaeological_site: 1 })).join('|')
  const historic = 'monument|memorial|castle|ruins|fort|archaeological_site'
  const q =
    `[out:json][timeout:25];(` +
    `nwr["tourism"~"^(${tourism})$"]["name"](around:${radius},${lat},${lon});` +
    `nwr["historic"~"^(${historic})$"]["name"](around:${radius},${lat},${lon});` +
    `);out center 60;`
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(q),
  })
  if (!res.ok) throw new Error('POI fetch failed')
  const data = await res.json()
  const seen = new Set()
  const pois = []
  for (const el of data.elements ?? []) {
    const name = el.tags?.name
    const pLat = el.lat ?? el.center?.lat
    const pLon = el.lon ?? el.center?.lon
    if (!name || seen.has(name) || pLat == null) continue
    const typeKey = POI_TYPES[el.tags.tourism] ? el.tags.tourism
      : POI_TYPES[el.tags.historic] ? el.tags.historic : null
    if (!typeKey) continue
    seen.add(name)
    pois.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: pLat,
      lon: pLon,
      typeKey,
      ...POI_TYPES[typeKey],
      dist: haversineKm(lat, lon, pLat, pLon),
      wikipedia: el.tags.wikipedia ?? null, // "lang:Title"
    })
  }
  return pois.sort((a, b) => a.dist - b.dist).slice(0, cap)
}

// Wikipedia REST summary — the informative payoff. Cached per POI id.
const wikiCache = new Map()
async function fetchWikiFact(poi) {
  if (wikiCache.has(poi.id)) return wikiCache.get(poi.id)
  let fact = null
  if (poi.wikipedia?.includes(':')) {
    try {
      const i = poi.wikipedia.indexOf(':')
      const lang = poi.wikipedia.slice(0, i)
      const title = poi.wikipedia.slice(i + 1)
      const res = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      )
      if (res.ok) {
        const d = await res.json()
        if (d.extract) fact = { extract: d.extract, thumb: d.thumbnail?.source ?? null }
      }
    } catch { /* fall through to null — UI shows a fallback line */ }
  }
  wikiCache.set(poi.id, fact)
  return fact
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Quiz options: the real name + 2 decoys from the same round
function quizOptions(poi, pois) {
  const decoys = shuffle(pois.filter(p => p.id !== poi.id)).slice(0, 2).map(p => p.name)
  return shuffle([poi.name, ...decoys])
}

// Guess-the-Spot scoring: full points inside 150 m, linear decay to 0 at 2 km
function guessPoints(distKm) {
  if (distKm <= 0.15) return 100
  if (distKm >= 2) return 0
  return Math.round(100 * (1 - (distKm - 0.15) / 1.85))
}

const LEVELS = [
  { name: 'Tourist', xp: 0 },
  { name: 'Sightseer', xp: 250 },
  { name: 'Explorer', xp: 750 },
  { name: 'Pathfinder', xp: 2000 },
  { name: 'Globetrotter', xp: 5000 },
  { name: 'Legend', xp: 12000 },
]

function levelForXp(xp) {
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i
  const next = LEVELS[idx + 1] ?? null
  return {
    idx,
    name: LEVELS[idx].name,
    next: next?.name ?? null,
    progress: next ? (xp - LEVELS[idx].xp) / (next.xp - LEVELS[idx].xp) : 1,
    toNext: next ? next.xp - xp : 0,
  }
}

const PASSPORT_KEY = 'tc-passport'

function loadPassport() {
  try {
    return JSON.parse(localStorage.getItem(PASSPORT_KEY)) ?? { xp: 0, stamps: {} }
  } catch {
    return { xp: 0, stamps: {} }
  }
}

// "Kyoto, Kyoto Prefecture, Japan" → "Kyoto Prefecture, Japan" (stable per-city stamp key)
function cityKeyFromArea(area) {
  const parts = (area ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return parts.slice(-2).join(', ') || 'Somewhere on Earth'
}

// Cached so marker icons keep stable references across re-renders (the hunt
// timer ticks 4×/s — fresh icon objects would make Leaflet rebuild marker DOM)
const iconCache = new Map()
function poiIcon(state, emoji) {
  // state: 'hidden' | 'found' | 'missed'
  const key = `${state}|${emoji}`
  if (!iconCache.has(key)) {
    iconCache.set(key, L.divIcon({
      className: '',
      html: `<div class="egg-pin egg-${state}">${state === 'hidden' ? '?' : emoji}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    }))
  }
  return iconCache.get(key)
}

function loadJournal() {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)) ?? [] } catch { return [] }
}

const guessDotIcon = L.divIcon({
  className: '',
  html: '<div class="guess-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

const IDLE_HUNT = {
  status: 'idle',   // idle | active | paused | ended
  mode: null,       // 'quiz' | 'guess'
  foundIds: [],
  missedIds: [],
  score: 0,
  streak: 0,
  endsAt: 0,
  remaining: HUNT_SECONDS,
  endReason: null,
  quiz: null,       // { poi, options, answered: null|'correct'|'wrong', pts, fact: undefined|null|{extract,thumb} }
  targets: [],      // ordered POI ids (guess mode)
  targetIdx: 0,
  lastGuess: null,  // { lat, lon, distKm, pts, foundIt, poiId }
  levelUp: null,
}

// ── Icons ─────────────────────────────────────────────────
const SunIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const MoonIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

const PinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
)

const CoordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)

const MountainIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 20 9 4 15 14 18 10 21 20"/>
  </svg>
)

const LocateIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    <circle cx="12" cy="12" r="8" strokeDasharray="2 2"/>
  </svg>
)

export default function App() {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [mode, setMode] = useState('address') // 'address' | 'coords'
  const [mapStyleId, setMapStyleId] = useState('street')

  // Address mode state
  const [address, setAddress] = useState('')

  // Coords mode state
  const [latInput, setLatInput] = useState('')
  const [lonInput, setLonInput] = useState('')

  // Result state
  const [result, setResult] = useState(null)
  const [moreInfo, setMoreInfo] = useState(null)
  const [moreExpanded, setMoreExpanded] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Map state
  const [navTarget, setNavTarget] = useState(null) // { center, zoom, id }
  const zoomRef = useRef(2) // tracks live map zoom without triggering re-renders
  const [markerPos, setMarkerPos] = useState(null)

  // Locating state
  const [locating, setLocating] = useState(false)

  // Map expand state (mobile)
  const [mapExpanded, setMapExpanded] = useState(false)

  // Easter Egg Hunt state
  const [pois, setPois] = useState(null)          // null = not fetched, [] = none found
  const [poisLoading, setPoisLoading] = useState(false)
  const [hunt, setHunt] = useState(IDLE_HUNT)
  const [huntArea, setHuntArea] = useState('')
  const [journal, setJournal] = useState(loadJournal)
  const [journalOpen, setJournalOpen] = useState(false)
  // Photo-collage feature
  const [photoFiles, setPhotoFiles] = useState([])   // File[] picked, not yet uploaded
  const [uploading, setUploading] = useState(false)
  const [collageStatus, setCollageStatus] = useState('') // user-facing progress line
  const [collageUrl, setCollageUrl] = useState('')   // public S3 collage URL to show
  const [collageReady, setCollageReady] = useState(false)
  const photoInputRef = useRef(null)
  const [clueFact, setClueFact] = useState(null)  // wiki fact for the current guess target
  const [passport, setPassport] = useState(loadPassport)
  const [passportOpen, setPassportOpen] = useState(false)

  // Latest-value refs so Leaflet event handlers never read stale game state
  const huntRef = useRef(hunt)
  huntRef.current = hunt
  const poisRef = useRef(pois)
  poisRef.current = pois

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
  }, [journal])

  useEffect(() => {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify(passport))
  }, [passport])

  // Countdown tick while a hunt is running ('paused' freezes the clock)
  useEffect(() => {
    if (hunt.status !== 'active') return
    const t = setInterval(() => {
      setHunt(h => {
        if (h.status !== 'active') return h
        const remaining = Math.max(0, Math.round((h.endsAt - Date.now()) / 1000))
        if (remaining === 0) return { ...h, remaining: 0, status: 'ended', endReason: 'time' }
        return { ...h, remaining }
      })
    }, 250)
    return () => clearInterval(t)
  }, [hunt.status])

  // Eagerly fetch the wiki fact for the current Guess-the-Spot target
  useEffect(() => {
    if (hunt.mode !== 'guess') return
    const poi = pois?.find(p => p.id === hunt.targets[hunt.targetIdx])
    if (!poi) return
    let alive = true
    setClueFact(null)
    fetchWikiFact(poi).then(f => { if (alive) setClueFact(f) })
    return () => { alive = false }
  }, [hunt.mode, hunt.targets, hunt.targetIdx, pois])

  // Bank the round into the passport exactly once when a hunt ends
  const endedHandled = useRef(false)
  useEffect(() => {
    if (hunt.status !== 'ended') {
      endedHandled.current = false
      return
    }
    if (endedHandled.current) return
    endedHandled.current = true
    const beforeIdx = levelForXp(passport.xp).idx
    const afterIdx = levelForXp(passport.xp + hunt.score).idx
    const key = cityKeyFromArea(huntArea)
    setPassport(p => {
      const prev = p.stamps[key]
      const foundIds = [...new Set([...(prev?.foundIds ?? []), ...hunt.foundIds])]
      return {
        xp: p.xp + hunt.score,
        stamps: {
          ...p.stamps,
          [key]: {
            name: key,
            foundIds,
            total: Math.max(prev?.total ?? 0, pois?.length ?? 0, foundIds.length),
            bestScore: Math.max(prev?.bestScore ?? 0, hunt.score),
            lastPlayed: Date.now(),
          },
        },
      }
    })
    if (afterIdx > beforeIdx) setHunt(h => ({ ...h, levelUp: LEVELS[afterIdx].name }))
  }, [hunt.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPois = useCallback(async (lat, lon, area) => {
    setPois(null)
    setHunt(IDLE_HUNT)
    setHuntArea(area ?? '')
    setPoisLoading(true)
    try {
      setPois(await fetchPOIs(lat, lon))
    } catch {
      setPois([]) // non-critical — hunt simply unavailable here
    } finally {
      setPoisLoading(false)
    }
  }, [])

  const startHunt = useCallback((mode) => {
    setHunt({
      ...IDLE_HUNT,
      status: 'active',
      mode,
      targets: mode === 'guess' ? shuffle(pois ?? []).slice(0, 10).map(p => p.id) : [],
      endsAt: Date.now() + HUNT_SECONDS * 1000,
    })
  }, [pois])

  const addJournalEntry = useCallback((poi) => {
    setJournal(j => j.some(e => e.poiId === poi.id) ? j : [{
      poiId: poi.id,
      name: poi.name,
      emoji: poi.emoji,
      typeLabel: poi.label,
      lat: poi.lat,
      lon: poi.lon,
      area: huntArea,
      ts: Date.now(),
    }, ...j])
  }, [huntArea])

  // ── Quiz Hunt ──
  const handleEggClick = useCallback((poi) => {
    setHunt(h => {
      if (h.status !== 'active' || h.mode !== 'quiz' || h.quiz) return h
      if (h.foundIds.includes(poi.id) || h.missedIds.includes(poi.id)) return h
      return { ...h, quiz: { poi, options: quizOptions(poi, poisRef.current ?? []), answered: null, pts: 0, fact: undefined } }
    })
  }, [])

  const answerQuiz = useCallback((option) => {
    const h0 = huntRef.current
    const q = h0.quiz
    if (!q || q.answered) return
    const poi = q.poi
    const correct = option === poi.name
    const streak = correct ? h0.streak + 1 : 0
    const pts = correct ? poi.points * Math.min(streak, 5) : 0
    if (correct) addJournalEntry(poi)
    setHunt(h => {
      if (!h.quiz || h.quiz.answered) return h
      return {
        ...h,
        status: 'paused', // freeze the clock while the fact card is open
        remaining: Math.max(0, Math.round((h.endsAt - Date.now()) / 1000)),
        streak,
        score: h.score + pts,
        foundIds: correct ? [...h.foundIds, poi.id] : h.foundIds,
        missedIds: correct ? h.missedIds : [...h.missedIds, poi.id],
        quiz: { ...h.quiz, answered: correct ? 'correct' : 'wrong', pts },
      }
    })
    fetchWikiFact(poi).then(fact => {
      setHunt(h => h.quiz?.poi.id === poi.id ? { ...h, quiz: { ...h.quiz, fact } } : h)
    })
  }, [addJournalEntry])

  const closeQuiz = useCallback(() => {
    setHunt(h => {
      if (!h.quiz) return h
      const allDone = h.foundIds.length + h.missedIds.length >= (poisRef.current?.length ?? 0)
      if (allDone) return { ...h, quiz: null, status: 'ended', endReason: 'complete' }
      if (h.remaining <= 0) return { ...h, quiz: null, status: 'ended', endReason: 'time' }
      return { ...h, quiz: null, status: 'active', endsAt: Date.now() + h.remaining * 1000 }
    })
  }, [])

  // ── Guess-the-Spot ──
  const handleGuess = useCallback((lat, lon) => {
    const h0 = huntRef.current
    if (h0.status !== 'active' || h0.mode !== 'guess' || h0.lastGuess) return
    const poi = poisRef.current?.find(p => p.id === h0.targets[h0.targetIdx])
    if (!poi) return
    const distKm = haversineKm(lat, lon, poi.lat, poi.lon)
    const pts = guessPoints(distKm)
    const foundIt = distKm <= 0.5
    if (foundIt) addJournalEntry(poi)
    setHunt(h => {
      if (h.lastGuess) return h
      return {
        ...h,
        status: 'paused',
        remaining: Math.max(0, Math.round((h.endsAt - Date.now()) / 1000)),
        score: h.score + pts,
        foundIds: foundIt ? [...h.foundIds, poi.id] : h.foundIds,
        missedIds: foundIt ? h.missedIds : [...h.missedIds, poi.id],
        lastGuess: { lat, lon, distKm, pts, foundIt, poiId: poi.id },
      }
    })
  }, [addJournalEntry])

  const nextTarget = useCallback(() => {
    setHunt(h => {
      if (!h.lastGuess) return h
      const nextIdx = h.targetIdx + 1
      if (nextIdx >= h.targets.length) return { ...h, lastGuess: null, status: 'ended', endReason: 'complete' }
      if (h.remaining <= 0) return { ...h, lastGuess: null, status: 'ended', endReason: 'time' }
      return { ...h, lastGuess: null, targetIdx: nextIdx, status: 'active', endsAt: Date.now() + h.remaining * 1000 }
    })
  }, [])

  // ── Photo collage ──────────────────────────────────────
  const pickPhotos = useCallback((fileList) => {
    const imgs = Array.from(fileList).filter(f => f.type.startsWith('image/'))
    setPhotoFiles(prev => [...prev, ...imgs].slice(0, COLLAGE_MAX))
    setCollageStatus('')
  }, [])

  // Poll the public collage URL until Actions has published the image.
  const pollCollage = useCallback((target) => {
    let tries = 0
    const attempt = () => {
      tries += 1
      const img = new Image()
      img.onload = () => {
        setCollageUrl(target)
        setCollageReady(true)
        setCollageStatus('Your collage is ready! 🎉')
      }
      img.onerror = () => {
        if (tries >= 20) {         // ~5 min at 15s cadence
          setCollageStatus('Still building — check back in a minute and reopen the Journal.')
          return
        }
        setCollageStatus(`Building your collage… (${tries}/20)`)
        setTimeout(attempt, 15000)
      }
      img.src = `${target}?t=${Date.now()}`   // cache-bust each poll
    }
    setTimeout(attempt, 15000)
  }, [])

  // Upload each photo via a Lambda-presigned S3 PUT, then trigger the build.
  const uploadAndBuild = useCallback(async () => {
    if (!SIGN_URL) { setCollageStatus('Collage service not configured yet.'); return }
    if (photoFiles.length < COLLAGE_MIN) {
      setCollageStatus(`Pick at least ${COLLAGE_MIN} photos.`); return
    }
    setUploading(true)
    setCollageReady(false)
    setCollageUrl('')
    let date = ''
    let target = ''      // public URL the finished collage will live at
    try {
      for (let i = 0; i < photoFiles.length; i++) {
        const file = photoFiles[i]
        setCollageStatus(`Uploading photo ${i + 1} of ${photoFiles.length}…`)
        const signRes = await fetch(SIGN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sign', contentType: file.type }),
        })
        if (!signRes.ok) throw new Error('Could not get an upload URL.')
        const { uploadUrl, date: d, collageUrl: cu } = await signRes.json()
        date = d
        target = cu
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!put.ok) throw new Error('Upload failed.')
      }
      setCollageStatus('Building your collage… this runs on GitHub Actions and takes a minute.')
      const build = await fetch(SIGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'build', date }),
      })
      if (!build.ok) throw new Error('Could not start the collage build.')
      setPhotoFiles([])
      pollCollage(target)
    } catch (err) {
      setCollageStatus(err.message || 'Something went wrong.')
    } finally {
      setUploading(false)
    }
  }, [photoFiles, pollCollage])

  const loadMoreInfo = useCallback(async (lat, lon) => {
    setMoreInfo(null)
    setMoreExpanded(false)
    setMoreLoading(true)
    try {
      const [info, georisques] = await Promise.all([
        fetchMoreInfo(lat, lon),
        fetchGeorisques(lat, lon).catch(() => null),
      ])
      setMoreInfo({ ...info, georisques })
    } catch {
      // silently fail — extra metrics are non-critical
    } finally {
      setMoreLoading(false)
    }
  }, [])

  // Shared reverse-geocode flow used by manual input, map click, and locate me
  // keepZoom=true → don't change zoom (map click); false → zoom to 13 minimum (locate/search)
  const lookupCoords = useCallback(async (lat, lon, keepZoom = false) => {
    setLoading(true)
    setError('')
    setResult(null)
    setLatInput(String(lat))
    setLonInput(String(lon))
    setMode('coords')
    try {
      const [addr, elevation] = await Promise.all([
        reverseGeocode(lat, lon),
        fetchElevation(lat, lon),
      ])
      setResult({ lat, lon, address: addr, elevation })
      const zoom = keepZoom ? zoomRef.current : Math.max(zoomRef.current, 13)
      setNavTarget({ center: [lat, lon], zoom, id: Date.now() })
      setMarkerPos([lat, lon])
      loadMoreInfo(lat, lon)
      loadPois(lat, lon, addr)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [loadMoreInfo, loadPois])

  const handleAddressLookup = useCallback(async () => {
    if (!address.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const { lat, lon, displayName } = await geocodeAddress(address.trim())
      const elevation = await fetchElevation(lat, lon)
      setResult({ lat, lon, address: displayName, elevation })
      setNavTarget({ center: [lat, lon], zoom: Math.max(zoomRef.current, 13), id: Date.now() })
      setMarkerPos([lat, lon])
      loadMoreInfo(lat, lon)
      loadPois(lat, lon, displayName)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [address, loadMoreInfo, loadPois])

  const handleCoordsLookup = useCallback(async () => {
    const lat = parseFloat(latInput)
    const lon = parseFloat(lonInput)
    if (isNaN(lat) || isNaN(lon)) { setError('Please enter valid numeric coordinates.'); return }
    if (lat < -90 || lat > 90) { setError('Latitude must be between -90 and 90.'); return }
    if (lon < -180 || lon > 180) { setError('Longitude must be between -180 and 180.'); return }
    await lookupCoords(lat, lon)
  }, [latInput, lonInput, lookupCoords])

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation is not supported by your browser.'); return }
    setLocating(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        lookupCoords(pos.coords.latitude, pos.coords.longitude)
      },
      (err) => {
        setLocating(false)
        setError(`Location error: ${err.message}`)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [lookupCoords])

  const handleMapClick = useCallback((lat, lon) => {
    const h = huntRef.current
    if (h.status === 'active' && h.mode === 'guess') { handleGuess(lat, lon); return }
    if (h.status === 'active' || h.status === 'paused') return // mid-game clicks never trigger lookups
    lookupCoords(lat, lon, true) // keepZoom=true: stay at current zoom
  }, [lookupCoords, handleGuess])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      mode === 'address' ? handleAddressLookup() : handleCoordsLookup()
    }
  }

  const switchMode = (m) => {
    setMode(m)
    setError('')
    setResult(null)
  }

  const handleReset = () => {
    setAddress('')
    setLatInput('')
    setLonInput('')
    setResult(null)
    setMoreInfo(null)
    setMoreExpanded(false)
    setError('')
    setMarkerPos(null)
    setPois(null)
    setHunt(IDLE_HUNT)
    setHuntArea('')
    setNavTarget({ center: [20, 0], zoom: 2, id: Date.now() })
    zoomRef.current = 2
  }

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <PinIcon />
            <span>Questr</span>
          </div>
          <p className="tagline">Turn any place on Earth into an adventure — explore, play, and collect the world 🌍</p>
        </div>
        <div className="header-actions">
          <button className="journal-btn" onClick={() => setPassportOpen(true)} title="Travel Passport">
            🛂 Passport<span className="journal-count">{levelForXp(passport.xp).name}</span>
          </button>
          <button className="journal-btn" onClick={() => setJournalOpen(true)} title="Travel Journal">
            📖 Journal{journal.length > 0 && <span className="journal-count">{journal.length}</span>}
          </button>
          <button className="reset-btn" onClick={handleReset} title="Reset">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Reset
          </button>
          <button className="theme-toggle" onClick={() => setDark(d => !d)} aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className={`main ${mapExpanded ? 'map-fullscreen' : ''}`}>
        <div className="panel">
          <div className="mode-tabs">
            <button
              className={`tab ${mode === 'address' ? 'active' : ''}`}
              onClick={() => switchMode('address')}
            >
              <PinIcon /> Address → Coords
            </button>
            <button
              className={`tab ${mode === 'coords' ? 'active' : ''}`}
              onClick={() => switchMode('coords')}
            >
              <CoordIcon /> Coords → Address
            </button>
          </div>

          {mode === 'address' ? (
            <div className="input-group">
              <label className="input-label">Enter any address or place name</label>
              <input
                className="input"
                type="text"
                placeholder="e.g. Eiffel Tower, Paris"
                value={address}
                onChange={e => setAddress(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="btn-row">
                <button className="btn" onClick={handleAddressLookup} disabled={loading || locating}>
                  {loading ? <span className="spinner" /> : 'Search'}
                </button>
                <button
                  className={`btn-locate ${locating ? 'locating' : ''}`}
                  onClick={handleLocateMe}
                  disabled={loading || locating}
                  title="Use my location"
                >
                  <LocateIcon />
                </button>
              </div>
            </div>
          ) : (
            <div className="input-group">
              <label className="input-label">Enter latitude & longitude</label>
              <div className="coords-inputs">
                <input
                  className="input"
                  type="number"
                  placeholder="Latitude (-90 to 90)"
                  value={latInput}
                  onChange={e => setLatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  step="any"
                  min="-90"
                  max="90"
                />
                <input
                  className="input"
                  type="number"
                  placeholder="Longitude (-180 to 180)"
                  value={lonInput}
                  onChange={e => setLonInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  step="any"
                  min="-180"
                  max="180"
                />
              </div>
              <div className="btn-row">
                <button className="btn" onClick={handleCoordsLookup} disabled={loading || locating}>
                  {loading ? <span className="spinner" /> : 'Search'}
                </button>
                <button
                  className={`btn-locate ${locating ? 'locating' : ''}`}
                  onClick={handleLocateMe}
                  disabled={loading || locating}
                  title="Use my location"
                >
                  <LocateIcon />
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="error-card">
              <span>⚠ {error}</span>
            </div>
          )}

          {result && (
            <div className="result-card">
              <div className="result-row">
                <div className="result-item">
                  <span className="result-icon"><PinIcon /></span>
                  <div>
                    <div className="result-label">Address</div>
                    <div className="result-value address-value">{result.address}</div>
                  </div>
                </div>
              </div>
              <div className="result-chips">
                <div className="chip">
                  <span className="chip-icon"><CoordIcon /></span>
                  <div className="chip-body">
                    <div className="chip-label">Latitude</div>
                    <div className="chip-val">{result.lat.toFixed(6)}°</div>
                  </div>
                </div>
                <div className="chip">
                  <span className="chip-icon"><CoordIcon /></span>
                  <div className="chip-body">
                    <div className="chip-label">Longitude</div>
                    <div className="chip-val">{result.lon.toFixed(6)}°</div>
                  </div>
                </div>
                <div className="chip">
                  <span className="chip-icon"><MountainIcon /></span>
                  <div className="chip-body">
                    <div className="chip-label">Elevation</div>
                    <div className="chip-val">
                      {result.elevation !== null ? `${result.elevation.toFixed(1)} m` : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="copy-row">
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard.writeText(`${result.lat}, ${result.lon}`)}
                >
                  Copy Coordinates
                </button>
                <button
                  className="copy-btn"
                  onClick={() => navigator.clipboard.writeText(result.address)}
                >
                  Copy Address
                </button>
              </div>

              {/* More Info expandable */}
              <button
                className="more-toggle"
                onClick={() => setMoreExpanded(x => !x)}
                disabled={moreLoading && !moreInfo}
              >
                {moreLoading && !moreInfo
                  ? <><span className="spinner spinner-sm" /> Loading extra info…</>
                  : <>{moreExpanded ? '▲' : '▼'} {moreExpanded ? 'Hide' : 'Show'} more info</>
                }
              </button>

              {moreExpanded && moreInfo && (
                <div className="more-grid">
                  <div className="more-section">
                    <div className="more-section-title">🌤 Weather</div>
                    <div className="more-row"><span>{moreInfo.weatherEmoji} {moreInfo.weatherLabel}</span></div>
                    <div className="more-row"><span className="more-label">Temperature</span><span className="more-val">{moreInfo.temp}</span></div>
                    <div className="more-row"><span className="more-label">Humidity</span><span className="more-val">{moreInfo.humidity}</span></div>
                    <div className="more-row"><span className="more-label">Wind</span><span className="more-val">{moreInfo.wind}</span></div>
                    <div className="more-row"><span className="more-label">Precipitation</span><span className="more-val">{moreInfo.precipitation}</span></div>
                    <div className="more-row"><span className="more-label">Cloud cover</span><span className="more-val">{moreInfo.cloudCover}</span></div>
                    <div className="more-row"><span className="more-label">UV Index (max)</span><span className="more-val">{moreInfo.uvIndex}</span></div>
                  </div>
                  <div className="more-section">
                    <div className="more-section-title">🕐 Time &amp; Sun</div>
                    <div className="more-row"><span className="more-label">Timezone</span><span className="more-val">{moreInfo.timezone}</span></div>
                    <div className="more-row"><span className="more-label">UTC Offset</span><span className="more-val">{moreInfo.utcOffset}</span></div>
                    <div className="more-row"><span className="more-label">Sunrise</span><span className="more-val">🌅 {moreInfo.sunrise}</span></div>
                    <div className="more-row"><span className="more-label">Sunset</span><span className="more-val">🌇 {moreInfo.sunset}</span></div>
                  </div>
                  <div className="more-section">
                    <div className="more-section-title">📐 Coordinates</div>
                    <div className="more-row"><span className="more-label">Lat (DMS)</span><span className="more-val">{moreInfo.dmsLat}</span></div>
                    <div className="more-row"><span className="more-label">Lon (DMS)</span><span className="more-val">{moreInfo.dmsLon}</span></div>
                    <div className="more-row"><span className="more-label">Geohash</span><span className="more-val mono">{moreInfo.geohash}</span></div>
                  </div>
                  {moreInfo.georisques && (() => {
                    const risks = [...moreInfo.georisques.natural, ...moreInfo.georisques.tech]
                    if (!risks.length) return null
                    return (
                      <div className="more-section">
                        <div className="more-section-title">🏛️ Risks · {moreInfo.georisques.commune}</div>
                        {risks.map(r => (
                          <div key={r.key} className="risk-row">
                            <span className="risk-name">{r.emoji} {r.label}</span>
                            <span className={`risk-badge risk-badge--${r.severity}`}>
                              {r.severity === 'high' ? 'High' : r.severity === 'low' ? 'Low' : 'Present'}
                            </span>
                          </div>
                        ))}
                        <div className="risk-source-note">Géorisques · commune level</div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {result && (poisLoading || (pois && pois.length > 0)) && (
            <div className="hunt-card">
              {poisLoading ? (
                <div className="hunt-idle">
                  <span className="spinner spinner-sm" /> Scouting secret spots nearby…
                </div>
              ) : hunt.status === 'idle' || hunt.status === 'ended' ? (
                <div className="hunt-idle">
                  {hunt.status === 'idle' ? (
                    <>
                      <div className="hunt-title">🥚 Explore &amp; Play</div>
                      <p className="hunt-desc">
                        {pois.length} tourist spots discovered nearby. Pick your game —
                        every place you identify lands in your travel journal and earns passport XP.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="hunt-title">
                        {hunt.endReason === 'complete' ? '🎉 Round complete!'
                          : hunt.endReason === 'time' ? "⏱️ Time's up!"
                          : '🏳️ Round ended'}
                      </div>
                      <p className="hunt-desc">
                        You identified <strong>{hunt.foundIds.length}/{hunt.mode === 'guess' ? hunt.targets.length : pois.length}</strong> spots
                        for <strong>{hunt.score} points</strong> (+{hunt.score} XP).
                        {hunt.levelUp && <span className="hunt-levelup"> ⬆️ You reached {hunt.levelUp}!</span>}
                      </p>
                    </>
                  )}
                  <div className="hunt-mode-btns">
                    <button
                      className="btn hunt-mode-btn"
                      onClick={() => startHunt('quiz')}
                      disabled={pois.length < 4}
                      title={pois.length < 4 ? 'Needs at least 4 spots nearby' : 'Answer name-that-place quizzes'}
                    >
                      🧠 Quiz Hunt
                    </button>
                    <button
                      className="btn hunt-mode-btn"
                      onClick={() => startHunt('guess')}
                      title="Pin the place on the map from its story"
                    >
                      🎯 Guess the Spot
                    </button>
                  </div>
                </div>
              ) : (
                <div className="hunt-active">
                  <div className="hunt-stats">
                    <div className="hunt-stat">
                      <span className="hunt-stat-label">Time</span>
                      <span className={`hunt-stat-val hunt-timer ${hunt.remaining <= 30 ? 'hunt-timer-low' : ''}`}>
                        {Math.floor(hunt.remaining / 60)}:{String(hunt.remaining % 60).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="hunt-stat">
                      <span className="hunt-stat-label">{hunt.mode === 'guess' ? 'Spot' : 'Found'}</span>
                      <span className="hunt-stat-val">
                        {hunt.mode === 'guess'
                          ? `${Math.min(hunt.targetIdx + 1, hunt.targets.length)}/${hunt.targets.length}`
                          : `${hunt.foundIds.length}/${pois.length}`}
                      </span>
                    </div>
                    <div className="hunt-stat">
                      <span className="hunt-stat-label">Score</span>
                      <span className="hunt-stat-val">{hunt.score}</span>
                    </div>
                    {hunt.mode === 'quiz' && (
                      <div className={`hunt-stat ${hunt.streak > 0 ? 'hunt-stat-streak' : ''}`}>
                        <span className="hunt-stat-label">Streak</span>
                        <span className="hunt-stat-val">🔥×{Math.min(hunt.streak + 1, 5)}</span>
                      </div>
                    )}
                  </div>

                  {hunt.mode === 'quiz' ? (
                    <p className="hunt-desc">Click the <strong>?</strong> eggs on the map, then name the place!</p>
                  ) : (() => {
                    const target = pois.find(p => p.id === hunt.targets[hunt.targetIdx])
                    if (!target) return null
                    return hunt.lastGuess ? (
                      <div className="guess-result">
                        <div className={`quiz-verdict quiz-verdict--${hunt.lastGuess.foundIt ? 'correct' : 'wrong'}`}>
                          🎯 {formatDist(hunt.lastGuess.distKm)} away — +{hunt.lastGuess.pts} pts
                          {hunt.lastGuess.foundIt ? ' · Found it!' : hunt.lastGuess.distKm <= 0.8 ? ' · So close!' : ''}
                        </div>
                        <button className="btn hunt-start-btn" onClick={nextTarget}>
                          {hunt.targetIdx + 1 >= hunt.targets.length ? 'Finish round' : 'Next spot →'}
                        </button>
                      </div>
                    ) : (
                      <div className="clue-card">
                        <div className="clue-kicker">🎯 Find this place</div>
                        <div className="fact-title">{target.emoji} {target.name}</div>
                        <div className="fact-type">{target.label}</div>
                        {clueFact?.thumb && <img className="fact-thumb" src={clueFact.thumb} alt={target.name} />}
                        {clueFact?.extract && <p className="fact-extract">{clueFact.extract}</p>}
                        <p className="clue-instruction">Click the map where you think it is!</p>
                      </div>
                    )
                  })()}

                  <button
                    className="hunt-end-btn"
                    onClick={() => setHunt(h => ({ ...h, quiz: null, lastGuess: null, status: 'ended', endReason: 'quit' }))}
                  >
                    Give up
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="map-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            Click anywhere on the map to reverse geocode
          </div>
        </div>

        <div className="map-container">
          <MapContainer
            center={[20, 0]}
            zoom={2}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
          >
            {(() => {
              const style = MAP_STYLES.find(s => s.id === mapStyleId) ?? MAP_STYLES[0]
              return (
                <TileLayer
                  key={style.id}
                  attribution={style.attribution}
                  url={style.url}
                  maxNativeZoom={style.maxNativeZoom}
                  maxZoom={22}
                />
              )
            })()}
            <MapResizeObserver />
            <MapUpdater navTarget={navTarget} />
            <MapClickHandler onMapClick={handleMapClick} zoomRef={zoomRef} />
            {hunt.mode === 'quiz' && hunt.status !== 'idle' && pois?.map(poi => {
              const found = hunt.foundIds.includes(poi.id)
              const missed = hunt.missedIds.includes(poi.id) || (hunt.status === 'ended' && !found)
              const state = found ? 'found' : missed ? 'missed' : 'hidden'
              return (
                <Marker
                  key={poi.id}
                  position={[poi.lat, poi.lon]}
                  icon={poiIcon(state, poi.emoji)}
                  eventHandlers={{ click: () => handleEggClick(poi) }}
                >
                  {state !== 'hidden' && (
                    <Popup>
                      <strong>{poi.emoji} {poi.name}</strong>
                      <br />{poi.label}
                    </Popup>
                  )}
                </Marker>
              )
            })}
            {hunt.mode === 'guess' && hunt.status !== 'idle' && pois && (
              hunt.status === 'ended'
                ? hunt.targets
                : hunt.targets.slice(0, hunt.targetIdx + (hunt.lastGuess ? 1 : 0))
            ).map(id => {
              const poi = pois.find(p => p.id === id)
              if (!poi) return null
              const found = hunt.foundIds.includes(id)
              return (
                <Marker key={id} position={[poi.lat, poi.lon]} icon={poiIcon(found ? 'found' : 'missed', poi.emoji)}>
                  <Popup>
                    <strong>{poi.emoji} {poi.name}</strong>
                    <br />{poi.label}
                  </Popup>
                </Marker>
              )
            })}
            {hunt.lastGuess && (() => {
              const poi = pois?.find(p => p.id === hunt.lastGuess.poiId)
              if (!poi) return null
              return (
                <>
                  <Marker position={[hunt.lastGuess.lat, hunt.lastGuess.lon]} icon={guessDotIcon} />
                  <Polyline
                    positions={[[hunt.lastGuess.lat, hunt.lastGuess.lon], [poi.lat, poi.lon]]}
                    pathOptions={{ color: '#7c3aed', dashArray: '6 6', weight: 2 }}
                  />
                </>
              )
            })()}
            {markerPos && (
              <Marker position={markerPos}>
                <Popup>
                  {result?.address && <strong>{result.address}</strong>}
                  <br />
                  {result?.lat?.toFixed(6)}°, {result?.lon?.toFixed(6)}°
                  {result?.elevation != null && (
                    <><br />Elevation: {result.elevation.toFixed(1)} m</>
                  )}
                </Popup>
              </Marker>
            )}
          </MapContainer>

          {/* Locate Me button */}
          <button
            className={`locate-btn ${locating ? 'locating' : ''}`}
            onClick={handleLocateMe}
            disabled={locating || loading}
            title="Use my location"
          >
            <LocateIcon />
          </button>

          {/* Map expand/collapse — mobile only */}
          <button
            className="map-expand-btn"
            onClick={() => setMapExpanded(x => !x)}
            title={mapExpanded ? 'Collapse map' : 'Expand map'}
          >
            {mapExpanded
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            }
          </button>

          <div className="map-style-picker">
            {MAP_STYLES.map(s => (
              <button
                key={s.id}
                className={`map-style-btn ${mapStyleId === s.id ? 'active' : ''}`}
                onClick={() => setMapStyleId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </main>

      {hunt.quiz && (hunt.status === 'active' || hunt.status === 'paused') && (
        <div className="journal-overlay quiz-overlay">
          <div className="journal-modal quiz-modal">
            {!hunt.quiz.answered ? (
              <>
                <div className="clue-kicker">🥚 You found something!</div>
                <h2 className="quiz-question">What is this place?</h2>
                <div className="quiz-options">
                  {hunt.quiz.options.map(o => (
                    <button key={o} className="quiz-option" onClick={() => answerQuiz(o)}>{o}</button>
                  ))}
                </div>
                <div className="quiz-meta">
                  🔥 Streak ×{Math.min(hunt.streak + 1, 5)} · ⏱ {Math.floor(hunt.remaining / 60)}:{String(hunt.remaining % 60).padStart(2, '0')}
                </div>
              </>
            ) : (
              <>
                <div className={`quiz-verdict quiz-verdict--${hunt.quiz.answered}`}>
                  {hunt.quiz.answered === 'correct'
                    ? <>✓ Correct! +{hunt.quiz.pts} pts{hunt.streak > 1 && <> (🔥×{Math.min(hunt.streak, 5)} streak)</>}</>
                    : <>✗ Not quite — streak reset</>}
                </div>
                <div className="fact-card">
                  <div className="fact-title">{hunt.quiz.poi.emoji} {hunt.quiz.poi.name}</div>
                  <div className="fact-type">{hunt.quiz.poi.label}</div>
                  {hunt.quiz.fact === undefined ? (
                    <div className="fact-loading"><span className="spinner spinner-sm" /> Fetching the story…</div>
                  ) : hunt.quiz.fact ? (
                    <>
                      {hunt.quiz.fact.thumb && <img className="fact-thumb" src={hunt.quiz.fact.thumb} alt={hunt.quiz.poi.name} />}
                      <p className="fact-extract">{hunt.quiz.fact.extract}</p>
                    </>
                  ) : (
                    <p className="fact-extract fact-none">A rare find — no Wikipedia article yet. You discovered a hidden gem.</p>
                  )}
                </div>
                <button className="btn hunt-start-btn" onClick={closeQuiz}>Continue</button>
              </>
            )}
          </div>
        </div>
      )}

      {passportOpen && (
        <div className="journal-overlay" onClick={() => setPassportOpen(false)}>
          <div className="journal-modal" onClick={e => e.stopPropagation()}>
            <div className="journal-header">
              <h2>🛂 Travel Passport</h2>
              <button className="journal-close" onClick={() => setPassportOpen(false)} aria-label="Close passport">✕</button>
            </div>
            {(() => {
              const lvl = levelForXp(passport.xp)
              const stamps = Object.values(passport.stamps).sort((a, b) => b.lastPlayed - a.lastPlayed)
              return (
                <>
                  <div className="passport-level">
                    <div className="passport-level-row">
                      <span className="passport-level-name">{lvl.name}</span>
                      <span className="passport-xp">{passport.xp} XP</span>
                    </div>
                    <div className="xp-bar">
                      <div className="xp-bar-fill" style={{ width: `${Math.round(lvl.progress * 100)}%` }} />
                    </div>
                    {lvl.next
                      ? <div className="passport-next">{lvl.toNext} XP to {lvl.next}</div>
                      : <div className="passport-next">Maximum level reached — the world is yours 🌍</div>}
                  </div>
                  {stamps.length === 0 ? (
                    <p className="journal-empty">
                      No stamps yet. Search a place and finish a round of Quiz Hunt or
                      Guess the Spot to earn your first stamp.
                    </p>
                  ) : (
                    <ul className="journal-list stamp-grid">
                      {stamps.map(s => (
                        <li key={s.name} className="stamp-card">
                          <div className="stamp-city">📍 {s.name}</div>
                          <div className="stamp-meta">
                            {s.foundIds.length}/{s.total} spots · {Math.round(100 * s.foundIds.length / Math.max(s.total, 1))}%
                          </div>
                          <div className="stamp-meta">
                            Best {s.bestScore} pts · {new Date(s.lastPlayed).toLocaleDateString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {journalOpen && (
        <div className="journal-overlay" onClick={() => setJournalOpen(false)}>
          <div className="journal-modal" onClick={e => e.stopPropagation()}>
            <div className="journal-header">
              <h2>📖 Travel Journal</h2>
              <button className="journal-close" onClick={() => setJournalOpen(false)} aria-label="Close journal">✕</button>
            </div>

            <section className="collage-section">
              <h3 className="collage-title">🖼️ Photo Collage</h3>
              <p className="collage-hint">
                Drop {COLLAGE_MIN}–{COLLAGE_MAX} photos from your trip — Questr reads their
                theme and lays out a shareable travel-journal page.
              </p>

              <div
                className={`collage-drop ${uploading ? 'is-busy' : ''}`}
                onClick={() => !uploading && photoInputRef.current?.click()}
                onDragOver={e => { e.preventDefault() }}
                onDrop={e => { e.preventDefault(); pickPhotos(e.dataTransfer.files) }}
              >
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={e => { pickPhotos(e.target.files); e.target.value = '' }}
                />
                {photoFiles.length === 0
                  ? <span>Tap or drop photos here</span>
                  : <span>{photoFiles.length} photo{photoFiles.length > 1 ? 's' : ''} selected — tap to add more</span>}
              </div>

              {photoFiles.length > 0 && (
                <div className="collage-thumbs">
                  {photoFiles.map((f, i) => (
                    <div key={i} className="collage-thumb">
                      <img src={URL.createObjectURL(f)} alt={`photo ${i + 1}`} />
                      <button
                        className="collage-thumb-x"
                        onClick={() => setPhotoFiles(p => p.filter((_, j) => j !== i))}
                        aria-label="Remove photo"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}

              <button
                className="collage-build-btn"
                disabled={uploading || photoFiles.length < COLLAGE_MIN}
                onClick={uploadAndBuild}
              >
                {uploading ? 'Working…' : 'Create collage now'}
              </button>

              {collageStatus && <p className="collage-status">{collageStatus}</p>}

              {collageReady && collageUrl && (
                <a href={collageUrl} target="_blank" rel="noreferrer" className="collage-result">
                  <img src={collageUrl} alt="Your travel collage" />
                </a>
              )}
            </section>

            {journal.length === 0 ? (
              <p className="journal-empty">
                No discoveries yet. Search a place, start an easter egg hunt, and every spot
                you find will be recorded here.
              </p>
            ) : (
              <>
                <ul className="journal-list">
                  {journal.map(e => (
                    <li key={e.poiId} className="journal-entry">
                      <button
                        className="journal-entry-main"
                        onClick={() => {
                          setJournalOpen(false)
                          setNavTarget({ center: [e.lat, e.lon], zoom: 16, id: Date.now() })
                        }}
                        title="Show on map"
                      >
                        <span className="journal-emoji">{e.emoji}</span>
                        <span className="journal-entry-text">
                          <span className="journal-name">{e.name}</span>
                          <span className="journal-meta">
                            {e.typeLabel}
                            {e.area && <> · {e.area.split(',').slice(-3).join(',').trim()}</>}
                            {' · '}{new Date(e.ts).toLocaleDateString()}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="journal-clear"
                  onClick={() => { if (window.confirm('Clear your entire travel journal?')) setJournal([]) }}
                >
                  Clear journal
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="footer">
        Geocoding by <a href="https://nominatim.openstreetmap.org" target="_blank" rel="noreferrer">Nominatim / OpenStreetMap</a>
        &nbsp;·&nbsp;
        Elevation by <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>
        &nbsp;·&nbsp;
        POIs by <a href="https://overpass-api.de" target="_blank" rel="noreferrer">Overpass API</a>
        &nbsp;·&nbsp;
        Made with <svg width="12" height="12" viewBox="0 0 24 24" fill="#C1513A" style={{display:'inline',verticalAlign:'middle',marginBottom:'1px'}}><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> by <span style={{ color: '#E2704A' }}>Lawrence</span>
      </footer>
    </div>
  )
}
