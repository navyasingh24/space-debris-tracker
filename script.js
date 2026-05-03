// script.js

// ======================
// Scene Setup
// ======================

const scene = new THREE.Scene();

// ======================
// Camera
// ======================

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.z = 15;

// ======================
// Renderer
// ======================

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

document.body.appendChild(renderer.domElement);

// ======================
// Earth
// ======================

// Geometry
const earthGeometry = new THREE.SphereGeometry(5, 64, 64);

// Material
const earthMaterial = new THREE.MeshStandardMaterial({
  color: 0x2266ff
});

// Mesh
const earth = new THREE.Mesh(
  earthGeometry,
  earthMaterial
);

scene.add(earth);

// ======================
// Lights
// ======================

// Ambient Light
const ambientLight = new THREE.AmbientLight(
  0xffffff,
  0.4
);

scene.add(ambientLight);

// Directional Light
const directionalLight = new THREE.DirectionalLight(
  0xffffff,
  1
);

directionalLight.position.set(5, 3, 5);

scene.add(directionalLight);

// ======================
// Stars Background
// ======================

function createStars() {

  const starGeometry = new THREE.BufferGeometry();

  const starCount = 5000;

  const positions = [];

  for (let i = 0; i < starCount; i++) {

    const x = (Math.random() - 0.5) * 2000;
    const y = (Math.random() - 0.5) * 2000;
    const z = (Math.random() - 0.5) * 2000;

    positions.push(x, y, z);
  }

  starGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.7
  });

  const stars = new THREE.Points(
    starGeometry,
    starMaterial
  );

  scene.add(stars);
}

createStars();

// ======================
// Satellite
// ======================

// Geometry
const satelliteGeometry = new THREE.SphereGeometry(
  0.15,
  16,
  16
);

// Material
const satelliteMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000
});

// Mesh
const satellite = new THREE.Mesh(
  satelliteGeometry,
  satelliteMaterial
);

scene.add(satellite);

// Orbit radius
const orbitRadius = 8;

// ======================
// Animation
// ======================

let angle = 0;

function animate() {

  requestAnimationFrame(animate);

  // Rotate Earth
  earth.rotation.y += 0.002;

  // Orbit satellite
  angle += 0.01;

  satellite.position.x =
    orbitRadius * Math.cos(angle);

  satellite.position.z =
    orbitRadius * Math.sin(angle);

  renderer.render(scene, camera);
}

animate();

// ======================
// Resize Support
// ======================

window.addEventListener("resize", () => {

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();
});