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
// Lights
// ======================

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(10, 5, 10);
scene.add(directionalLight);

// ======================
// Earth (REAL TEXTURE)
// ======================

const textureLoader = new THREE.TextureLoader();

const earthTexture = textureLoader.load(
  "https://threejs.org/examples/textures/land_ocean_ice_cloud_2048.jpg"
);

const earthGeometry = new THREE.SphereGeometry(5, 64, 64);

const earthMaterial = new THREE.MeshStandardMaterial({
  map: earthTexture
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);
// ======================
// Atmosphere Glow
// ======================

const atmosphereGeometry = new THREE.SphereGeometry(5.2, 64, 64);

const atmosphereMaterial = new THREE.MeshBasicMaterial({
  color: 0x3399ff,
  transparent: true,
  opacity: 0.2,
  side: THREE.BackSide
});

const atmosphere = new THREE.Mesh(
  atmosphereGeometry,
  atmosphereMaterial
);

scene.add(atmosphere);

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
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.7
  });

  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);
}

createStars();

// ======================
// Satellite (simple orbiting object)
// ======================

const satelliteGeometry = new THREE.SphereGeometry(0.15, 16, 16);

const satelliteMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000
});

const satellite = new THREE.Mesh(satelliteGeometry, satelliteMaterial);

scene.add(satellite);

const orbitRadius = 8;
let angle = 0;

// ======================
// Animation Loop
// ======================

function animate() {
  requestAnimationFrame(animate);

  // Earth rotation
  earth.rotation.y += 0.002;

  // Satellite orbit
  angle += 0.01;

  satellite.position.x = orbitRadius * Math.cos(angle);
  satellite.position.z = orbitRadius * Math.sin(angle);

  renderer.render(scene, camera);
}

animate();

// ======================
// Resize Support
// ======================

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});