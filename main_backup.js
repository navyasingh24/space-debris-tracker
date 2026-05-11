import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";

import { OrbitControls }
from "https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js";

import * as satellite
from "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm";

// ======================
// Scene
// ======================

const scene = new THREE.Scene();

// ======================
// Camera
// ======================

const camera =
  new THREE.PerspectiveCamera(
    75,
    window.innerWidth /
    window.innerHeight,
    0.1,
    3000
  );

camera.position.set(0, 0, 25);

// ======================
// Renderer
// ======================

const renderer =
  new THREE.WebGLRenderer({
    antialias: true
  });

renderer.setSize(
  window.innerWidth,
  window.innerHeight
);

renderer.setPixelRatio(
  window.devicePixelRatio
);

document.body.appendChild(
  renderer.domElement
);

// ======================
// Controls
// ======================

const controls =
  new OrbitControls(
    camera,
    renderer.domElement
  );

controls.enableDamping = true;

// ======================
// Lights
// ======================

scene.add(
  new THREE.AmbientLight(
    0xffffff,
    0.6
  )
);

const dirLight =
  new THREE.DirectionalLight(
    0xffffff,
    1.5
  );

dirLight.position.set(
  10,
  5,
  10
);

scene.add(dirLight);

scene.add(
  new THREE.HemisphereLight(
    0xffffff,
    0x222244,
    1
  )
);

// ======================
// Earth
// ======================

const loader =
  new THREE.TextureLoader();

const earthTexture =
  loader.load(
    "https://threejs.org/examples/textures/land_ocean_ice_cloud_2048.jpg"
  );

const earth =
  new THREE.Mesh(

    new THREE.SphereGeometry(
      5,
      64,
      64
    ),

    new THREE.MeshStandardMaterial({
      map: earthTexture
    })
  );

scene.add(earth);

// ======================
// Atmosphere
// ======================

const atmosphere =
  new THREE.Mesh(

    new THREE.SphereGeometry(
      5.15,
      64,
      64
    ),

    new THREE.MeshBasicMaterial({

      color: 0x3399ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide
    })
  );

scene.add(atmosphere);

// ======================
// Stars
// ======================

function createStars() {

  const geometry =
    new THREE.BufferGeometry();

  const vertices = [];

  for (let i = 0; i < 5000; i++) {

    vertices.push(
      (Math.random() - 0.5) * 2000,
      (Math.random() - 0.5) * 2000,
      (Math.random() - 0.5) * 2000
    );
  }

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      vertices,
      3
    )
  );

  const material =
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.7
    });

  const stars =
    new THREE.Points(
      geometry,
      material
    );

  scene.add(stars);
}

createStars();

// ======================
// HUD
// ======================

const label =
  document.getElementById(
    "hud"
  );

// ======================
// Mouse
// ======================

const mouse =
  new THREE.Vector2();

let mouseX = 0;
let mouseY = 0;

window.addEventListener(
  "mousemove",
  (event) => {

    mouse.x =
      (event.clientX /
      window.innerWidth) * 2 - 1;

    mouse.y =
      -(event.clientY /
      window.innerHeight) * 2 + 1;

    mouseX = event.clientX;
    mouseY = event.clientY;
  }
);

const raycaster =
  new THREE.Raycaster();

// ======================
// Satellites
// ======================

const satellites = [];

const satelliteData = [

  {
    name: "ISS",
    tle1:
      "1 25544U 98067A   24182.51782528  .00016717  00000+0  30720-3 0  9993",

    tle2:
      "2 25544  51.6416 311.1781 0004737  73.7745  38.9291 15.50082742459675"
  },

  {
    name: "HUBBLE",
    tle1:
      "1 20580U 90037B   24181.86196136  .00000826  00000+0  39016-4 0  9991",

    tle2:
      "2 20580  28.4692 120.7476 0002947  35.4435 324.6739 15.09154806215112"
  },

  {
    name: "NOAA 15",
    tle1:
      "1 25338U 98030A   24182.46803959  .00000082  00000+0  72926-4 0  9995",

    tle2:
      "2 25338  98.7425 212.7765 0011476 107.8123 252.4305 14.25909929361519"
  },

  {
    name: "STARLINK",
    tle1:
      "1 44713U 19074A   24182.47227903  .00003074  00000+0  20983-3 0  9990",

    tle2:
      "2 44713  53.0541 145.3615 0001629  83.7764 276.3381 15.06384739261705"
  },

  {
    name: "TERRA",
    tle1:
      "1 25994U 99068A   24182.49470562  .00000177  00000+0  81975-4 0  9997",

    tle2:
      "2 25994  98.2051 242.7425 0001171  89.0252 271.1073 14.57109036302815"
  }
];

// ======================
// Create Satellite Models
// ======================

satelliteData.forEach((satData) => {

  const group =
    new THREE.Group();

  // BODY

  const body =
    new THREE.Mesh(

      new THREE.BoxGeometry(
        0.12,
        0.12,
        0.25
      ),

      new THREE.MeshStandardMaterial({

        color:
          satData.name === "ISS"
            ? 0x00ff00
            : 0xff4444,

        metalness: 0.7,
        roughness: 0.3
      })
    );

  // PANELS

  const panelGeo =
    new THREE.BoxGeometry(
      0.4,
      0.06,
      0.02
    );

  const panelMat =
    new THREE.MeshStandardMaterial({
      color: 0x111111
    });

  const leftPanel =
    new THREE.Mesh(
      panelGeo,
      panelMat
    );

  leftPanel.position.x = -0.25;

  const rightPanel =
    new THREE.Mesh(
      panelGeo,
      panelMat
    );

  rightPanel.position.x = 0.25;

  group.add(body);
  group.add(leftPanel);
  group.add(rightPanel);

  // IMPORTANT

  group.scale.set(
    2.5,
    2.5,
    2.5
  );

  scene.add(group);

  // TLE

  const satrec =
    satellite.twoline2satrec(
      satData.tle1,
      satData.tle2
    );

  satellites.push({

    mesh: group,
    satrec,
    name: satData.name,
    altitude: 0
  });
});

// ======================
// Animate
// ======================

function animate() {

  requestAnimationFrame(
    animate
  );

  const now =
    new Date();

  const gmst =
    satellite.gstime(now);

  // Earth Rotation

  earth.rotation.y = gmst;
  atmosphere.rotation.y = gmst;

  // Satellites

  satellites.forEach((sat) => {

    const pv =
      satellite.propagate(
        sat.satrec,
        now
      );

    if (!pv.position)
      return;

    const geo =
      satellite.eciToGeodetic(
        pv.position,
        gmst
      );

    const lat =
      satellite.degreesLat(
        geo.latitude
      );

    const lon =
      satellite.degreesLong(
        geo.longitude
      );

    // ======================
    // FIXED STABLE SCALING
    // ======================

    const altitude =
      Math.max(
        geo.height,
        300
      );

    const radius =
      5.8 + altitude / 4000;

    const phi =
      (90 - lat) *
      (Math.PI / 180);

    const theta =
      (lon + 180) *
      (Math.PI / 180);

    const x =
      -radius *
      Math.sin(phi) *
      Math.cos(theta);

    const z =
      radius *
      Math.sin(phi) *
      Math.sin(theta);

    const y =
      radius *
      Math.cos(phi);

    sat.mesh.position.set(
      x,
      y,
      z
    );

    sat.altitude =
      geo.height.toFixed(2);
  });

  // ======================
  // Hover Detection
  // ======================

  raycaster.setFromCamera(
    mouse,
    camera
  );

  const hits =
    raycaster.intersectObjects(
      satellites.map(
        s => s.mesh
      ),
      true
    );

  if (hits.length > 0) {

    const obj =
      hits[0].object;

    const hovered =
      satellites.find(

        s =>
          s.mesh === obj ||
          s.mesh === obj.parent ||
          s.mesh === obj.parent?.parent
      );

    if (hovered && label) {

      label.style.display =
        "block";

      label.style.left =
        mouseX + 15 + "px";

      label.style.top =
        mouseY + 15 + "px";

      label.innerHTML = `
        <b>${hovered.name}</b><br>
        Altitude:
        ${hovered.altitude} km
      `;
    }

  } else {

    if (label) {

      label.style.display =
        "none";
    }
  }

  controls.update();

  renderer.render(
    scene,
    camera
  );
}

animate();

// ======================
// Resize
// ======================

window.addEventListener(
  "resize",
  () => {

    camera.aspect =
      window.innerWidth /
      window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );
  }
);