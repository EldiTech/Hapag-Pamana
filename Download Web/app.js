// Setup Three.js scene
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
// No background color, letting the CSS vellum background show through
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

// Lighting to match the "warm vellum/gold" feel
const ambientLight = new THREE.AmbientLight(0xfffbf0, 0.6); // Warm ambient
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xdcb661, 1); // Gilt light
directionalLight.position.set(5, 5, 2);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0xa9823c, 0.8); // Gold-deep light
pointLight.position.set(-5, -5, 5);
scene.add(pointLight);

// Create a gold ring / coin shape to represent the Hapag Pamana heirloom
const geometry = new THREE.TorusGeometry(1.2, 0.3, 16, 100);
const material = new THREE.MeshStandardMaterial({
    color: 0xa9823c,
    metalness: 0.8,
    roughness: 0.2,
});
const ring = new THREE.Mesh(geometry, material);
scene.add(ring);

// Add an inner sphere (like a pearl or inner core)
const coreGeo = new THREE.SphereGeometry(0.6, 32, 32);
const coreMat = new THREE.MeshStandardMaterial({
    color: 0xefe3c6, // paper
    metalness: 0.1,
    roughness: 0.9,
});
const core = new THREE.Mesh(coreGeo, coreMat);
scene.add(core);

// Animation loop
let mouseX = 0;
let mouseY = 0;
let targetX = 0;
let targetY = 0;

const windowHalfX = container.clientWidth / 2;
const windowHalfY = container.clientHeight / 2;

container.addEventListener('mousemove', (event) => {
    const rect = container.getBoundingClientRect();
    mouseX = (event.clientX - rect.left) - windowHalfX;
    mouseY = (event.clientY - rect.top) - windowHalfY;
});

function animate() {
    requestAnimationFrame(animate);

    targetX = mouseX * 0.001;
    targetY = mouseY * 0.001;
    
    // Slow rotation
    ring.rotation.y += 0.005;
    ring.rotation.x += 0.002;
    
    core.rotation.y -= 0.005;
    
    // Mouse interaction tilt
    ring.rotation.y += 0.05 * (targetX - ring.rotation.y);
    ring.rotation.x += 0.05 * (targetY - ring.rotation.x);

    renderer.render(scene, camera);
}

animate();

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});
