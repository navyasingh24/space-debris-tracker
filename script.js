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

camera.position.z = 20;

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

const ambientLight = new THREE.AmbientLight(
  0xffffff,
  0.4
);

scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(
  0xffffff,
  2
);

directionalLight.position.set(10, 5, 10);

scene.add(directionalLight);

// ======================
// Earth Texture
// ======================

const textureLoader = new THREE.TextureLoader();

const earthTexture = textureLoader.load(
  "https://threejs.org/examples/textures/land_ocean_ice_cloud_2048.jpg"
);

// ======================
// Earth
// ======================

const earthGeometry = new THREE.SphereGeometry(
  5,
  64,
  64
);

const earthMaterial = new THREE.MeshStandardMaterial({
  map: earthTexture
});

const earth = new THREE.Mesh(
  earthGeometry,
  earthMaterial
);

scene.add(earth);

// ======================
// Atmosphere Glow
// ======================

const atmosphereGeometry = new THREE.SphereGeometry(
  5.2,
  64,
  64
);

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
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
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
// Satellite Object
// ======================

const satelliteGeometry = new THREE.SphereGeometry(
    0.5,
    16,
    16
  );

const satelliteMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000
});

const satelliteMesh = new THREE.Mesh(
  satelliteGeometry,
  satelliteMaterial
);

scene.add(satelliteMesh);

// ======================
// ISS TLE DATA
// ======================

const tleLine1 =
  "1 25544U 98067A   24182.51782528  .00016717  00000+0  30720-3 0  9993";

const tleLine2 =
  "2 25544  51.6416 311.1781 0004737  73.7745  38.9291 15.50082742459675";

// Create satellite record

const satrec = satellite.twoline2satrec(
  tleLine1,
  tleLine2
);

// ======================
// Animation Loop
// ======================

function animate() {

  requestAnimationFrame(animate);

  // Rotate Earth
  earth.rotation.y += 0.002;

  atmosphere.rotation.y += 0.002;

  // Current time
  const now = new Date();

  // Get satellite position
  const positionAndVelocity =
    satellite.propagate(satrec, now);

  const position = positionAndVelocity.position;

  if (position) {

    const scaleFactor = 1000;

// Better coordinate mapping
satelliteMesh.position.x = position.x / scaleFactor;
satelliteMesh.position.y = position.y / scaleFactor;
satelliteMesh.position.z = position.z / scaleFactor;

// Push orbit slightly outward from Earth
satelliteMesh.position.multiplyScalar(1.8);
  }

  renderer.render(scene, camera);
}

// START animation
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