import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js";
import * as satellite from "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm";
import { satelliteData as STATIC_SATS } from "./satellites.js";
import { ConjunctionEngine, classifyRisk } from "./ConjunctionEngine.js";

/* ============================================================
   FAIL-SAFE
   ============================================================ */
const errorBanner = document.getElementById("errorBanner");
function showError(msg) {
  console.error(msg);
  if (errorBanner) { errorBanner.textContent = "⚠ " + msg; errorBanner.classList.add("visible"); }
}
window.addEventListener("error", e => showError(e.message || "Unknown error"));
window.addEventListener("unhandledrejection", e => showError("Unhandled rejection: " + (e.reason?.message || e.reason)));

/* ============================================================
   RENDERER / SCENE / CAMERA
   ============================================================ */
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 3000);
camera.position.set(0, 6, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputEncoding     = THREE.sRGBEncoding;
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping   = true;
controls.dampingFactor   = 0.055;
controls.minDistance     = 7.5;
controls.maxDistance     = 150;
controls.target.set(0, 0, 0);
controls.autoRotate      = true;
controls.autoRotateSpeed = 0.25;

/* ============================================================
   REAL-TIME SUN POSITION
   Computes the unit vector pointing FROM Earth TOWARD the Sun
   in our scene's ECEF-mapped coordinate space.

   Coordinate mapping (matches satellite propagation below):
     lon=0°, lat=0°  →  scene +X
     lon=90°E, lat=0° → scene -Z
     North Pole       →  scene +Y

   Pipeline: Julian Date → ecliptic longitude → ECI vector
             → ECEF (rotate by GMST around north-pole axis)
             → scene coords
   ============================================================ */
function computeSunDirectionScene(date) {
  // Julian Date
  const JD = date.getTime() / 86400000.0 + 2440587.5;
  // Julian centuries since J2000.0
  const T  = (JD - 2451545.0) / 36525.0;

  // Sun mean longitude (deg)
  const L0 = ((280.46646 + 36000.76983 * T) % 360 + 360) % 360;
  // Sun mean anomaly (deg → rad)
  const M  = ((357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360 + 360) % 360;
  const Mr = M * (Math.PI / 180);

  // Equation of centre
  const C =  (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mr)
           + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
           +  0.000289 * Math.sin(3 * Mr);

  // Sun true longitude → radians
  const sunLon = (L0 + C) * (Math.PI / 180);

  // Obliquity of ecliptic
  const eps = (23.439291111 - 0.013004167 * T) * (Math.PI / 180);

  // Unit vector to Sun in ECI (X = vernal equinox, Z = north pole)
  const eci_x =  Math.cos(sunLon);
  const eci_y =  Math.sin(sunLon) * Math.cos(eps);
  const eci_z =  Math.sin(sunLon) * Math.sin(eps);

  // ECI → ECEF:  rotate around north-pole (Z in ECI, Y in scene) by GMST
  //   ECEF_x =  cos(θ)·ECI_x + sin(θ)·ECI_y
  //   ECEF_y = −sin(θ)·ECI_x + cos(θ)·ECI_y
  //   ECEF_z =  ECI_z
  const θ  = satellite.gstime(date);
  const cθ = Math.cos(θ), sθ = Math.sin(θ);

  const ecef_x =  cθ * eci_x + sθ * eci_y;
  const ecef_y = -sθ * eci_x + cθ * eci_y;
  const ecef_z =  eci_z;

  // ECEF → scene:  scene_x = ecef_x,  scene_y = ecef_z,  scene_z = −ecef_y
  return new THREE.Vector3(ecef_x, ecef_z, -ecef_y).normalize();
}

/* ============================================================
   LIGHTING  (sun updated every frame in renderFrame)
   ============================================================ */
scene.add(new THREE.AmbientLight(0x223355, 0.14));

const sunLight = new THREE.DirectionalLight(0xfff8e7, 2.9);
scene.add(sunLight);

// Dim fill from the anti-sun side (reflected earthshine / nav needs)
const fillLight = new THREE.DirectionalLight(0x1a3560, 0.16);
scene.add(fillLight);

scene.add(new THREE.HemisphereLight(0x3a5a8a, 0x05080f, 0.20));

/* ============================================================
   TEXTURES
   ============================================================ */
const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = "anonymous";

const earthDayTex = texLoader.load("https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg");
earthDayTex.encoding = THREE.sRGBEncoding;

const earthNightTex = texLoader.load("https://threejs.org/examples/textures/planets/earth_lights_2048.png");
earthNightTex.encoding = THREE.sRGBEncoding;

const cloudsTex = texLoader.load("https://threejs.org/examples/textures/planets/earth_clouds_1024.png");

/* ============================================================
   EARTH
   ============================================================ */
const EARTH_R = 5;

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R, 72, 72),
  new THREE.MeshPhongMaterial({ map: earthDayTex, shininess: 8 })
);
scene.add(earth);

// Night-side city lights (additive blend)
const nightOverlay = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R + 0.008, 72, 72),
  new THREE.MeshBasicMaterial({
    map: earthNightTex,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  })
);
scene.add(nightOverlay);

// Clouds layer
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R + 0.055, 64, 64),
  new THREE.MeshLambertMaterial({ map: cloudsTex, transparent: true, opacity: 0.42, depthWrite: false })
);
scene.add(clouds);

// Atmosphere — thin limb glow only
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_R * 1.082, 64, 64),
  new THREE.MeshPhongMaterial({
    color: 0x55aaff,
    transparent: true,
    opacity: 0.048,          // significantly thinner
    side: THREE.BackSide,
  })
);
scene.add(atmosphere);

/* ============================================================
   DECORATIVE ORBIT RINGS (HUD aesthetic)
   ============================================================ */
const addRing = (inner, outer, color, opacity, tiltX = Math.PI / 2) => {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 160),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide })
  );
  m.rotation.x = tiltX;
  scene.add(m);
  return m;
};

const equatorRing  = addRing(7.30, 7.44, 0x00eaff, 0.14, Math.PI / 2);
const polarRing    = addRing(8.60, 8.70, 0x0055aa, 0.09, Math.PI / 8);
const inclinedRing = addRing(6.80, 6.88, 0x003355, 0.07, Math.PI / 2.8);

/* ============================================================
   STARFIELD
   ============================================================ */
function buildStarSprite() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0,   "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.75)");
  g.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
const starSprite = buildStarSprite();

const addStars = (n, spread, size, opacity) => {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    map: starSprite, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true,
  })));
};
addStars(5500, 2800, 2.6, 0.88);
addStars(3000, 1800, 1.3, 0.52);

/* ============================================================
   UI ELEMENT REFS
   ============================================================ */
const label        = document.getElementById("satelliteLabel");
const alertPanel   = document.getElementById("alertPanel");
const alertContent = document.getElementById("alertContent");
const satCount     = document.getElementById("satCount");
const debrisCount  = document.getElementById("debrisCount");
const dangerCount  = document.getElementById("dangerCount");
const trackingName = document.getElementById("trackingName");
const utcTime      = document.getElementById("utcTime");
const satelliteInfo = document.getElementById("satelliteInfo");
const dataSourceNote = document.getElementById("dataSourceNote");
const searchInput   = document.getElementById("searchInput");
const searchBtn     = document.getElementById("searchBtn");
const filterChips    = document.querySelectorAll(".filter-chip");
const timeSpeedBtns  = document.querySelectorAll(".time-btn[data-speed]");
const pauseBtn       = document.getElementById("pauseBtn");
const priorityList   = document.getElementById("priorityList");

/* ============================================================
   OBJECT CLASSIFICATION & IDENTIFICATION
   Real satellite catalogs (CelesTrak/NORAD) encode object type
   directly in the object name by convention: "… DEB" = debris
   fragment, "… R/B" = rocket body, else it's a payload/satellite.
   We also tag debris explicitly by which CelesTrak debris group
   it was fetched from, which is more reliable than name-sniffing
   alone (see loadRealDebris below).
   ============================================================ */
function classifyType(name, isDebrisSource) {
  const n = (name || "").toUpperCase();
  if (isDebrisSource) return "debris";
  if (/\bDEB\b/.test(n) || n.endsWith(" DEB")) return "debris";
  if (/\bR\/B\b/.test(n)) return "rocket-body";
  if (n.startsWith("STARLINK")) return "starlink";
  return "satellite";
}

// NORAD catalog number lives in columns 3–7 of TLE line 1.
function getNoradId(tle1) {
  if (!tle1) return null;
  const id = parseInt(tle1.substring(2, 7).trim(), 10);
  return Number.isFinite(id) ? id : null;
}

/* ============================================================
   LOCAL TLE CACHE (requirement: app still works if the live
   CelesTrak API is unavailable). Every successful live fetch is
   cached to localStorage with a timestamp; if the live fetch
   fails, we fall back to whatever was last cached, so the app
   keeps working (with slightly stale but still real data) across
   sessions/offline use. If there is truly no cache and no network
   (first-ever offline run), satellites fall back to the built-in
   real TLE set in satellites.js — we do NOT fabricate debris data
   in that case; the debris count is honestly reported as 0.
   ============================================================ */
const CACHE_KEY_SATS    = "orbistrack_cache_satellites_v1";
const CACHE_KEY_DEBRIS  = "orbistrack_cache_debris_v1";
const CACHE_KEY_ROCKETS = "orbistrack_cache_rockets_v1";
const CACHE_KEY_STATUS  = "orbistrack_cache_status_v1";

function saveCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); }
  catch (e) { console.warn("Cache write failed:", e); }
}
function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function cacheAgeLabel(savedAt) {
  const min = Math.round((Date.now() - savedAt) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

// CelesTrak's own documentation states GP data is updated once every
// 2 hours, and explicitly asks clients not to re-request data more
// often than that (repeated requests within the update window can get
// an IP firewalled — this is a real, current policy, not a guess).
// Before attempting any live fetch, we check whether our cache is
// already fresher than that cadence; if so we skip the network
// entirely for this load. This also happens to be the main fix for
// unreliable debris/rocket-body loading — repeated page reloads during
// testing/use were re-requesting the same not-yet-updated data on every
// load, which is exactly the pattern CelesTrak now rate-limits.
const CELESTRAK_MIN_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

function isCacheFresh(key) {
  const cached = loadCache(key);
  return !!(cached && cached.savedAt && (Date.now() - cached.savedAt) < CELESTRAK_MIN_REFRESH_MS);
}

let dataSourceState = { sats: "—", debris: "—", status: "—" };
function updateDataSourceNote() {
  if (!dataSourceNote) return;
  const satValid = satObjects.filter(s => s.valid).length;
  const debValid = debrisObjs.filter(d => d.valid).length;
  dataSourceNote.innerText =
    `Sat:${dataSourceState.sats} Deb:${dataSourceState.debris} Stat:${dataSourceState.status} | ` +
    `SatValid:${satValid}/${satObjects.length} DebValid:${debValid}/${debrisObjs.length}`;
}

// Declared here (not lower down near the other filter-UI wiring) because
// buildAllObjects calls applyFilter() immediately at module load time,
// before that later code runs.
let activeFilter = "all";
function applyFilter() {
  const all = [...satObjects, ...debrisObjs];
  all.forEach(o => {
    if (activeFilter === "all") { o.filterVisible = true; }
    else if (activeFilter === "satellite") { o.filterVisible = (o.type === "satellite" || o.type === "starlink"); }
    else if (activeFilter === "defunct") { o.filterVisible = (o.type === "satellite" || o.type === "starlink") && o.isActive === false; }
    else { o.filterVisible = (o.type === activeFilter); }
    o.mesh.visible = o.filterVisible && o.valid; // validity (is it currently propagating?) always wins
  });
}


const mouse = new THREE.Vector2();
let mouseX = 0, mouseY = 0;
window.addEventListener("mousemove", e => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  mouseX = e.clientX; mouseY = e.clientY;
});

const raycaster   = new THREE.Raycaster();
const orbitTrails = new THREE.Group();
scene.add(orbitTrails);

/* ============================================================
   INDUSTRY-GRADE SATELLITE BUILDER
   Each satellite has:
     - Aluminium/Kapton main bus
     - Multi-cell solar arrays with boom struts
     - High-gain parabolic antenna dish
     - Omni antenna spike
     - Navigation LED
   ============================================================ */
function buildSatMesh(name) {
  const isISS = name.includes("ISS");
  const g     = new THREE.Group();

  /* --- Materials --- */
  const aluminiumMat = new THREE.MeshStandardMaterial({
    color: isISS ? 0xe8ecf0 : 0xc8d2de,
    metalness: 0.92, roughness: 0.14,
  });
  const kaptonMat = new THREE.MeshStandardMaterial({   // gold thermal wrap
    color: 0xc88818, metalness: 0.35, roughness: 0.58,
  });
  const solarMat = new THREE.MeshStandardMaterial({
    color: 0x0c1e5a, metalness: 0.06, roughness: 0.30,
    emissive: 0x040d28, emissiveIntensity: 0.45,
  });
  const structMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0ac, metalness: 0.84, roughness: 0.25,
  });
  const dishMat = new THREE.MeshStandardMaterial({
    color: 0xe0e4ea, metalness: 0.90, roughness: 0.12, side: THREE.DoubleSide,
  });

  /* --- Main bus --- */
  const busW = isISS ? 0.26 : 0.20, busH = 0.14, busD = 0.28;
  const bus = new THREE.Mesh(new THREE.BoxGeometry(busW, busH, busD), kaptonMat);
  g.add(bus);

  // Top aluminium face plate
  const topFace = new THREE.Mesh(new THREE.BoxGeometry(busW - 0.01, 0.005, busD - 0.01), aluminiumMat);
  topFace.position.y = busH / 2 + 0.001;
  g.add(topFace);

  // Front / back end panels (electronics access panel look)
  const endFace = new THREE.Mesh(new THREE.BoxGeometry(busW, busH, 0.004), aluminiumMat);
  endFace.position.z = busD / 2 + 0.002;
  g.add(endFace);
  const endFace2 = endFace.clone(); endFace2.position.z = -(busD / 2 + 0.002); g.add(endFace2);

  /* --- Boom struts --- */
  const boomLen = isISS ? 0.90 : 0.68;
  const boomGeo = new THREE.CylinderGeometry(0.006, 0.006, boomLen, 8);
  const lBoom = new THREE.Mesh(boomGeo, structMat);
  lBoom.rotation.z = Math.PI / 2;
  lBoom.position.x = -(busW / 2 + boomLen / 2);
  g.add(lBoom);
  const rBoom = lBoom.clone(); rBoom.position.x = busW / 2 + boomLen / 2; g.add(rBoom);

  /* --- Solar panels --- */
  const pW = isISS ? 0.55 : 0.44, pH = isISS ? 0.26 : 0.20, pD = 0.004;
  const pOff = isISS ? 0.73 : 0.56;
  const panelGeo = new THREE.BoxGeometry(pW, pD, pH);

  const addPanel = (x, z = 0) => {
    const p = new THREE.Mesh(panelGeo, solarMat);
    p.position.set(x, 0, z);
    g.add(p);
    // Cell division lines
    const cellCount = 5;
    for (let ci = 0; ci < cellCount; ci++) {
      const div = new THREE.Mesh(new THREE.BoxGeometry(pW, pD * 1.5, 0.003), structMat);
      div.position.set(x, 0.002, -pH / 2 + (ci + 1) * pH / cellCount);
      g.add(div);
    }
  };

  addPanel(-pOff);
  addPanel( pOff);
  if (isISS) {
    addPanel(-(pOff + pW + 0.05));
    addPanel(  pOff + pW + 0.05);
  }

  /* --- High-gain antenna --- */
  const dishRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.005, 12, 36),
    new THREE.MeshStandardMaterial({ color: 0xdde0e8, metalness: 0.93, roughness: 0.10 })
  );
  dishRim.rotation.x = Math.PI / 2 - 0.28;
  dishRim.position.set(0.04, busH / 2 + 0.06, -0.10);
  g.add(dishRim);

  const dishSurface = new THREE.Mesh(new THREE.CircleGeometry(0.064, 28), dishMat);
  dishSurface.rotation.x = Math.PI / 2 - 0.28;
  dishSurface.position.set(0.04, busH / 2 + 0.06, -0.10);
  g.add(dishSurface);

  const mastGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6);
  const mast = new THREE.Mesh(mastGeo, structMat);
  mast.rotation.z = 0.28;
  mast.position.set(0.025, busH / 2 + 0.02, -0.065);
  g.add(mast);

  /* --- Omni antenna spike --- */
  const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.001, 0.14, 6), structMat);
  spike.position.set(0, busH / 2 + 0.07, busD / 2 - 0.02);
  g.add(spike);

  /* --- Navigation LED --- */
  const ledColor = isISS ? 0x00ffaa : 0xff3322;
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.013, 7, 7),
    new THREE.MeshBasicMaterial({ color: ledColor })
  );
  led.position.set(-busW / 2 + 0.02, busH / 2 + 0.012, busD / 2 - 0.02);
  g.add(led);

  g.scale.setScalar(1.85);
  return { group: g, led, ledColor };
}

/* ============================================================
   UNIFIED OBJECT INSTANTIATION

   IMPORTANT: CelesTrak's "visual" satellite group (the ~60
   brightest/most-tracked objects) is NOT only payloads — it also
   includes bright rocket bodies and debris (tumbling spent rocket
   stages are often the most visually observed objects in orbit,
   e.g. "FREGAT DEB", "SL-12 R/B"). Earlier this file built the
   detailed 3D satellite model for anything that came through the
   satellite-fetch pipeline, regardless of what it actually was —
   so a rocket body could get the satellite model and even show up
   as "the satellite" in a conjunction alert. That was a real bug.

   Fixed here: EVERY object (from either the satellite groups or
   the debris groups) is classified first, and the *classification*
   — not the source fetch — decides how it's rendered:
     - satellite / starlink → detailed 3D model, full trail (satObjects)
     - debris / rocket-body → simple color-coded marker (debrisObjs)
   This keeps the visual, the filter category, and the conjunction
   role always consistent with each other.
   ============================================================ */
let satObjects   = [];
let debrisObjs   = [];
const SAT_CAP    = 120; // render-performance safety cap
const DEBRIS_CAP = 900; // render-performance safety cap

// Debris: small irregular "fragment" shard shape (not a smooth sphere —
// reads as a piece of wreckage rather than a star point).
const debrisGeo = new THREE.IcosahedronGeometry(0.075, 0);
const debrisMat = new THREE.MeshStandardMaterial({
  color: 0xff8800, emissive: 0x552200, emissiveIntensity: 0.6,
  metalness: 0.3, roughness: 0.7,
}); // real tracked debris fragments

// Rocket body: elongated cylinder — an unmistakably different silhouette
// from a debris shard, representing a spent booster/upper stage.
const rocketBodyGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8);
const rocketBodyMat = new THREE.MeshStandardMaterial({
  color: 0x9d9dc9, emissive: 0x3a3a55, emissiveIntensity: 0.5,
  metalness: 0.6, roughness: 0.4,
}); // derelict rocket bodies (distinct shape + color)

function buildAllObjects(satRaw, debrisCloudRaw, rocketRaw = []) {
  satObjects.forEach(s => scene.remove(s.mesh));
  debrisObjs.forEach(d => scene.remove(d.mesh));
  satObjects = [];
  debrisObjs = [];
  orbitTrails.clear();

  const seen = new Set(); // keyed by NORAD ID (falls back to name if ID is unavailable)

  function addOne(d, isDebrisSource) {
    const l1 = d.tle1 || d.line1;
    const l2 = d.tle2 || d.line2;
    if (!l1 || !l2) return;

    const noradId = getNoradId(l1);
    const key = noradId ?? d.name.trim();
    if (seen.has(key)) return;

    let satrec;
    try { satrec = satellite.twoline2satrec(l1, l2); } catch { return; }

    seen.add(key);
    const type = classifyType(d.name, isDebrisSource);
    const base = {
      satrec, name: d.name,
      noradId,
      type,
      opsStatus: null,   // resolved after load via SATCAT cross-reference (satellites only)
      isActive: (type === "satellite" || type === "starlink") ? null : false, // debris/rocket bodies are inherently non-functional
      valid: true,          // whether SGP4 propagation is currently succeeding for this object
      filterVisible: true,  // whether the current search/filter selection wants this object shown
      altitude: 0, latitude: 0, longitude: 0, speed: 0,
      conjunction: { distanceKm: Infinity, tca: null, relativeVelocityKmS: null, riskLevel: "SAFE", withName: null },
    };

    if (type === "satellite" || type === "starlink") {
      if (satObjects.length >= SAT_CAP) return;
      const { group, led, ledColor } = buildSatMesh(d.name);
      scene.add(group);
      satObjects.push({ ...base, mesh: group, led, ledColor, trail: [] });
    } else {
      if (debrisObjs.length >= DEBRIS_CAP) return;
      const geo = type === "rocket-body" ? rocketBodyGeo : debrisGeo;
      const mat = type === "rocket-body" ? rocketBodyMat : debrisMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scene.add(mesh);
      debrisObjs.push({ ...base, mesh });
    }
  }

  satRaw.forEach(d => addOne(d, false));
  // debrisCloudRaw comes from CelesTrak's confirmed fragmentation-event
  // groups — always real debris regardless of exact name, so it's forced.
  debrisCloudRaw.forEach(d => addOne(d, true));
  // rocketRaw comes from a catalog-wide NAME="R/B" search — NOT forced,
  // classified normally by name so it correctly resolves to 'rocket-body'.
  rocketRaw.forEach(d => addOne(d, false));

  applyFilter();
}

// Boot with the built-in real TLE set immediately (guaranteed
// something is visible right away), then replace with live data.
buildAllObjects(STATIC_SATS, []);

/* ------------------------------------------------------------
   CURATED "IMPORTANT SATELLITES" LIVE FEED

   CelesTrak's single "active" group contains 10,000+ objects
   (mostly Starlink), and slicing the first N of it is arbitrary —
   it does NOT surface the satellites people actually care about.
   Instead we pull several curated CelesTrak groups in parallel and
   merge them, so the result is genuinely "the important satellites
   currently in orbit": the ISS/space stations, the ~100 brightest/
   most-tracked objects (CelesTrak's own "visual" group), the GPS,
   GLONASS, Galileo & BeiDou navigation constellations, geostationary
   comms satellites, weather satellites, key science satellites
   (e.g. Hubble), and a small Starlink sample to represent the
   mega-constellations without drowning out everything else.
   ------------------------------------------------------------ */
const SAT_GROUPS = [
  { group: "stations", limit: 15 },   // ISS, Tiangong, etc.
  { group: "visual",   limit: 60 },   // CelesTrak's curated brightest/most notable objects
  { group: "gps-ops",  limit: 8 },    // GPS constellation
  { group: "glo-ops",  limit: 6 },    // GLONASS constellation
  { group: "galileo",  limit: 6 },    // Galileo constellation
  { group: "beidou",   limit: 6 },    // BeiDou constellation
  { group: "geo",      limit: 12 },   // Geostationary comsats
  { group: "weather",  limit: 8 },    // Weather satellites
  { group: "science",  limit: 10 },   // Hubble and other science satellites
  { group: "starlink", limit: 10 },   // Sample of the Starlink mega-constellation
];

/* ------------------------------------------------------------
   REAL DEBRIS FEED

   Sourced from CelesTrak's own curated debris-cloud groups —
   the actual tracked fragments from the four major real-world
   fragmentation events: the 2007 Fengyun-1C ASAT test, the 2009
   Cosmos 2251 / Iridium 33 collision, and the 2021 Cosmos 1408
   ASAT test. These are real, individually cataloged NORAD objects
   with real TLEs — not procedurally generated positions.
   ------------------------------------------------------------ */
const DEBRIS_GROUPS = [
  { group: "cosmos-2251-debris", limit: 225 },
  { group: "iridium-33-debris",  limit: 225 },
  { group: "cosmos-1408-debris", limit: 225 },
  { group: "fengyun-1c-debris",  limit: 225 },
];

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

// NOTE on `limit`: CelesTrak's gp.php has no server-side result-count
// parameter — a GROUP or NAME query always returns the *entire* matching
// set, and `limit` below only truncates it client-side after download.
// That's unavoidable given the API's actual capabilities; it's mentioned
// here because it's part of why these requests aren't as cheap as the
// `limit` numbers might suggest.
async function fetchGroup(group, limit, retries = 1) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${group}: HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split("\n");
      const data = [];
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i]?.trim();
        const tle1 = lines[i + 1]?.trim();
        const tle2 = lines[i + 2]?.trim();
        if (name && tle1 && tle2) data.push({ name, tle1, tle2 });
      }
      console.info(`  · ${group}: ${data.length} objects`);
      return data.slice(0, limit);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await delay(400); // brief pause before retry
    }
  }
  throw lastErr;
}

// CelesTrak's gp.php also supports a catalog-wide NAME substring search
// (independent of GROUP), documented at
// celestrak.org/NORAD/documentation/gp-data-formats.php. There is no
// dedicated "rocket bodies" GROUP the way there is for debris clouds or
// GPS satellites — spent upper stages are scattered across the whole
// catalog — so this is the real, non-fabricated way to gather them: a
// direct search for the "R/B" designation NORAD/CelesTrak themselves
// use in the object name, e.g. "DELTA 2 R/B", "SL-4 R/B".
async function fetchByName(namePattern, limit, retries = 1) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(namePattern)}&FORMAT=tle`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`NAME=${namePattern}: HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split("\n");
      const data = [];
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i]?.trim();
        const tle1 = lines[i + 1]?.trim();
        const tle2 = lines[i + 2]?.trim();
        if (name && tle1 && tle2) data.push({ name, tle1, tle2 });
      }
      console.info(`  · NAME="${namePattern}": ${data.length} objects`);
      return data.slice(0, limit);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await delay(400);
    }
  }
  throw lastErr;
}

// CelesTrak is a small, donation-run public service that rate-limits /
// rejects bursts of concurrent requests. Firing all groups in parallel
// (as this used to do) meant most of them could silently fail under
// load. Fetching one group at a time, with a short pause between each,
// is far more reliable — this is the fix for "I only see a handful of
// objects" when the console showed most groups as unavailable.
async function fetchGroupsSequentially(groups) {
  const results = [];
  for (const { group, limit } of groups) {
    try {
      const data = await fetchGroup(group, limit);
      results.push({ status: "fulfilled", value: data, group });
    } catch (e) {
      results.push({ status: "rejected", reason: e, group });
    }
    await delay(180); // brief, polite gap between requests
  }
  return results;
}

async function loadImportantSatellites() {
  console.info(`Fetching ${SAT_GROUPS.length} satellite groups…`);
  const results = await fetchGroupsSequentially(SAT_GROUPS);

  const merged = [];
  const seen = new Set(); // keyed by NORAD ID (falls back to name if unavailable)
  let succeeded = 0;

  // Always keep the built-in satellites as a guaranteed baseline
  STATIC_SATS.forEach(d => {
    const key = getNoradId(d.tle1) ?? d.name.trim();
    if (!seen.has(key)) { seen.add(key); merged.push(d); }
  });

  results.forEach(r => {
    if (r.status !== "fulfilled") {
      console.warn(`Satellite group "${r.group}" unavailable:`, r.reason?.message || r.reason);
      return;
    }
    succeeded++;
    r.value.forEach(d => {
      const key = getNoradId(d.tle1) ?? d.name.trim();
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    });
  });

  return { data: merged.slice(0, SAT_CAP), succeeded, total: SAT_GROUPS.length };
}

async function loadRealDebris() {
  console.info(`Fetching ${DEBRIS_GROUPS.length} debris groups…`);
  const results = await fetchGroupsSequentially(DEBRIS_GROUPS);

  const merged = [];
  const seen = new Set(); // keyed by NORAD ID (falls back to name if unavailable)
  let succeeded = 0;

  results.forEach(r => {
    if (r.status !== "fulfilled") {
      console.warn(`Debris group "${r.group}" unavailable:`, r.reason?.message || r.reason);
      return;
    }
    succeeded++;
    r.value.forEach(d => {
      const key = getNoradId(d.tle1) ?? d.name.trim();
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    });
  });

  // Supplementary catalog-wide search — broadens debris coverage beyond
  // the four named fragmentation-event clouds, and adds resilience if
  // one of those four groups happens to be unavailable this cycle.
  try {
    const extra = await fetchByName("DEB", 300);
    await delay(180);
    if (extra.length) succeeded++;
    extra.forEach(d => {
      const key = getNoradId(d.tle1) ?? d.name.trim();
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    });
  } catch (e) {
    console.warn("Supplementary debris NAME search unavailable:", e.message || e);
  }

  return { data: merged.slice(0, DEBRIS_CAP), succeeded, total: DEBRIS_GROUPS.length + 1 };
}

const ROCKET_CAP = 90; // within the 50-100 target range

async function loadRealRocketBodies() {
  console.info(`Fetching rocket bodies (catalog-wide NAME search)…`);
  const seen = new Set();
  const merged = [];
  try {
    const data = await fetchByName("R/B", ROCKET_CAP * 2); // over-fetch slightly before dedup
    await delay(180);
    data.forEach(d => {
      const key = getNoradId(d.tle1) ?? d.name.trim();
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    });
    return { data: merged.slice(0, ROCKET_CAP), succeeded: merged.length > 0 ? 1 : 0, total: 1 };
  } catch (e) {
    console.warn("Rocket body NAME search unavailable:", e.message || e);
    return { data: [], succeeded: 0, total: 1 };
  }
}


/* ------------------------------------------------------------
   OPERATIONAL STATUS (active vs. defunct) — REAL DATA

   CelesTrak's TLE feed alone doesn't say whether a payload is
   still functioning. Their separate SATCAT catalog does, via
   OPS_STATUS_CODE, documented at https://celestrak.org/satcat/status.php:
     +  Operational          P  Partially Operational
     B  Backup/Standby       S  Spare
     X  Extended Mission     -  Nonoperational
     D  Decayed              ?  Unknown
   CelesTrak's own definition of "active": status in {+, P, B, S, X}.
   We fetch SATCAT records for the same groups used for TLEs and
   cross-reference by NORAD catalog number — this is real published
   status data, not inferred or guessed.
   ------------------------------------------------------------ */
const ACTIVE_OPS_CODES = new Set(["+", "P", "B", "S", "X"]);

function parseSatcatCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  const idxId  = headers.indexOf("NORAD_CAT_ID");
  const idxOps = headers.indexOf("OPS_STATUS_CODE");
  if (idxId === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = lines[i].split(",");
    const noradId = parseInt(cols[idxId], 10);
    if (!Number.isFinite(noradId)) continue;
    rows.push({ noradId, ops: (cols[idxOps] || "").trim() });
  }
  return rows;
}

async function fetchSatcatGroup(group, retries = 1) {
  const url = `https://celestrak.org/satcat/records.php?GROUP=${group}&FORMAT=CSV`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`satcat ${group}: HTTP ${res.status}`);
      const rows = parseSatcatCSV(await res.text());
      console.info(`  · satcat ${group}: ${rows.length} status records`);
      return rows;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await delay(400);
    }
  }
  throw lastErr;
}

async function loadOperationalStatus() {
  console.info(`Fetching operational status for ${SAT_GROUPS.length} groups…`);
  const statusMap = new Map();
  let succeeded = 0;
  for (const { group } of SAT_GROUPS) {
    try {
      const rows = await fetchSatcatGroup(group);
      rows.forEach(r => statusMap.set(r.noradId, r.ops));
      succeeded++;
    } catch (e) {
      console.warn(`SATCAT group "${group}" unavailable:`, e.message || e);
    }
    await delay(180);
  }
  return { statusMap, succeeded, total: SAT_GROUPS.length };
}

/* ------------------------------------------------------------
   REFRESH PIPELINE — cache-fresh check → live fetch → cache on
   success → cache fallback on failure → built-in/empty as last
   resort. Called on load, then re-run periodically (real
   wall-clock time, independent of simulation speed).
   ------------------------------------------------------------ */
async function refreshAllData() {
  // If everything we need is already cached and still fresher than
  // CelesTrak's own ~2-hour update cadence, don't hit the network at
  // all — the data server-side hasn't changed yet, so refetching would
  // just be an unnecessary request against a service that now firewalls
  // exactly that pattern.
  if (isCacheFresh(CACHE_KEY_SATS) && isCacheFresh(CACHE_KEY_DEBRIS) &&
      isCacheFresh(CACHE_KEY_ROCKETS) && isCacheFresh(CACHE_KEY_STATUS)) {
    const satCache    = loadCache(CACHE_KEY_SATS);
    const debrisCache = loadCache(CACHE_KEY_DEBRIS);
    const rocketCache = loadCache(CACHE_KEY_ROCKETS);
    const statusCache = loadCache(CACHE_KEY_STATUS);

    console.info("Cache is fresher than CelesTrak's ~2h update cadence — skipping live fetch.");
    buildAllObjects(satCache.data, debrisCache.data, rocketCache.data);

    const statusMap = new Map(statusCache.data.map(r => [r.noradId, r.ops]));
    satObjects.forEach(sat => {
      const code = sat.noradId != null ? statusMap.get(sat.noradId) : undefined;
      sat.opsStatus = code ?? null;
      sat.isActive = code == null ? null : ACTIVE_OPS_CODES.has(code);
    });

    dataSourceState.sats   = `CACHE(${cacheAgeLabel(satCache.savedAt)})`;
    dataSourceState.debris = `CACHE(${cacheAgeLabel(debrisCache.savedAt)})`;
    dataSourceState.status = `CACHE(${cacheAgeLabel(statusCache.savedAt)})`;
    applyFilter();
    updateDataSourceNote();
    return;
  }

  // Satellites: resolve raw data via live → cache → built-in
  let satRaw = STATIC_SATS, satSource = "BUILT-IN";
  try {
    const { data, succeeded, total } = await loadImportantSatellites();
    if (succeeded > 0 && data.length) {
      satRaw = data;
      satSource = `LIVE(${succeeded}/${total})`;
      saveCache(CACHE_KEY_SATS, data);
      console.info(`✔ Loaded ${data.length} real satellites from ${succeeded}/${total} live CelesTrak groups`);
    } else {
      throw new Error("all satellite groups unavailable");
    }
  } catch (e) {
    console.warn("Live satellite fetch failed, trying cache:", e.message || e);
    const cached = loadCache(CACHE_KEY_SATS);
    if (cached && cached.data && cached.data.length) {
      satRaw = cached.data;
      satSource = `CACHE(${cacheAgeLabel(cached.savedAt)})`;
    } // else: keep STATIC_SATS / "BUILT-IN"
  }

  // Debris: resolve raw data via live → cache → honestly empty
  let debrisRaw = [], debrisSource = "UNAVAILABLE";
  try {
    const { data, succeeded, total } = await loadRealDebris();
    if (succeeded > 0 && data.length) {
      debrisRaw = data;
      debrisSource = `LIVE(${succeeded}/${total})`;
      saveCache(CACHE_KEY_DEBRIS, data);
      console.info(`✔ Loaded ${data.length} real debris fragments from ${succeeded}/${total} live CelesTrak debris sources`);
    } else {
      throw new Error("all debris sources unavailable");
    }
  } catch (e) {
    console.warn("Live debris fetch failed, trying cache:", e.message || e);
    const cached = loadCache(CACHE_KEY_DEBRIS);
    if (cached && cached.data && cached.data.length) {
      debrisRaw = cached.data;
      debrisSource = `CACHE(${cacheAgeLabel(cached.savedAt)})`;
    } // else: honestly empty, no fabricated debris data
  }

  // Rocket bodies: resolve raw data via live → cache → honestly empty
  let rocketRaw = [], rocketSource = "UNAVAILABLE";
  try {
    const { data, succeeded, total } = await loadRealRocketBodies();
    if (succeeded > 0 && data.length) {
      rocketRaw = data;
      rocketSource = `LIVE(${succeeded}/${total})`;
      saveCache(CACHE_KEY_ROCKETS, data);
      console.info(`✔ Loaded ${data.length} real rocket bodies from live CelesTrak catalog search`);
    } else {
      throw new Error("rocket body search unavailable");
    }
  } catch (e) {
    console.warn("Live rocket body fetch failed, trying cache:", e.message || e);
    const cached = loadCache(CACHE_KEY_ROCKETS);
    if (cached && cached.data && cached.data.length) {
      rocketRaw = cached.data;
      rocketSource = `CACHE(${cacheAgeLabel(cached.savedAt)})`;
    } // else: honestly empty, no fabricated rocket-body data
  }

  // Single unified build — classification (not source) decides the
  // model/bucket for every object, so a rocket body or debris chunk
  // that happened to come from a "satellite" group still renders and
  // filters as what it actually is.
  buildAllObjects(satRaw, debrisRaw, rocketRaw);
  dataSourceState.sats   = satSource;
  dataSourceState.debris = `${debrisSource}${rocketRaw.length ? ` +${rocketRaw.length}RB` : ""}`;
  updateDataSourceNote();

  // Real active/defunct status (SATCAT), applied after satellites exist
  // so we have their NORAD IDs to cross-reference against. Also cached,
  // same as everything else, so a fresh-cache reload doesn't re-fetch it.
  try {
    const { statusMap, succeeded, total } = await loadOperationalStatus();
    if (succeeded > 0) {
      saveCache(CACHE_KEY_STATUS, Array.from(statusMap.entries()).map(([noradId, ops]) => ({ noradId, ops })));
    }
    satObjects.forEach(sat => {
      const code = sat.noradId != null ? statusMap.get(sat.noradId) : undefined;
      sat.opsStatus = code ?? null;
      sat.isActive = code == null ? null : ACTIVE_OPS_CODES.has(code);
    });
    dataSourceState.status = `LIVE(${succeeded}/${total})`;
    console.info(`✔ Resolved operational status for ${statusMap.size} catalog entries`);
  } catch (e) {
    console.warn("Operational status fetch failed, trying cache:", e.message || e);
    const cached = loadCache(CACHE_KEY_STATUS);
    if (cached && cached.data && cached.data.length) {
      const statusMap = new Map(cached.data.map(r => [r.noradId, r.ops]));
      satObjects.forEach(sat => {
        const code = sat.noradId != null ? statusMap.get(sat.noradId) : undefined;
        sat.opsStatus = code ?? null;
        sat.isActive = code == null ? null : ACTIVE_OPS_CODES.has(code);
      });
      dataSourceState.status = `CACHE(${cacheAgeLabel(cached.savedAt)})`;
    } else {
      dataSourceState.status = "UNAVAILABLE";
    }
  }
  applyFilter();
  updateDataSourceNote();
}

refreshAllData();

// Periodic refresh — real wall-clock cadence, independent of
// simulation time acceleration. TLEs don't need to be re-pulled
// more often than every few hours in practice. (Unchanged from
// before — the cache-freshness gate above is what actually fixes
// the over-requesting behavior, not this interval.)
const TLE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
setInterval(refreshAllData, TLE_REFRESH_INTERVAL_MS);

let selectedSat = null;

/* ============================================================
   SIMULATION CLOCK
   Decoupled from wall-clock time so we can pause or accelerate
   (1×/10×/100×/1000×) without affecting real-time systems like
   the periodic TLE refresh or conjunction screening interval.
   ============================================================ */
let simTimeMs     = Date.now();
let lastFrameReal = performance.now();
let timeScale     = 1; // 0 = paused

/* ============================================================
   SHARED EARTH-FIXED SCENE POSITION
   Same static-frame convention used everywhere else in this file
   (see computeSunDirectionScene above): lon=0,lat=0 → scene +X.
   Used for both satellites and debris so they share one source
   of truth for the coordinate mapping.
   ============================================================ */
function computeScenePosition(pv, gmst) {
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  const alt = Math.max(geo.height, 160);

  const r   = EARTH_R + 0.85 + alt / 4500;
  const phi = (90 - lat) * (Math.PI / 180);
  const tht = (lon + 180) * (Math.PI / 180);
  return {
    x: -r * Math.sin(phi) * Math.cos(tht),
    y:  r * Math.cos(phi),
    z:  r * Math.sin(phi) * Math.sin(tht),
    lat, lon, alt,
  };
}

function speedKmS(pv) {
  return Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2);
}

/* ============================================================
   REAL CONJUNCTION PREDICTION
   Delegates to the dedicated ConjunctionEngine module (see
   src/ConjunctionEngine.js) — this section just wires its output
   into this app's object model (.conjunction fields) and UI state
   (worstConjunction), on the same real-world-time interval as
   before so it doesn't spike every render frame.
   ============================================================ */
const EMPTY_CONJUNCTION = () => ({ distanceKm: Infinity, effectiveDistanceKm: Infinity, tca: null, relativeVelocityKmS: null, riskLevel: "SAFE", withName: null });

const conjunctionEngine = new ConjunctionEngine({
  windowMinutes: 30,            // predict 30 minutes ahead, not just a current-distance snapshot
  coarseSampleMinutes: 10,      // Stage 2 ranking resolution
  fineStepSeconds: 30,          // Stage 3 fine propagation resolution (then locally refined — see ConjunctionEngine.js)
  shellMarginKm: 50,            // Stage 1 orbital-shell overlap tolerance
  maxCandidatesPerPrimary: 5,
  globalMaxFinePairs: 250,      // hard safety cap — stays fast even with thousands of tracked objects
});

let worstConjunction = null; // read by the render loop for the alert panel

function runConjunctionScreening() {
  if (!satObjects.length || !debrisObjs.length) return;

  const baseNow = new Date(simTimeMs);
  const visibleSats    = satObjects.filter(s => s.mesh.visible);
  const visibleDebris  = debrisObjs.filter(d => d.mesh.visible);

  debrisObjs.forEach(d => { d.conjunction = EMPTY_CONJUNCTION(); });
  satObjects.forEach(s => { s.conjunction = EMPTY_CONJUNCTION(); });

  const { perPrimary, worst } = conjunctionEngine.run(visibleSats, visibleDebris, baseNow);

  perPrimary.forEach((result, primary) => {
    if (!result) return;
    // Risk is classified from the effective (hard-body-radius-adjusted)
    // separation, not the raw center-to-center distance — requirement 3.
    const risk = classifyRisk(result.effectiveDistanceKm);

    primary.conjunction = {
      distanceKm: result.distanceKm,               // raw closest-approach distance — unchanged meaning
      effectiveDistanceKm: result.effectiveDistanceKm,
      tca: result.tca,
      relativeVelocityKmS: result.relativeVelocityKmS,
      riskLevel: risk,
      withName: result.secondary.name,
    };

    // Symmetric bookkeeping: let the secondary object also know about
    // its closest known approach, if this is the best found for it.
    // "Closest" bookkeeping stays keyed on raw distance (unchanged meaning).
    if (result.distanceKm < result.secondary.conjunction.distanceKm) {
      result.secondary.conjunction = {
        distanceKm: result.distanceKm,
        effectiveDistanceKm: result.effectiveDistanceKm,
        tca: result.tca,
        relativeVelocityKmS: result.relativeVelocityKmS,
        riskLevel: risk,
        withName: primary.name,
      };
    }
  });

  worstConjunction = worst ? {
    sat: worst.primary,
    distanceKm: worst.distanceKm,
    effectiveDistanceKm: worst.effectiveDistanceKm,
    tca: worst.tca,
    relativeVelocityKmS: worst.relativeVelocityKmS,
    riskLevel: classifyRisk(worst.effectiveDistanceKm),
    withName: worst.secondary.name,
  } : null;
}
runConjunctionScreening();
setInterval(runConjunctionScreening, 5000); // real-time cadence — unchanged

function formatTCA(tcaDate, baseNow) {
  if (!tcaDate) return "—";
  const utc = tcaDate.toISOString().substring(11, 19) + " UTC";
  const deltaSec = Math.round((tcaDate.getTime() - (baseNow ?? new Date(simTimeMs)).getTime()) / 1000);
  if (deltaSec <= 0) return `${utc} (now)`;
  const m = Math.floor(deltaSec / 60), s = deltaSec % 60;
  return `${utc} (in ${m}m ${s}s)`;
}
function formatKm(km) {
  return km === Infinity || km === undefined || km === null ? "—" : `${km.toFixed(3)} km`;
}
function formatRelVel(kms) {
  return kms === undefined || kms === null ? "—" : `${kms.toFixed(3)} km/s`;
}
function riskClass(level) {
  return { SAFE: "threat-safe", LOW: "threat-low", MEDIUM: "threat-medium", HIGH: "threat-critical", CRITICAL: "threat-emergency" }[level] || "threat-safe";
}

/* ============================================================
   PHASE 2 — SMART CONJUNCTION PRIORITIZATION

   Purely additive and read-only with respect to everything above:
   it does not detect, screen, or predict conjunctions — it only
   reads the .conjunction results that runConjunctionScreening()
   (unchanged, above) has already computed, and ranks them with a
   deterministic weighted scoring model. Runs on its own timer, so
   it never touches the existing conjunction screening function.

   SCORING MODEL (0-100, weights sum to 100):

     Distance     40 pts — exponential decay on effective separation.
                            Physical proximity is the dominant driver
                            of real collision likelihood, so it gets
                            the largest weight. Score = 40 * e^(-d/10),
                            so it's near-full at contact distance and
                            fades to near-zero by ~50 km — deliberately
                            steep, since a 1 km miss is categorically
                            more concerning than a 20 km miss even
                            though both might read as "not touching."

     Urgency      20 pts — exponential decay on time-to-closest-approach.
                            An event 2 minutes away needs attention now;
                            one at the far edge of the 30-minute window
                            can wait. Score = 20 * e^(-minutes/10).

     Rel. velocity 15 pts — linear, capped at 15 km/s. Higher relative
                            velocity means more kinetic energy released
                            in a collision, i.e. worse consequences —
                            this is a *severity* factor, distinct from
                            distance/urgency which are *likelihood*
                            factors.

     Status       15 pts — is the tracked satellite active or defunct?
                            An operational mission is more important to
                            protect (and can potentially maneuver) than
                            a dead one. Active=full weight, unknown
                            status=60%, confirmed defunct=30%.

     Object type  10 pts — what is it conjuncting with? A rocket body
                            is a far larger mass than a small debris
                            fragment, so a collision with one would
                            create a much worse secondary debris field.
                            Rocket body=full weight, satellite/starlink
                            (in case of a sat-sat pairing)=80%, debris
                            (default)=60%.

   This directly covers every factor requested: Closest Approach
   Distance, Time to Closest Approach, and Relative Velocity are each
   their own term; "Operational Status" and "Active vs Defunct" are
   the same underlying signal (one weighted term); "Object Type" and
   "Satellite vs Debris vs Rocket Body" are likewise the same
   underlying signal (the other weighted term) — kept as single terms
   rather than double-counting the same information twice.

   Deliberately simple and fully deterministic (no ML) — every input
   is a real, already-computed value (or a real classification field),
   and the formula is transparent enough to later be swapped for a
   learned model without changing anything else in the app.
   ============================================================ */

const FACTOR_LABELS = {
  urgency: "Time to CA",
  velocity: "Relative Velocity",
  status: "Operational Status",
  secondaryType: "Object Type",
};

// Read-only lookup — does not modify debrisObjs/satObjects, just finds
// the object a given conjunction partner name refers to, so we can see
// its type for the "object type" scoring term.
function findObjectByName(name) {
  if (!name) return null;
  return debrisObjs.find(o => o.name === name) || satObjects.find(o => o.name === name) || null;
}

/* ------------------------------------------------------------
   PRIORITY MODEL — distance-gated, not additive.

   The previous version treated distance, time, velocity, status and
   object type as five independent additive contributors. That's
   mathematically wrong for this domain: it let a physically distant
   encounter (e.g. 45 km) reach a moderately high score just because
   it happened to be imminent and fast, even though a 45 km miss is
   not a real collision risk regardless of timing or speed.

   Real conjunction assessment doesn't work that way — miss distance
   is the dominant driver of actual collision likelihood, and factors
   like urgency/velocity/status only matter for *how* important an
   already-close event is, not whether it's worth worrying about at
   all. So here, distance sets a CEILING on the score (the maximum
   priority this event could possibly reach), and the remaining
   factors only modulate the score *within* that ceiling — they can
   never push a distant encounter into high-priority territory.

     ceiling = 100 * e^(-distance / K)        — distance-gated maximum
     modulation = floor + (1-floor) * (weighted sum of secondary factors)
     score = ceiling * modulation
   ------------------------------------------------------------ */
const DISTANCE_GATE_K = 12;      // km — decay rate of the distance ceiling
const MODULATION_FLOOR = 0.35;   // a close approach never gets pushed below 35% of its ceiling
const MODULATION_WEIGHTS = { urgency: 0.5, velocity: 0.25, status: 0.15, secondaryType: 0.10 }; // sums to 1

function computePriorityScore(sat) {
  const c = sat.conjunction;
  if (!c || c.distanceKm === Infinity || !c.tca) return null;

  const distKm = c.effectiveDistanceKm ?? c.distanceKm;
  const tcaMinutes = Math.max(0, (c.tca.getTime() - simTimeMs) / 60000);
  const relVel = c.relativeVelocityKmS ?? 0;

  // --- Distance: the dominant gate. Sets the maximum this event's
  // score can possibly reach, before any other factor is considered.
  const distanceFactor = Math.exp(-Math.max(0, distKm) / DISTANCE_GATE_K); // (0,1]
  const ceiling = 100 * distanceFactor;

  // --- Secondary factors, each normalized to (0,1): they only
  // modulate within the ceiling distance already set — they cannot
  // create priority out of nothing.
  const urgencyNorm  = Math.exp(-tcaMinutes / 10);
  const velocityNorm = Math.min(1, relVel / 15);
  const statusNorm =
    sat.isActive === true  ? 1.0 :
    sat.isActive === false ? 0.3 :
    0.6; // unknown status

  const secondary = findObjectByName(c.withName);
  const secondaryType = secondary?.type ?? "debris";
  const typeNorm =
    secondaryType === "rocket-body" ? 1.0 :
    secondaryType === "satellite" || secondaryType === "starlink" ? 0.8 :
    0.6; // debris (default)

  const components = { urgency: urgencyNorm, velocity: velocityNorm, status: statusNorm, secondaryType: typeNorm };
  const modulationRaw =
    MODULATION_WEIGHTS.urgency * urgencyNorm +
    MODULATION_WEIGHTS.velocity * velocityNorm +
    MODULATION_WEIGHTS.status * statusNorm +
    MODULATION_WEIGHTS.secondaryType * typeNorm; // (0,1)
  const modulation = MODULATION_FLOOR + (1 - MODULATION_FLOOR) * modulationRaw; // [floor,1]

  const total = Math.max(0, Math.min(100, ceiling * modulation));

  return {
    score: Math.round(total),
    total,
    ceiling,        // NEW: distance-gated maximum possible score for this event
    modulation,     // NEW: how much of that ceiling the secondary factors retained
    components,     // normalized (0-1) secondary-factor values, for the breakdown/highlighting
    raw: { distKm, tcaMinutes, relVel, isActive: sat.isActive, secondaryType },
  };
}

/* ------------------------------------------------------------
   PHASE 2B — EXPLAINABLE PRIORITY SCORING

   Everything below reads the breakdown/raw values computePriorityScore
   already produces — it does not reimplement or duplicate the scoring
   logic, and does not change any weight or formula above this line.
   ------------------------------------------------------------ */

// Adaptive bullet-point explanation — wording is chosen per-conjunction
// from the same raw values (distance, TCA, relative velocity, status,
// secondary type) that drove that conjunction's actual score, so the
// explanation always matches the real numbers rather than being fixed
// text.
function explainPriorityScore(result) {
  const { distKm, tcaMinutes, relVel, isActive, secondaryType } = result.raw;
  const bullets = [];

  // Distance is the dominant, gating factor in this model — always
  // stated first and explicitly, with the real computed ceiling value
  // for this specific conjunction (not a fixed phrase).
  bullets.push({
    key: "distance",
    text: `Closest approach is the dominant factor — caps maximum possible priority at ${Math.round(result.ceiling)}/100`,
  });

  if (distKm < 1)        bullets.push({ key: "distance", text: "Very small closest approach distance" });
  else if (distKm < 5)    bullets.push({ key: "distance", text: "Small closest approach distance" });
  else if (distKm < 25)   bullets.push({ key: "distance", text: "Moderate closest approach distance" });
  else if (distKm < 100)  bullets.push({ key: "distance", text: "Large closest approach distance" });
  else                     bullets.push({ key: "distance", text: "Safe miss distance" });

  if (tcaMinutes <= 5)        bullets.push({ key: "urgency", text: "Encounter occurs within the next 5 minutes" });
  else if (tcaMinutes <= 15)  bullets.push({ key: "urgency", text: "Encounter occurs within the next 15 minutes" });
  else if (tcaMinutes <= 20)  bullets.push({ key: "urgency", text: "Encounter approaching soon" });
  else                         bullets.push({ key: "urgency", text: "Encounter not imminent" });

  if (relVel >= 10)      bullets.push({ key: "velocity", text: "High relative velocity" });
  else if (relVel >= 4)   bullets.push({ key: "velocity", text: "Moderate relative velocity" });
  else                     bullets.push({ key: "velocity", text: "Low relative velocity" });

  if (isActive === true)       bullets.push({ key: "status", text: "Operational satellite" });
  else if (isActive === false)  bullets.push({ key: "status", text: "Defunct satellite (lower operational priority)" });
  else                            bullets.push({ key: "status", text: "Satellite status unknown" });

  if (secondaryType === "rocket-body")                                  bullets.push({ key: "secondaryType", text: "Large rocket body involved" });
  else if (secondaryType === "satellite" || secondaryType === "starlink") bullets.push({ key: "secondaryType", text: "Satellite-on-satellite conjunction" });
  else                                                                     bullets.push({ key: "secondaryType", text: "Small debris fragment involved" });

  return bullets;
}

// Confidence is a direct, deterministic function of the Priority Score
// itself (not random, not a separate model) — a simple three-band read
// of how strongly the weighted factors agree that this conjunction
// deserves attention.
function confidenceFromScore(score) {
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function topContributorKey(components) {
  return Object.entries(components).sort((a, b) => b[1] - a[1])[0][0];
}

// Persists which rows are expanded across the 5-second re-renders, keyed
// by satellite name, so an operator's open detail view doesn't snap shut.
const expandedPriorityRows = new Set();


function rankPriorityConjunctions() {
  return satObjects
    .filter(s => s.mesh.visible && s.conjunction && s.conjunction.distanceKm !== Infinity)
    .map(s => ({ sat: s, result: computePriorityScore(s) }))
    .filter(r => r.result !== null)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, 10);
}

function renderPriorityPanel() {
  if (!priorityList) return;
  const ranked = rankPriorityConjunctions();

  if (!ranked.length) {
    priorityList.innerHTML = `<div class="empty-state">No active conjunction candidates<br><span style="opacity:.5;font-size:10px">Ranking updates automatically</span></div>`;
    return;
  }

  priorityList.innerHTML = ranked.map((r, i) => {
    const c = r.sat.conjunction;
    const result = r.result;
    const confidence = confidenceFromScore(result.score);
    const topKey = topContributorKey(result.components);
    const expanded = expandedPriorityRows.has(r.sat.name);

    const detailsHtml = expanded ? `
      <div class="priority-details">
        <div class="priority-section-title">Reason</div>
        <ul class="priority-reasons">
          ${explainPriorityScore(result).map(b =>
            `<li class="${b.key === topKey ? "contributor-top" : ""}">${b.text}</li>`
          ).join("")}
        </ul>
        <div class="priority-section-title">Score Breakdown</div>
        <div class="priority-breakdown">
          <div class="breakdown-row breakdown-gate">
            <span>Closest Approach (gate)</span>
            <span>${result.ceiling.toFixed(1)} / 100</span>
          </div>
          <div class="priority-gate-note">Sets the maximum possible score below</div>
          ${Object.entries(FACTOR_LABELS).map(([key, label]) => `
            <div class="breakdown-row ${key === topKey ? "contributor-top" : ""}">
              <span>${label} <span class="breakdown-weight">(w:${Math.round(MODULATION_WEIGHTS[key] * 100)}%)</span></span>
              <span>${(result.components[key] * 100).toFixed(1)}%</span>
            </div>`).join("")}
          <div class="breakdown-row">
            <span>Combined Modulation</span>
            <span>×${(result.modulation * 100).toFixed(1)}%</span>
          </div>
          <div class="breakdown-row breakdown-total">
            <span>Final Score</span>
            <span>${result.total.toFixed(1)} / 100</span>
          </div>
        </div>
      </div>` : "";

    return `
      <div class="priority-row" data-key="${r.sat.name.replace(/"/g, "&quot;")}">
        <span class="priority-rank">#${i + 1}</span>
        <div class="priority-main">
          <div class="priority-names">${r.sat.name} → ${c.withName ?? "—"}</div>
          <div class="priority-meta">
            <span>${formatKm(c.distanceKm)}</span>
            <span>${formatTCA(c.tca, new Date(simTimeMs))}</span>
            <span class="threat-badge ${riskClass(c.riskLevel)}">${c.riskLevel}</span>
            <span class="confidence-badge confidence-${confidence.toLowerCase()}">${confidence}</span>
          </div>
          ${detailsHtml}
        </div>
        <span class="priority-score">${result.score}</span>
      </div>`;
  }).join("");
}

// Click-to-expand, delegated once — toggles the clicked row's details
// and persists that state across the periodic re-renders below.
priorityList?.addEventListener("click", (e) => {
  const row = e.target.closest(".priority-row");
  if (!row) return;
  const key = row.dataset.key;
  if (expandedPriorityRows.has(key)) expandedPriorityRows.delete(key);
  else expandedPriorityRows.add(key);
  renderPriorityPanel();
});

renderPriorityPanel();
setInterval(renderPriorityPanel, 5000); // same cadence as conjunction screening — independent timer, no shared code path

function typeClass(type) {
  return { satellite: "type-satellite", starlink: "type-starlink", debris: "type-debris", "rocket-body": "type-rocket-body" }[type] || "type-satellite";
}
function typeLabel(type) {
  return { satellite: "SATELLITE", starlink: "STARLINK", debris: "DEBRIS", "rocket-body": "ROCKET BODY" }[type] || "SATELLITE";
}
function statusLabel(o) {
  if (o.type === "debris") return "N/A (fragment)";
  if (o.type === "rocket-body") return "N/A (spent stage)";
  if (o.isActive === true) return "ACTIVE";
  if (o.isActive === false) return "DEFUNCT";
  return "STATUS UNKNOWN";
}
function statusClass(o) {
  if (o.type === "debris" || o.type === "rocket-body") return "status-na";
  if (o.isActive === true) return "status-active";
  if (o.isActive === false) return "status-defunct";
  return "status-unknown";
}

/* ============================================================
   SEARCH & FILTER  (activeFilter/applyFilter declared earlier,
   near the data pipeline, since they're used at module load time)
   ============================================================ */
filterChips.forEach(chip => {
  chip.addEventListener("click", () => {
    filterChips.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    applyFilter();
  });
});

function performSearch() {
  const q = (searchInput?.value || "").trim();
  if (!q) return;
  const all = [...satObjects, ...debrisObjs];
  let found = null;
  if (/^\d+$/.test(q)) found = all.find(o => o.noradId === parseInt(q, 10));
  if (!found) {
    const ql = q.toLowerCase();
    found = all.find(o => o.name.toLowerCase().includes(ql));
  }
  if (found) {
    if (!found.mesh.visible) { activeFilter = "all"; filterChips.forEach(c => c.classList.toggle("active", c.dataset.filter === "all")); applyFilter(); }
    selectedSat = found;
  } else {
    showError(`No object found matching "${q}"`);
    setTimeout(() => errorBanner?.classList.remove("visible"), 3000);
  }
}
searchBtn?.addEventListener("click", performSearch);
searchInput?.addEventListener("keydown", e => { if (e.key === "Enter") performSearch(); });

/* ============================================================
   TIME CONTROLS
   ============================================================ */
let lastActiveSpeed = 1;

function resetTrailsOnSpeedChange() {
  satObjects.forEach(s => { s.trail = []; }); // avoid a single long chord when speed jumps
}

timeSpeedBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    timeSpeedBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    timeScale = parseFloat(btn.dataset.speed);
    lastActiveSpeed = timeScale;
    if (pauseBtn) { pauseBtn.textContent = "⏸"; pauseBtn.classList.remove("active"); }
    resetTrailsOnSpeedChange();
  });
});

pauseBtn?.addEventListener("click", () => {
  if (timeScale === 0) {
    timeScale = lastActiveSpeed || 1;
    pauseBtn.textContent = "⏸";
    pauseBtn.classList.remove("active");
  } else {
    lastActiveSpeed = timeScale;
    timeScale = 0;
    pauseBtn.textContent = "▶";
    pauseBtn.classList.add("active");
  }
});

/* ============================================================
   RENDER LOOP
   ============================================================ */
const DEBRIS_UPDATE_EVERY = 3; // throttle debris propagation (~20fps effective, plenty for slow-moving dots)
let frameCounter = 0;

function renderFrame() {
  orbitTrails.clear();
  frameCounter++;

  const nowReal   = performance.now();
  const deltaReal = Math.min(nowReal - lastFrameReal, 250); // clamp to avoid huge jumps after tab was backgrounded
  lastFrameReal   = nowReal;
  simTimeMs += deltaReal * timeScale;
  const now  = new Date(simTimeMs);
  const gmst = satellite.gstime(now);

  /* -- Earth stays in the static Earth-fixed frame --
     Satellites (via eciToGeodetic → lon/lat) and the sun direction
     (via computeSunDirectionScene, same lon+180 convention) are both
     already expressed in this static frame. Spinning the mesh by GMST
     on top of that desynchronized the visible continents from the
     correctly-computed sunlight direction — that was the day/night bug.
     The mesh itself must stay fixed; camera auto-rotate (below) gives
     the "living planet" motion instead, without breaking accuracy. */
  clouds.rotation.y += 0.00006; // slow decorative drift only, not tied to gmst

  /* -- Real-time sun -- */
  const sunDir = computeSunDirectionScene(now);
  sunLight.position.copy(sunDir.clone().multiplyScalar(65));
  fillLight.position.copy(sunDir.clone().multiplyScalar(-45));

  /* -- Gentle camera orbit when nothing is selected and sim isn't paused -- */
  controls.autoRotate = !selectedSat && timeScale > 0;

  /* -- Decorative rings -- */
  equatorRing.rotation.z  += 0.0055;
  polarRing.rotation.y    += 0.0030;
  inclinedRing.rotation.z -= 0.0020;

  /* -- Propagate satellites (every frame — smooth trails/camera tracking) --
     If SGP4 fails for an object right now (stale/decayed TLE, epoch too far
     in the past, etc.) we explicitly mark it invalid and hide it — rather
     than silently leaving it parked at the scene origin forever, which is
     invisible (inside the Earth) and looks like the object never loaded.
     This mirrors how real SSA systems flag "lost" objects instead of just
     freezing their last known state. -- */
  satObjects.forEach(sat => {
    const pv = satellite.propagate(sat.satrec, now);
    if (!pv.position || !pv.velocity) {
      sat.valid = false;
      sat.mesh.visible = false;
      return;
    }
    sat.valid = true;
    sat.mesh.visible = sat.filterVisible;

    const p = computeScenePosition(pv, gmst);
    sat.mesh.position.set(p.x, p.y, p.z);
    sat.mesh.rotation.y += 0.007;

    if (sat.mesh.visible) {
      sat.trail.push(new THREE.Vector3(p.x, p.y, p.z));
      if (sat.trail.length > 160) sat.trail.shift();
      if (sat.trail.length > 2) {
        const tg = new THREE.BufferGeometry().setFromPoints(sat.trail);
        const tm = new THREE.LineBasicMaterial({ color: 0x00bfff, transparent: true, opacity: 0.38 });
        orbitTrails.add(new THREE.Line(tg, tm));
      }
    }

    sat.altitude  = p.alt.toFixed(1);
    sat.latitude  = p.lat.toFixed(4);
    sat.longitude = p.lon.toFixed(4);
    sat.speed     = speedKmS(pv).toFixed(3);
  });

  /* -- Propagate debris (throttled — real TLE data, not procedural) -- */
  if (frameCounter % DEBRIS_UPDATE_EVERY === 0) {
    debrisObjs.forEach(d => {
      const pv = satellite.propagate(d.satrec, now);
      if (!pv.position || !pv.velocity) {
        d.valid = false;
        d.mesh.visible = false;
        return;
      }
      d.valid = true;
      d.mesh.visible = d.filterVisible;

      const p = computeScenePosition(pv, gmst);
      d.mesh.position.set(p.x, p.y, p.z);
      d.altitude  = p.alt.toFixed(1);
      d.latitude  = p.lat.toFixed(4);
      d.longitude = p.lon.toFixed(4);
      d.speed     = speedKmS(pv).toFixed(3);
    });
  }

  /* -- Conjunction alert (from the periodic real screening pass, not a per-frame recheck) --
     Only ever shown for LOW risk or above — a SAFE closest-approach result
     (however close numerically to the safety threshold) is not an alert. */
  const dangerCtr = satObjects.filter(s => s.mesh.visible && s.conjunction.riskLevel !== "SAFE").length;
  const showAlert = worstConjunction && worstConjunction.riskLevel !== "SAFE";

  if (alertPanel) alertPanel.style.display = showAlert ? "block" : "none";
  if (showAlert && alertContent) {
    const c = worstConjunction;
    alertContent.innerHTML = `
      <div class="info-row"><span class="info-label">Satellite</span><span class="info-value">${c.sat.name}</span></div>
      <div class="info-row"><span class="info-label">Debris Object</span><span class="info-value">${c.withName ?? "—"}</span></div>
      <div class="info-row"><span class="info-label">Closest Approach</span><span class="info-value danger">${formatKm(c.distanceKm)}</span></div>
      <div class="info-row"><span class="info-label">Time to CA</span><span class="info-value">${formatTCA(c.tca, now)}</span></div>
      <div class="info-row"><span class="info-label">Relative Velocity</span><span class="info-value">${formatRelVel(c.relativeVelocityKmS)}</span></div>
      <div class="info-row"><span class="info-label">Risk Level</span><span class="threat-badge ${riskClass(c.riskLevel)}">${c.riskLevel}</span></div>
    `;
  }

  /* -- Hover tooltip (satellites + debris) -- */
  raycaster.setFromCamera(mouse, camera);
  const trackable = [...satObjects, ...debrisObjs].filter(o => o.mesh.visible);
  const allMeshes = trackable.map(o => o.mesh);
  const hits = raycaster.intersectObjects(allMeshes, true);

  if (hits.length && label) {
    let hovered = null;
    outer: for (const h of hits) {
      let o = h.object;
      while (o) { const s = trackable.find(s => s.mesh === o); if (s) { hovered = s; break outer; } o = o.parent; }
    }
    if (hovered) {
      label.style.display = "block";
      label.style.left = (mouseX + 18) + "px";
      label.style.top  = (mouseY + 14) + "px";
      label.innerHTML =
        `<b>${hovered.name}</b><br>` +
        `Alt&nbsp;&nbsp; ${hovered.altitude} km<br>` +
        `Lat&nbsp;&nbsp; ${hovered.latitude}°<br>` +
        `Lon&nbsp;&nbsp; ${hovered.longitude}°<br>` +
        `v&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${hovered.speed} km/s`;
    }
  } else if (label) { label.style.display = "none"; }

  /* -- Camera tracking -- */
  if (selectedSat) {
    controls.target.lerp(selectedSat.mesh.position, 0.06);
    camera.position.lerp(selectedSat.mesh.position.clone().add(new THREE.Vector3(3, 1.5, 3)), 0.028);
  }

  /* -- HUD values -- */
  if (satCount)    satCount.innerText    = satObjects.filter(s => s.mesh.visible).length;
  if (debrisCount) debrisCount.innerText = debrisObjs.filter(d => d.mesh.visible).length;
  if (frameCounter % 30 === 0) updateDataSourceNote(); // refresh valid-object diagnostic ~2x/sec
  if (dangerCount) dangerCount.innerText = dangerCtr;
  if (trackingName) trackingName.innerText = selectedSat ? selectedSat.name : "—";

  if (utcTime) {
    const hh = String(now.getUTCHours()).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
    const speedTag = timeScale === 0 ? " (PAUSED)" : timeScale !== 1 ? ` (×${timeScale})` : "";
    utcTime.innerText = `${hh}:${mm}:${ss}${speedTag}`;
  }

  if (selectedSat && satelliteInfo) {
    const c = selectedSat.conjunction || { distanceKm: Infinity, tca: null, relativeVelocityKmS: null, riskLevel: "SAFE", withName: null };
    satelliteInfo.innerHTML = `
      <div class="info-row"><span class="info-label">DESIGNATION</span><span class="info-value">${selectedSat.name}</span></div>
      <div class="info-row"><span class="info-label">NORAD ID</span><span class="info-value">${selectedSat.noradId ?? "—"}</span></div>
      <div class="info-row"><span class="info-label">TYPE</span><span class="type-badge ${typeClass(selectedSat.type)}">${typeLabel(selectedSat.type)}</span></div>
      <div class="info-row"><span class="info-label">STATUS</span><span class="threat-badge ${statusClass(selectedSat)}">${statusLabel(selectedSat)}</span></div>
      <div class="info-row"><span class="info-label">ALTITUDE</span><span class="info-value">${selectedSat.altitude} km</span></div>
      <div class="info-row"><span class="info-label">LATITUDE</span><span class="info-value">${selectedSat.latitude}°</span></div>
      <div class="info-row"><span class="info-label">LONGITUDE</span><span class="info-value">${selectedSat.longitude}°</span></div>
      <div class="info-row"><span class="info-label">VELOCITY</span><span class="info-value">${selectedSat.speed} km/s</span></div>
      <div class="info-row"><span class="info-label">CLOSEST OBJECT</span><span class="info-value">${c.withName ?? "—"}</span></div>
      <div class="info-row"><span class="info-label">CLOSEST APPROACH</span><span class="info-value">${formatKm(c.distanceKm)}</span></div>
      <div class="info-row"><span class="info-label">TIME TO CA</span><span class="info-value">${formatTCA(c.tca, now)}</span></div>
      <div class="info-row"><span class="info-label">REL. VELOCITY</span><span class="info-value">${formatRelVel(c.relativeVelocityKmS)}</span></div>
      <div class="info-row"><span class="info-label">RISK LEVEL</span><span class="threat-badge ${riskClass(c.riskLevel)}">${c.riskLevel}</span></div>
    `;
  }


  controls.update();
  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  try { renderFrame(); } catch (e) { showError("Frame error: " + (e?.message || e)); }
}
animate();

/* ============================================================
   EVENTS
   ============================================================ */
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.addEventListener("click", () => {
  raycaster.setFromCamera(mouse, camera);
  const trackable = [...satObjects, ...debrisObjs].filter(o => o.mesh.visible);
  const hits = raycaster.intersectObjects(trackable.map(o => o.mesh), true);
  if (!hits.length) return;
  let clicked = null;
  outer: for (const h of hits) {
    let o = h.object;
    while (o) { const s = trackable.find(s => s.mesh === o); if (s) { clicked = s; break outer; } o = o.parent; }
  }
  if (clicked) selectedSat = clicked;
});

window.addEventListener("dblclick", () => {
  selectedSat = null;
  controls.target.set(0, 0, 0);
});