import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";

import { OrbitControls }
from "https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js";

import * as satellite
from "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm";

// ======================
// Scene
// ======================

const scene = new THREE.Scene();

scene.background =
  new THREE.Color(0x000814);

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

renderer.shadowMap.enabled = true;

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

controls.minDistance = 8;
controls.maxDistance = 120;

// ======================
// Lights
// ======================

scene.add(
  new THREE.AmbientLight(
    0xffffff,
    0.18
  )
);

const dirLight =
  new THREE.DirectionalLight(
    0xffffff,
    2.2
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
    0.45
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
      map: earthTexture,
      roughness: 1
    })
  );

scene.add(earth);

// ======================
// Atmosphere
// ======================

const atmosphere =
  new THREE.Mesh(

    new THREE.SphereGeometry(
      5.08,
      64,
      64
    ),

    new THREE.MeshPhongMaterial({

      color: 0x2266ff,

      transparent: true,

      opacity: 0.08,

      side: THREE.BackSide
    })
  );

scene.add(atmosphere);

// ======================
// Radar Ring
// ======================

const radarGeometry =
  new THREE.RingGeometry(
    7,
    7.15,
    64
  );

const radarMaterial =
  new THREE.MeshBasicMaterial({

    color: 0x00ffcc,

    transparent: true,

    opacity: 0.35,

    side: THREE.DoubleSide
  });

const radarRing =
  new THREE.Mesh(
    radarGeometry,
    radarMaterial
  );

radarRing.rotation.x =
  Math.PI / 2;

scene.add(radarRing);

// ======================
// Stars
// ======================

function createStars() {

  const geometry =
    new THREE.BufferGeometry();

  const vertices = [];

  for (let i = 0; i < 7000; i++) {

    vertices.push(
      (Math.random() - 0.5) * 2500,
      (Math.random() - 0.5) * 2500,
      (Math.random() - 0.5) * 2500
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
      size: 0.6
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

const alertPanel =
  document.getElementById(
    "alertPanel"
  );


  const satCount =
  document.getElementById(
    "satCount"
  );

const debrisCount =
  document.getElementById(
    "debrisCount"
  );

const dangerCount =
  document.getElementById(
    "dangerCount"
  );

const trackingName =
  document.getElementById(
    "trackingName"
  );

const utcTime =
  document.getElementById(
    "utcTime"
  );

  const satelliteInfo =
  document.getElementById(
    "satelliteInfo"
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
// Orbit Trails
// ======================

const orbitTrails =
  new THREE.Group();

scene.add(orbitTrails);

// ======================
// Satellite Data
// ======================

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
// Satellites
// ======================

const satellites = [];

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
            ? 0x00ff88
            : 0xff5555,

        metalness: 0.8,
        roughness: 0.25
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

  group.scale.set(
    2.5,
    2.5,
    2.5
  );

  scene.add(group);

  const satrec =
    satellite.twoline2satrec(
      satData.tle1,
      satData.tle2
    );

  satellites.push({

    mesh: group,
    body,
    satrec,
    name: satData.name,
    trail: [],
    altitude: 0,
    latitude: 0,
    longitude: 0,
    speed: 0,
    nearestDistance: 0
  });
});

// ======================
// Selected Satellite
// ======================

let selectedSatellite = null;

// ======================
// Space Debris
// ======================

const debris = [];

const debrisGeometry =
  new THREE.SphereGeometry(
    0.03,
    4,
    4
  );

const debrisMaterial =
  new THREE.MeshBasicMaterial({
    color: 0xffaa00
  });

for (let i = 0; i < 500; i++) {

  const mesh =
    new THREE.Mesh(
      debrisGeometry,
      debrisMaterial
    );

  const radius =
    7 + Math.random() * 6;

  const angle =
    Math.random() * Math.PI * 2;

  const inclination =
    (Math.random() - 0.5) * Math.PI;

  mesh.position.x =
    radius *
    Math.cos(angle);

  mesh.position.z =
    radius *
    Math.sin(angle);

  mesh.position.y =
    radius *
    Math.sin(inclination);

  scene.add(mesh);

  debris.push({

    mesh,
    radius,
    angle,
    inclination,
    speed:
      0.0005 +
      Math.random() * 0.002
  });
}

// ======================
// Animation
// ======================

function animate() {

  requestAnimationFrame(
    animate
  );

  orbitTrails.clear();

  const now =
    new Date();

  const gmst =
    satellite.gstime(now);

  earth.rotation.y = gmst;

  atmosphere.rotation.y =
    gmst;

    // radar sweep

radarRing.rotation.z += 0.01;

  // ======================
  // SATELLITES
  // ======================

  satellites.forEach((sat) => {

    const pv =
      satellite.propagate(
        sat.satrec,
        now
      );

    if (!pv.position ||
        !pv.velocity)
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

    sat.mesh.rotation.y +=
      0.01;

    // TRAILS

    sat.trail.push(
      new THREE.Vector3(
        x,
        y,
        z
      )
    );

    if (sat.trail.length > 120) {

      sat.trail.shift();
    }

    const trailGeometry =
      new THREE.BufferGeometry()
        .setFromPoints(
          sat.trail
        );

    const trailMaterial =
      new THREE.LineBasicMaterial({
        color: 0x00ffff
      });

    const trail =
      new THREE.Line(
        trailGeometry,
        trailMaterial
      );

    orbitTrails.add(trail);

    // DATA

    sat.altitude =
  geo.height.toFixed(2);

sat.latitude =
  lat.toFixed(2);

sat.longitude =
  lon.toFixed(2);

sat.speed =
  Math.sqrt(
    pv.velocity.x ** 2 +
    pv.velocity.y ** 2 +
    pv.velocity.z ** 2
  ).toFixed(2);

    sat.latitude =
      lat.toFixed(2);

    sat.longitude =
      lon.toFixed(2);

    sat.speed =
      Math.sqrt(
        pv.velocity.x ** 2 +
        pv.velocity.y ** 2 +
        pv.velocity.z ** 2
      ).toFixed(2);

    sat.body.material.color.set(
      sat.name === "ISS"
        ? 0x00ff88
        : 0xff5555
    );
  });

  // ======================
  // COLLISION DETECTION
  // ======================

  let dangerCounter = 0;
  let dangerFound = false;

  satellites.forEach((sat) => {

    let nearestDistance =
      Infinity;

    debris.forEach((d) => {

      const distance =
        sat.mesh.position.distanceTo(
          d.mesh.position
        );

      if (distance <
          nearestDistance) {

        nearestDistance =
          distance;
      }

      if (distance < 0.45) {

        dangerFound = true;
        dangerCounter++;

        sat.body.material.color.set(

          Math.sin(
            Date.now() * 0.02
          ) > 0

          ? 0xff0000
          : 0xffff00
        );

        if (alertPanel) {

          alertPanel.style.display =
            "block";

          alertPanel.innerHTML = `

            <h2>
              ⚠ COLLISION ALERT
            </h2>

            <p>
              <b>Satellite:</b>
              ${sat.name}
            </p>

            <p>
              <b>Distance:</b>
              ${distance.toFixed(3)}
            </p>

            <p style="color:red">
              Threat Level: HIGH
            </p>
          `;
        }
      }
    });

    sat.nearestDistance =
      nearestDistance.toFixed(3);
  });

  if (!dangerFound &&
      alertPanel) {

    alertPanel.style.display =
      "none";
  }

  // ======================
  // HOVER
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

        <b>
          ${hovered.name}
        </b>

        <br>

        Altitude:
        ${hovered.altitude} km

        <br>

        Latitude:
        ${hovered.latitude}

        <br>

        Longitude:
        ${hovered.longitude}

        <br>

        Speed:
        ${hovered.speed} km/s

        <br>

        Nearest Debris:
        ${hovered.nearestDistance}
      `;
    }

  } else {

    if (label) {

      label.style.display =
        "none";
    }
  }

  // ======================
  // CAMERA FOLLOW
  // ======================

  if (selectedSatellite) {

    const satPos =
      selectedSatellite.mesh.position;

    controls.target.lerp(
      satPos,
      0.08
    );

    const desiredPosition =
      satPos.clone().add(
        new THREE.Vector3(
          2,
          1,
          2
        )
      );

    camera.position.lerp(
      desiredPosition,
      0.03
    );
  }

  // ======================
  // DEBRIS ANIMATION
  // ======================

  debris.forEach((d) => {

    d.angle += d.speed;

    d.mesh.position.x =
      d.radius *
      Math.cos(d.angle);

    d.mesh.position.z =
      d.radius *
      Math.sin(d.angle);

    d.mesh.position.y =
      d.radius *
      Math.sin(
        d.inclination
      );
  });

  satCount.innerText =
  satellites.length;

debrisCount.innerText =
  debris.length;

dangerCount.innerText =
  dangerCounter;

trackingName.innerText =
  selectedSatellite
    ? selectedSatellite.name
    : "NONE";

utcTime.innerText =
  now.toUTCString();
  if (
    selectedSatellite &&
    satelliteInfo
  ) {
  
    satelliteInfo.innerHTML = `
  
      <b>Name:</b>
      ${selectedSatellite.name}
      <br>
  
      <b>Altitude:</b>
      ${selectedSatellite.altitude} km
      <br>
  
      <b>Latitude:</b>
      ${selectedSatellite.latitude}°
      <br>
  
      <b>Longitude:</b>
      ${selectedSatellite.longitude}°
      <br>
  
      <b>Velocity:</b>
      ${selectedSatellite.speed} km/s
      <br>
  
      <b>Nearest Debris:</b>
      ${selectedSatellite.nearestDistance}
      <br>
  
      <b>Status:</b>
      ACTIVE
    `;
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

// ======================
// Click Detection
// ======================

window.addEventListener(
  "click",
  () => {

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

      const clicked =
        satellites.find(

          s =>
            s.mesh === obj ||
            s.mesh === obj.parent ||
            s.mesh === obj.parent?.parent
        );

      if (clicked) {

        selectedSatellite =
          clicked;
      }
    }
  }
);

// ======================
// Double Click Reset
// ======================

window.addEventListener(
  "dblclick",
  () => {

    selectedSatellite = null;

    controls.target.set(
      0,
      0,
      0
    );
  }
);