import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

const DEPTH_SCALE = 700;
const SPHERE_SEGMENTS = 16;
const STROKE_SEGMENTS = 16;

export function createThreeContactRenderer({ stage, video, radiusForPoint }) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
  const root = new THREE.Group();
  const materials = {
    green: new THREE.MeshBasicMaterial({ color: 0x26d96c, depthTest: true }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: true }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true }),
  };

  renderer.domElement.className = "three-overlay";
  renderer.domElement.hidden = true;
  renderer.setClearColor(0x000000, 0);
  scene.add(root);
  stage.append(renderer.domElement);

  return {
    setEnabled(enabled) {
      renderer.domElement.hidden = !enabled;
      if (!enabled) clearGroup(root);
    },

    render(state) {
      resize();
      clearGroup(root);

      for (const segment of state.segments) {
        addStroke(segment.initial, segment.final);
      }

      if (state.initial && state.live) {
        addStroke(state.initial, state.live);
      }

      for (const segment of state.segments) {
        addPoint(segment.initial, materials.green);
        addPoint(segment.final, materials.red);
      }

      if (state.initial) addPoint(state.initial, materials.green);
      if (state.final) addPoint(state.final, materials.red);
      if (state.live) addPoint(state.live, materials.white);

      renderer.render(scene, camera);
    },

    dispose() {
      clearGroup(root);
      for (const material of Object.values(materials)) {
        material.dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  function resize() {
    const width = video.videoWidth || stage.clientWidth;
    const height = video.videoHeight || stage.clientHeight;

    if (renderer.domElement.width !== width || renderer.domElement.height !== height) {
      renderer.setSize(width, height, false);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.position.set(0, 0, 1000);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }
  }

  function addPoint(point, material) {
    const radius = radiusForPoint(point);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS),
      material
    );

    mesh.position.copy(toScenePoint(point));
    root.add(mesh);
  }

  function addStroke(start, end) {
    const startPoint = toScenePoint(start);
    const endPoint = toScenePoint(end);
    const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
    const length = direction.length();

    if (length < 0.001) return;

    const geometry = new THREE.CylinderGeometry(
      radiusForPoint(end),
      radiusForPoint(start),
      length,
      STROKE_SEGMENTS,
      1
    );
    const mesh = new THREE.Mesh(geometry, materials.white);
    const midpoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);

    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    root.add(mesh);
  }

  function toScenePoint(point) {
    const width = renderer.domElement.width || stage.clientWidth;
    const height = renderer.domElement.height || stage.clientHeight;

    return new THREE.Vector3(
      (point.x - 0.5) * width,
      (0.5 - point.y) * height,
      -(point.z ?? 0) * DEPTH_SCALE
    );
  }
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
  }
}
