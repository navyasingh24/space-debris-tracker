import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js";

import { OrbitControls } from "https://cdn.skypack.dev/three@0.128.0/examples/jsm/controls/OrbitControls.js";
import * as satellite from "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/+esm";

import { satelliteData } from "./satellites.js";

import { latLonToVector3 } from "./utils.js";

// ======================
// Scene
// ======================

const scene = new THREE.Scene();

// ======================
// Camera
// ======================

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

camera.position.set(0, 0, 15);

// ======================
// Renderer
// ======================

const renderer = new THREE.WebGLRenderer({
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
// Orbit Controls
// ======================

const controls = new OrbitControls(
  camera,
  renderer.domElement
);

controls.enableDamping = true;
controls.dampingFactor = 0.05;

// ======================
// Lights
// ======================

const ambientLight =
  new THREE.AmbientLight(
    0xffffff,
    0.5
  );

scene.add(ambientLight);

const directionalLight =
  new THREE.DirectionalLight(
    0xffffff,
    2
  );

directionalLight.position.set(
  10,
  5,
  10
);

scene.add(directionalLight);

// ======================
// Earth
// ======================

const textureLoader =
  new THREE.TextureLoader();

const earthTexture =
  textureLoader.load(
    "https://threejs.org/examples/textures/land_ocean_ice_cloud_2048.jpg"
  );

const earthGeometry =
  new THREE.SphereGeometry(
    5,
    64,
    64
  );

const earthMaterial =
  new THREE.MeshStandardMaterial({
    map: earthTexture
  });

const earth =
  new THREE.Mesh(
    earthGeometry,
    earthMaterial
  );

scene.add(earth);

// ======================
// Atmosphere
// ======================

const atmosphereGeometry =
  new THREE.SphereGeometry(
    5.15,
    64,
    64
  );

const atmosphereMaterial =
  new THREE.MeshBasicMaterial({
    color: 0x3399ff,
    transparent: true,
    opacity: 0.2,
    side: THREE.BackSide
  });

const atmosphere =
  new THREE.Mesh(
    atmosphereGeometry,
    atmosphereMaterial
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
      (Math.random() - 0.5) * 2000
    );

    vertices.push(
      (Math.random() - 0.5) * 2000
    );

    vertices.push(
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
// Satellites
// ======================

const satellites = [];

satelliteData.forEach((satData) => {

  const geometry =
    new THREE.SphereGeometry(
      0.18,
      16,
      16
    );

  const material =
    new THREE.MeshBasicMaterial({
      color: 0xff0000
    });

  const mesh =
    new THREE.Mesh(
      geometry,
      material
    );

  scene.add(mesh);

  const satrec =
    satellite.twoline2satrec(
      satData.tle1,
      satData.tle2
    );

  satellites.push({
    mesh,
    satrec
  });
});

// ======================
// Animation
// ======================

function animate() {

  requestAnimationFrame(
    animate
  );

  const now = new Date();

  // Real GMST Earth rotation

  const gmst =
    satellite.gstime(now);

  earth.rotation.y = gmst;

  atmosphere.rotation.y = gmst;

  // Update satellites

  satellites.forEach((sat) => {

    const pv =
      satellite.propagate(
        sat.satrec,
        now
      );

    const positionEci =
      pv.position;

    if (positionEci) {

      const geodetic =
        satellite.eciToGeodetic(
          positionEci,
          gmst
        );

      const latitude =
        satellite.degreesLat(
          geodetic.latitude
        );

      const longitude =
        satellite.degreesLong(
          geodetic.longitude
        );

      // Visual altitude scaling

      const altitude =
        geodetic.height / 150;

      const coords =
        latLonToVector3(
          latitude,
          longitude,
          5,
          altitude
        );

      sat.mesh.position.set(
        coords.x,
        coords.y,
        coords.z
      );
    }
  });

  controls.update();

  renderer.render(
    scene,
    camera
  );
}

animate();

// ======================
// Resize Support
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