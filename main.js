import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { STLLoader } from "./vendor/STLLoader.js";
import { OBJLoader } from "./vendor/OBJLoader.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";

const state = {
  items: [],
  activeId: null,
  spin: true,
  xray: false,
  staticHosted: !["localhost", "127.0.0.1", ""].includes(window.location.hostname),
  uploadQueue: 0,
  objectUrls: new Set()
};

const dom = {
  canvas: document.querySelector("#main-canvas"),
  grid: document.querySelector("#model-grid"),
  template: document.querySelector("#model-card-template"),
  title: document.querySelector("#selected-title"),
  meta: document.querySelector("#selected-meta"),
  count: document.querySelector("#library-count"),
  status: document.querySelector("#status-line"),
  dropZone: document.querySelector("#drop-zone"),
  fileInput: document.querySelector("#file-input"),
  toggleSpin: document.querySelector("#toggle-spin"),
  toggleCamera: document.querySelector("#toggle-camera"),
  resetCamera: document.querySelector("#reset-camera"),
  openStatic: document.querySelector("#open-static")
};

lucide.createIcons({ icons: lucide.icons });

if (state.staticHosted) {
  dom.fileInput.disabled = true;
  dom.fileInput.closest(".file-pick").hidden = true;
}

class SpinViewer {
  constructor(canvas, { thumbnail = false } = {}) {
    this.canvas = canvas;
    this.thumbnail = thumbnail;
    this.scene = new THREE.Scene();
    this.cameraMode = "perspective";
    this.camera = this.createCamera();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: !thumbnail
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, thumbnail ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.previousTime = performance.now();
    this.frame = null;
    this.lastBox = null;
    this.lastPixelSample = 0;

    const ambient = new THREE.HemisphereLight(0xffffff, 0x7f827a, 2.8);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    const rim = new THREE.DirectionalLight(0x86fff0, 1.2);
    key.position.set(5, 7, 6);
    rim.position.set(-6, 3, -5);
    this.scene.add(ambient, key, rim);

    if (!thumbnail) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.autoRotate = false;
      this.controls.enablePan = false;
      this.canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        setStatus("WebGL context was reset. Reloading the viewer...");
        window.setTimeout(() => window.location.reload(), 250);
      });
    }

    this.resize();
    this.animate();
  }

  createCamera() {
    return new THREE.PerspectiveCamera(this.thumbnail ? 32 : 34, 1, 0.01, 100000);
  }

  setXray(enabled) {
    this.root.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!material.userData.solidState) {
          material.userData.solidState = {
            transparent: material.transparent,
            opacity: material.opacity,
            depthWrite: material.depthWrite,
            side: material.side
          };
        }
        if (enabled) {
          material.transparent = true;
          material.opacity = 0.28;
          material.depthWrite = false;
          material.side = THREE.DoubleSide;
        } else {
          const solid = material.userData.solidState;
          material.transparent = solid.transparent;
          material.opacity = solid.opacity;
          material.depthWrite = solid.depthWrite;
          material.side = solid.side;
        }
        material.needsUpdate = true;
      });
    });
  }

  disposeObject(object) {
    object.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  clear() {
    while (this.root.children.length) {
      const child = this.root.children.pop();
      this.disposeObject(child);
    }
  }

  async load(item) {
    this.clear();
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    const object = await loadModel(item);
    prepareObject(object);
    const box = new THREE.Box3().setFromObject(object);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
    }
    this.root.add(object);
    this.setXray(state.xray);
    this.fit();
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    this.root.position.set(0, 0, 0);
    this.lastBox = box;

    const distance =
      maxDim * (this.thumbnail ? 2.45 : 2.75) * Math.max(1, 1 / this.camera.aspect);
    this.camera.position.set(distance * 0.82, distance * 0.54, distance * 0.92);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || this.canvas.clientWidth || 320);
    const height = Math.max(1, rect.height || this.canvas.clientHeight || 240);

    if (this.canvas.width !== Math.floor(width * this.renderer.getPixelRatio())) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min((now - this.previousTime) / 1000, 0.05);
    this.previousTime = now;
    if (this.thumbnail || state.spin) {
      this.root.rotation.y += delta * (this.thumbnail ? 0.64 : 0.42);
    }
    if (!this.thumbnail) {
      this.controls?.update();
    }
    this.resize();
    this.renderer.render(this.scene, this.camera);
    if (!this.thumbnail) {
      this.samplePixels(now);
    }
  };

  samplePixels(now) {
    if (now - this.lastPixelSample < 700) return;
    this.lastPixelSample = now;

    try {
      const gl = this.renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const sample = new Uint8Array(4);
      const points = [];
      for (let y = 0.18; y <= 0.82; y += 0.08) {
        for (let x = 0.18; x <= 0.82; x += 0.08) {
          points.push([x, y]);
        }
      }
      const colors = [];

      for (const [px, py] of points) {
        gl.readPixels(
          Math.floor(width * px),
          Math.floor(height * py),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sample
        );
        colors.push(Array.from(sample));
      }

      const unique = new Set(colors.map((color) => color.join(","))).size;
      const nonTransparent = colors.filter((color) => color[3] > 0).length;
      window.__galleryPixelStats = {
        ok: unique > 1 && nonTransparent > 0,
        width,
        height,
        unique,
        nonTransparent,
        colors
      };
      this.canvas.dataset.pixelStats = JSON.stringify(window.__galleryPixelStats);
    } catch (error) {
      window.__galleryPixelStats = {
        ok: false,
        error: error.message
      };
      this.canvas.dataset.pixelStats = JSON.stringify(window.__galleryPixelStats);
    }
  }
}

async function loadModel(item) {
  const assetType = (item.assetType || item.asset.split(".").pop()).toLowerCase();
  const assetUrl = encodeURI(item.asset);

  if (assetType === "stl") {
    const geometry = await new STLLoader().loadAsync(assetUrl);
    const material = new THREE.MeshStandardMaterial({
      color: pickColor(item.id),
      roughness: 0.46,
      metalness: 0.18
    });
    return new THREE.Mesh(geometry, material);
  }

  if (assetType === "obj") {
    return await new OBJLoader().loadAsync(assetUrl);
  }

  if (assetType === "glb" || assetType === "gltf") {
    const gltf = await new GLTFLoader().loadAsync(assetUrl);
    return gltf.scene;
  }

  throw new Error(`Unsupported asset type: ${assetType}`);
}

function prepareObject(object) {
  object.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (!node.material || node.material.type === "MeshBasicMaterial") {
        node.material = new THREE.MeshStandardMaterial({
          color: 0x789089,
          roughness: 0.5,
          metalness: 0.12
        });
      }
      if (node.geometry && !node.geometry.attributes.normal) {
        node.geometry.computeVertexNormals();
      }
    }
  });
}

function pickColor(id = "") {
  const palette = [0x196f63, 0xd74928, 0x415563, 0xa9832f, 0x557e37, 0x8d4d3e, 0x2f6f9f];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

const mainViewer = new SpinViewer(dom.canvas);
function setStatus(message) {
  dom.status.textContent = message;
}

function formatSize(bytes = 0) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function itemSubtitle(item) {
  const parts = [];
  if (item.moduleCount) parts.push(`${item.moduleCount} modules`);
  if (item.assetType) parts.push(item.assetType.toUpperCase());
  if (item.sizeBytes) parts.push(formatSize(item.sizeBytes));
  if (item.status !== "ready") parts.push(item.status);
  return parts.filter(Boolean).join(" · ");
}

function renderList() {
  dom.grid.replaceChildren();
  dom.count.textContent = `${state.items.length} models`;

  state.items.forEach((item) => {
    const node = dom.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.classList.toggle("active", item.id === state.activeId);
    node.querySelector("strong").textContent = item.title;
    node.querySelector("small").textContent = itemSubtitle(item);
    const deleteButton = node.querySelector(".card-delete");
    node.classList.toggle("can-delete", !state.staticHosted);
    deleteButton.hidden = state.staticHosted;
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteItem(item.id);
    });
    deleteButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      deleteItem(item.id);
    });
    node.querySelector(".card-thumb").textContent = item.title
      .split(/[_\s-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("");
    node.addEventListener("click", () => selectItem(item.id));
    dom.grid.append(node);
  });
  lucide.createIcons({ icons: lucide.icons });
}

function renderDetails(item) {
  dom.title.textContent = item?.title || "No model selected";
  dom.meta.replaceChildren();
  if (!item) return;

  [
    item.assetType ? item.assetType.toUpperCase() : null,
    item.moduleCount ? `${item.moduleCount} modules` : null,
    item.sizeBytes ? formatSize(item.sizeBytes) : null,
    item.status
  ]
    .filter(Boolean)
    .forEach((value) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = value;
      dom.meta.append(pill);
    });
}

async function selectItem(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;

  state.activeId = id;
  document.querySelectorAll(".model-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.id === id);
  });
  renderDetails(item);

  if (item.status !== "ready") {
    setStatus(`${item.title} is not ready yet: ${item.status}`);
    return;
  }

  try {
    setStatus(`Loading ${item.title}...`);
    await mainViewer.load(item);
    setStatus(`Showing ${item.title}`);
  } catch (error) {
    setStatus(`Could not load ${item.title}: ${error.message}`);
  }
}

async function deleteItem(id) {
  if (state.staticHosted) {
    setStatus("Published gallery is view-only.");
    return;
  }

  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;

  const confirmed = window.confirm(`Delete ${item.title}?`);
  if (!confirmed) return;

  try {
    setStatus(`Deleting ${item.title}...`);
    const response = await fetch(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Delete failed");

    state.items = state.items.filter((candidate) => candidate.id !== id);
    if (state.activeId === id) {
      state.activeId = state.items.find((candidate) => candidate.status === "ready")?.id || state.items[0]?.id || null;
      mainViewer.clear();
      if (state.activeId) {
        renderList();
        await selectItem(state.activeId);
      } else {
        renderList();
        renderDetails(null);
        setStatus("No model selected");
      }
      return;
    }

    renderList();
    setStatus(`Deleted ${item.title}`);
  } catch (error) {
    setStatus(`Could not delete ${item.title}: ${error.message}`);
  }
}

async function loadManifest() {
  const response = await fetch("./manifest.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("manifest.json not found");
  const manifest = await response.json();
  const baseItems = manifest.items || [];
  let hiddenIds = new Set();

  try {
    const stateResponse = await fetch("./uploads/library-state.json", { cache: "no-cache" });
    if (stateResponse.ok) {
      const libraryState = await stateResponse.json();
      hiddenIds = new Set(libraryState.hiddenIds || []);
    }
  } catch {
    hiddenIds = new Set();
  }

  try {
    const uploadsResponse = await fetch("./uploads/manifest.json", { cache: "no-cache" });
    if (!uploadsResponse.ok) return baseItems.filter((item) => !hiddenIds.has(item.id));
    const uploads = await uploadsResponse.json();
    return dedupeItems([...(uploads.items || []), ...baseItems.filter((item) => !hiddenIds.has(item.id))]);
  } catch {
    return dedupeItems(baseItems.filter((item) => !hiddenIds.has(item.id)));
  }
}

function dedupeItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeTitle(item.title || item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeTitle(value = "") {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[_\s-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uploadFiles(files) {
  if (state.staticHosted) {
    setStatus("Published gallery is view-only. Use the local app to add models.");
    return;
  }

  const accepted = Array.from(files).filter(Boolean);
  if (!accepted.length) return;

  state.uploadQueue += accepted.length;
  setStatus(`Importing ${accepted.length} model file${accepted.length > 1 ? "s" : ""}...`);

  for (const file of accepted) {
    const ext = file.name.split(".").pop().toLowerCase();

    if (["stl", "obj", "glb", "gltf"].includes(ext)) {
      const objectUrl = URL.createObjectURL(file);
      state.objectUrls.add(objectUrl);
      const payload = {
        id: `${Date.now()}-${file.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
        title: file.name.replace(/\.[^.]+$/, ""),
        asset: objectUrl,
        assetType: ext,
        status: "ready",
        moduleCount: null,
        sizeBytes: file.size
      };
      state.items.unshift(payload);
      state.activeId = payload.id;
      state.uploadQueue -= 1;
      continue;
    }

    const body = new FormData();
    body.append("model", file);

    try {
      setStatus(`Converting ${file.name} with FreeCAD...`);
      const response = await fetch("/api/upload", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      payload.moduleCount = null;
      payload.sizeBytes = payload.sizeBytes || file.size;
      state.items.unshift(payload);
      state.activeId = payload.id;
      setStatus(`Imported ${payload.title}`);
    } catch (error) {
      setStatus(`Import failed for ${file.name}: ${error.message}`);
    } finally {
      state.uploadQueue -= 1;
    }
  }

  renderList();
  if (state.activeId) await selectItem(state.activeId);
}

dom.fileInput.addEventListener("change", (event) => {
  uploadFiles(event.target.files);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("drop-active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dom.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "drop") uploadFiles(event.dataTransfer.files);
    dom.dropZone.classList.remove("drop-active");
  });
});

dom.toggleSpin.addEventListener("click", () => {
  state.spin = !state.spin;
  dom.toggleSpin.title = state.spin ? "Pause rotation" : "Resume rotation";
  dom.toggleSpin.ariaLabel = state.spin ? "Pause rotation" : "Resume rotation";
  dom.toggleSpin.innerHTML = state.spin
    ? '<i data-lucide="pause"></i>'
    : '<i data-lucide="play"></i>';
  lucide.createIcons({ icons: lucide.icons });
});

dom.resetCamera.addEventListener("click", () => {
  mainViewer.fit();
});

dom.toggleCamera.addEventListener("click", () => {
  state.xray = !state.xray;
  mainViewer.setXray(state.xray);
  dom.toggleCamera.title = state.xray ? "Switch to solid view" : "Switch to X-ray view";
  dom.toggleCamera.ariaLabel = dom.toggleCamera.title;
  dom.toggleCamera.innerHTML = state.xray
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  setStatus(state.xray ? "X-ray transparent view" : "Solid view");
  lucide.createIcons({ icons: lucide.icons });
});

dom.openStatic.addEventListener("click", () => {
  window.open("./manifest.json", "_blank", "noopener");
});

window.addEventListener("resize", () => {
  mainViewer.resize();
});

loadManifest()
  .then((items) => {
    state.items = items;
    state.activeId = items.find((item) => item.status === "ready")?.id || items[0]?.id || null;
    renderList();
    if (state.activeId) selectItem(state.activeId);
  })
  .catch((error) => {
    setStatus(`No generated assets yet: ${error.message}`);
    renderList();
  });
