import { clamp, clamp01, mulberry32 } from "./utils.js";
import { Mesh } from "./mesh.js";
import { Sim } from "./sim.js";
import { Render, renderScalarField } from "./render.js";

const app = {
  subdivisions: 4,
  running: true,
  speed: 4.0,
  rotationSpeed: 0.004,
  rotationLonDeg: 0,
  rotationLatDeg: 12,
  topology: "grid",
  seed: 1,
  mode: "composite",
  drawGrid: false,
  phase: 0.75,
  params: {
    dt: 0.5,
    diffusion: 0.07,
    sigma_slow: 0.76,
    evaporation: 0.013,
    info_gain: 0.84,
    info_threshold: 0.12,
    info_decay: 0.005,
    info_cost: 0.01,
    info_energy_cost: 0.9,
    sigma_on: 0.69,
    sigma_off: 0.36,
    collapse_I: 1.05,
    collapse_fraction: 0.57,
    jitter: 0.42,
    sun_strength: 0.16,
    sun_width: 0.13,
    sun_speed: 0.006,
    sun_lat_bias: 0.45,
    sun_lon_wobble: 0.04,
    noise_floor: 0,
  },
};

const presets = {
  "Test A": {
    diffusion: 0.14,
    sigma_slow: 0.42,
    evaporation: 0.008,
    info_gain: 0.75,
    info_threshold: 0.045,
    info_decay: 0.005,
    info_cost: 0.022,
    info_energy_cost: 1.15,
    sigma_on: 0.7,
    sigma_off: 0.34,
    collapse_I: 0.56,
    collapse_fraction: 0.57,
    jitter: 0.42,
    sun_strength: 0.19,
    sun_width: 0.37,
    sun_speed: 0.025,
    sun_lat_bias: 0.45,
    sun_lon_wobble: 0.39,
    noise_floor: 0.003,
  },
  "Test B": {
    diffusion: 0.16,
    sigma_slow: 0.17,
    evaporation: 0.011,
    info_gain: 0.35,
    info_threshold: 0.075,
    info_decay: 0.016,
    info_cost: 0.022,
    info_energy_cost: 0.6,
    sigma_on: 0.7,
    sigma_off: 0.34,
    collapse_I: 0.8,
    collapse_fraction: 0.45,
    jitter: 0.8,
    sun_strength: 0.12,
    sun_width: 0.37,
    sun_speed: 0.025,
    sun_lat_bias: 0.45,
    sun_lon_wobble: 0.39,
    noise_floor: 0.0085,
  },
  "Test C": {
    diffusion: 0.16,
    sigma_slow: 0.17,
    evaporation: 0.011,
    info_gain: 0.35,
    info_threshold: 0.075,
    info_decay: 0.016,
    info_cost: 0.022,
    info_energy_cost: 0.6,
    sigma_on: 0.7,
    sigma_off: 0.34,
    collapse_I: 0.8,
    collapse_fraction: 0.45,
    jitter: 0.8,
    sun_strength: 0.12,
    sun_width: 0.37,
    sun_speed: 0.025,
    sun_lat_bias: 0.45,
    sun_lon_wobble: 0.39,
    noise_floor: 0.0085,
  },
};

const sliderRegistry = {};

function createSlider(container, config, handler) {
  const wrapper = document.createElement("div");
  wrapper.className = "slider";
  const label = document.createElement("label");
  const name = document.createElement("span");
  name.textContent = config.label;
  const value = document.createElement("span");
  value.className = "value";
  label.appendChild(name);
  label.appendChild(value);
  const input = document.createElement("input");
  input.type = "range";
  input.min = config.min;
  input.max = config.max;
  input.step = config.step;
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  container.appendChild(wrapper);
  sliderRegistry[config.key] = { input, value, format: config.format, handler };
  input.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    handler(v);
    value.textContent = config.format ? config.format(v) : v.toFixed(3);
  });
}

function refreshSliders() {
  Object.keys(sliderRegistry).forEach((key) => {
    const entry = sliderRegistry[key];
    let val = app[key];
    if (val === undefined) val = app.params[key];
    if (val === undefined) return;
    entry.input.value = val;
    entry.value.textContent = entry.format ? entry.format(val) : val.toFixed(3);
  });
}

function applyPhase() {
  const p = app.phase;
  app.params.diffusion = clamp(0.08 + 0.08 * p, 0.04, 0.2);
  app.params.sigma_slow = clamp(0.5 - 0.17 * p, 0.15, 0.6);
  app.params.info_threshold = clamp(0.09 - 0.06 * p, 0.02, 0.12);
  app.params.info_decay = clamp(0.015 - 0.012 * p, 0.0, 0.03);
  app.params.collapse_I = clamp(1.8 - 0.48 * p, 0.6, 1.8);
  app.params.sun_strength = clamp(0.08 + 0.106 * p, 0.05, 0.2);
  app.params.info_energy_cost = clamp(1.9 - 1.8 * p, 0.5, 2.0);
  app.params.noise_floor = p > 0.85 ? (0.001 * (p - 0.85)) / 0.15 : 0;
}

const canvas = document.getElementById("simCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
let mesh = Mesh.createHexSphere(app.subdivisions);
let lats = [];
let lons = [];
let rotation = (app.rotationLonDeg * Math.PI) / 180;
let rotationLat = (app.rotationLatDeg * Math.PI) / 180;
let isDragging = false;
let lastDrag = { x: 0, y: 0 };

canvas.addEventListener("pointerdown", (e) => {
  isDragging = true;
  lastDrag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastDrag.x;
  const dy = e.clientY - lastDrag.y;
  lastDrag = { x: e.clientX, y: e.clientY };
  app.rotationLonDeg += dx * 0.45;
  app.rotationLatDeg = clamp(app.rotationLatDeg - dy * 0.45, -80, 80);
});

canvas.addEventListener("pointerup", (e) => {
  isDragging = false;
  canvas.releasePointerCapture(e.pointerId);
});

canvas.addEventListener("pointerleave", () => {
  isDragging = false;
});

let sim = Sim.makeInitialState(mesh.vertices.length, app.seed, mulberry32);
let rng = mulberry32(app.seed);


function updateDerived() {
  if (app.topology === "torus") {
    const segU = clamp(24 + app.subdivisions * 10, 16, 120);
    const segV = clamp(16 + app.subdivisions * 8, 12, 96);
    mesh = Mesh.createTorus(segU, segV, 1.1, 0.45);
    mesh.type = "torus";
    lats = mesh.lats;
    lons = mesh.lons;
  } else if (app.topology === "hex") {
    mesh = Mesh.createHexSphere(app.subdivisions);
    mesh.type = "hex";
    lats = new Array(mesh.vertices.length);
    lons = new Array(mesh.vertices.length);
    for (let i = 0; i < mesh.vertices.length; i++) {
      const ll = Mesh.toLonLat(mesh.vertices[i]);
      lons[i] = ll[0];
      lats[i] = ll[1];
    }
  } else if (app.topology === "fibonacci") {
    const count = clamp(800 + app.subdivisions * 1600, 600, 5000);
    mesh = Mesh.createFibonacciSphere(count);
    lats = mesh.lats;
    lons = mesh.lons;
  } else if (app.topology === "grid") {
    const H = clamp(48 + app.subdivisions * 16, 48, 192);
    const W = clamp(96 + app.subdivisions * 32, 96, 384);
    mesh = Mesh.createLatLonGrid(H, W);
    lats = mesh.lats;
    lons = mesh.lons;
  } else {
    mesh = Mesh.createIcosphere(app.subdivisions);
    mesh.type = "sphere";
    lats = new Array(mesh.vertices.length);
    lons = new Array(mesh.vertices.length);
    for (let i = 0; i < mesh.vertices.length; i++) {
      const ll = Mesh.toLonLat(mesh.vertices[i]);
      lons[i] = ll[0];
      lats[i] = ll[1];
    }
  }

  if (mesh.type === "grid") {
    document.getElementById("gridPill").textContent = "grid: " + mesh.grid.H + "x" + mesh.grid.W;
  } else if (mesh.type === "points") {
    document.getElementById("gridPill").textContent = "pixels: " + mesh.vertices.length;
  } else {
    document.getElementById("gridPill").textContent = "verts: " + mesh.vertices.length;
  }

  const n = mesh.vertices.length;
  sim = Sim.makeInitialState(n, app.seed, mulberry32);
  rng = mulberry32(app.seed);
}

function updateCanvasSize() {
  canvas.width = 960;
  canvas.height = 480;
}

function resetSim() {
  sim = Sim.makeInitialState(mesh.vertices.length, app.seed, mulberry32);
  rng = mulberry32(app.seed);
}

function setGridToggle() {
  const toggle = document.getElementById("gridToggle");
  toggle.classList.toggle("on", app.drawGrid);
  document.getElementById("gridState").textContent = app.drawGrid ? "ON" : "OFF";
}

const topologyValue = document.querySelector('[data-key="topology"] .value');

function setMode(mode) {
  app.mode = mode;
  document.querySelectorAll("#modeButtons .btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  Object.assign(app.params, preset);
  refreshSliders();
}

document.getElementById("runBtn").addEventListener("click", () => {
  app.running = !app.running;
  document.getElementById("runBtn").textContent = app.running ? "Pause" : "Play";
});

document.getElementById("stepBtn").addEventListener("click", () => {
  if (app.running) return;
  Sim.stepSim(sim, app.params, mesh.neighborList, rng, lats, lons);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  resetSim();
});

document.getElementById("seedBtn").addEventListener("click", () => {
  app.seed = (app.seed + 1) % 100000;
  resetSim();
});

document.getElementById("gridToggle").addEventListener("click", () => {
  app.drawGrid = !app.drawGrid;
  setGridToggle();
});

document.getElementById("resUp").addEventListener("click", () => {
  app.subdivisions = clamp(app.subdivisions + 1, 1, 7);
  updateDerived();
});

document.getElementById("resDown").addEventListener("click", () => {
  app.subdivisions = clamp(app.subdivisions - 1, 1, 7);
  updateDerived();
});

document.querySelectorAll("[data-topology]").forEach((btn) => {
  btn.addEventListener("click", () => {
    app.topology = btn.dataset.topology;
    document.querySelectorAll("[data-topology]").forEach((b) => {
      b.classList.toggle("active", b.dataset.topology === app.topology);
    });
    topologyValue.textContent = app.topology;
    updateDerived();
  });
});

["composite", "energy", "info", "sigma", "sun"].forEach((mode) => {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.dataset.mode = mode;
  btn.textContent = mode === "composite" ? "Composite" : mode.charAt(0).toUpperCase() + mode.slice(1);
  btn.addEventListener("click", () => setMode(mode));
  document.getElementById("modeButtons").appendChild(btn);
});

Object.keys(presets).forEach((name) => {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = name;
  btn.addEventListener("click", () => applyPreset(name));
  document.getElementById("presetButtons").appendChild(btn);
});

createSlider(
  document.getElementById("energySliders"),
  {
    label: "Diffusion",
    key: "diffusion",
    min: 0.02,
    max: 0.25,
    step: 0.01,
    format: (v) => v.toFixed(2),
  },
  (v) => {
    app.params.diffusion = v;
  }
);

createSlider(
  document.getElementById("energySliders"),
  {
    label: "Sigma slows flow (S=1 -> multiplier)",
    key: "sigma_slow",
    min: 0.05,
    max: 1.0,
    step: 0.01,
    format: (v) => v.toFixed(2),
  },
  (v) => {
    app.params.sigma_slow = v;
  }
);

createSlider(
  document.getElementById("energySliders"),
  {
    label: "Evaporation",
    key: "evaporation",
    min: 0.0,
    max: 0.02,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  (v) => {
    app.params.evaporation = v;
  }
);

createSlider(
  document.getElementById("infoSliders"),
  {
    label: "Flux to I gain",
    key: "info_gain",
    min: 0.1,
    max: 1.2,
    step: 0.01,
  },
  (v) => {
    app.params.info_gain = v;
  }
);

createSlider(
  document.getElementById("infoSliders"),
  {
    label: "Flux threshold",
    key: "info_threshold",
    min: 0.02,
    max: 0.2,
    step: 0.005,
    format: (v) => v.toFixed(3),
  },
  (v) => {
    app.params.info_threshold = v;
  }
);

createSlider(
  document.getElementById("infoSliders"),
  {
    label: "I decay",
    key: "info_decay",
    min: 0.0,
    max: 0.08,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  (v) => {
    app.params.info_decay = v;
  }
);

createSlider(
  document.getElementById("infoSliders"),
  {
    label: "I maintenance cost (drains E)",
    key: "info_cost",
    min: 0.0,
    max: 0.05,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  (v) => {
    app.params.info_cost = v;
  }
);

createSlider(
  document.getElementById("infoSliders"),
  {
    label: "Info energy cost (E per I)",
    key: "info_energy_cost",
    min: 0.5,
    max: 2.5,
    step: 0.05,
    format: (v) => v.toFixed(2),
  },
  (v) => {
    app.params.info_energy_cost = v;
  }
);

createSlider(
  document.getElementById("sigmaSliders"),
  {
    label: "Sigma ON threshold",
    key: "sigma_on",
    min: 0.05,
    max: 0.8,
    step: 0.01,
  },
  (v) => {
    app.params.sigma_on = v;
    app.params.sigma_off = Math.min(app.params.sigma_off, v - 0.01);
    refreshSliders();
  }
);

createSlider(
  document.getElementById("sigmaSliders"),
  {
    label: "Sigma OFF threshold",
    key: "sigma_off",
    min: 0.0,
    max: 0.7,
    step: 0.01,
  },
  (v) => {
    app.params.sigma_off = Math.min(v, app.params.sigma_on - 0.01);
    refreshSliders();
  }
);

createSlider(
  document.getElementById("collapseSliders"),
  {
    label: "Collapse I threshold",
    key: "collapse_I",
    min: 0.4,
    max: 1.5,
    step: 0.01,
  },
  (v) => {
    app.params.collapse_I = v;
  }
);

createSlider(
  document.getElementById("collapseSliders"),
  {
    label: "Release fraction",
    key: "collapse_fraction",
    min: 0.1,
    max: 1.0,
    step: 0.01,
  },
  (v) => {
    app.params.collapse_fraction = v;
  }
);

createSlider(
  document.getElementById("collapseSliders"),
  {
    label: "Jitter",
    key: "jitter",
    min: 0.0,
    max: 0.8,
    step: 0.01,
  },
  (v) => {
    app.params.jitter = v;
  }
);

createSlider(
  document.getElementById("sunSliders"),
  {
    label: "Sun strength",
    key: "sun_strength",
    min: 0.02,
    max: 0.2,
    step: 0.005,
  },
  (v) => {
    app.params.sun_strength = v;
  }
);

createSlider(
  document.getElementById("sunSliders"),
  {
    label: "Sun band width",
    key: "sun_width",
    min: 0.08,
    max: 0.6,
    step: 0.01,
  },
  (v) => {
    app.params.sun_width = v;
  }
);

createSlider(
  document.getElementById("sunSliders"),
  {
    label: "Sun speed",
    key: "sun_speed",
    min: 0.002,
    max: 0.05,
    step: 0.001,
    format: (v) => v.toFixed(3),
  },
  (v) => {
    app.params.sun_speed = v;
  }
);

createSlider(
  document.getElementById("sunSliders"),
  {
    label: "Longitude wobble",
    key: "sun_lon_wobble",
    min: 0.0,
    max: 0.5,
    step: 0.01,
  },
  (v) => {
    app.params.sun_lon_wobble = v;
  }
);

createSlider(
  document.getElementById("noiseSliders"),
  {
    label: "Background noise floor",
    key: "noise_floor",
    min: 0.0,
    max: 0.01,
    step: 0.0005,
    format: (v) => v.toFixed(4),
  },
  (v) => {
    app.params.noise_floor = v;
  }
);

const speedSlider = document.querySelector('[data-key="speed"] input');
const speedValue = document.querySelector('[data-key="speed"] .value');
speedSlider.value = app.speed;
speedValue.textContent = app.speed.toFixed(1) + "x";
speedSlider.addEventListener("input", (e) => {
  app.speed = parseFloat(e.target.value);
  speedValue.textContent = app.speed.toFixed(1) + "x";
});

const rotationSlider = document.querySelector('[data-key="rotation"] input');
const rotationValue = document.querySelector('[data-key="rotation"] .value');
rotationSlider.value = app.rotationSpeed;
rotationValue.textContent = app.rotationSpeed.toFixed(3);
rotationSlider.addEventListener("input", (e) => {
  app.rotationSpeed = parseFloat(e.target.value);
  rotationValue.textContent = app.rotationSpeed.toFixed(3);
});

const rotationLonSlider = document.querySelector('[data-key="rotationLon"] input');
const rotationLonValue = document.querySelector('[data-key="rotationLon"] .value');
rotationLonSlider.value = app.rotationLonDeg;
rotationLonValue.textContent = "manual";
rotationLonSlider.addEventListener("input", (e) => {
  app.rotationLonDeg = parseFloat(e.target.value);
});

const rotationLatSlider = document.querySelector('[data-key="rotationLat"] input');
const rotationLatValue = document.querySelector('[data-key="rotationLat"] .value');
rotationLatSlider.value = app.rotationLatDeg;
rotationLatValue.textContent = Math.round(app.rotationLatDeg) + "°";
rotationLatSlider.addEventListener("input", (e) => {
  app.rotationLatDeg = parseFloat(e.target.value);
  rotationLatValue.textContent = Math.round(app.rotationLatDeg) + "°";
});

topologyValue.textContent = app.topology;
document.querySelectorAll("[data-topology]").forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.topology === app.topology);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") app.rotationLonDeg -= 3;
  if (e.key === "ArrowRight") app.rotationLonDeg += 3;
  if (e.key === "ArrowUp") app.rotationLatDeg = clamp(app.rotationLatDeg + 3, -80, 80);
  if (e.key === "ArrowDown") app.rotationLatDeg = clamp(app.rotationLatDeg - 3, -80, 80);
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    rotationLatSlider.value = app.rotationLatDeg;
    rotationLatValue.textContent = Math.round(app.rotationLatDeg) + "°";
  }
});

const phaseSlider = document.querySelector('[data-key="phase"] input');
const phaseValue = document.querySelector('[data-key="phase"] .value');
phaseSlider.value = app.phase;
phaseValue.textContent = app.phase.toFixed(2);
phaseSlider.addEventListener("input", (e) => {
  app.phase = parseFloat(e.target.value);
  phaseValue.textContent = app.phase.toFixed(2);
  applyPhase();
  refreshSliders();
});

updateCanvasSize();
updateDerived();
setMode(app.mode);
setGridToggle();
refreshSliders();

let last = performance.now();
let frameCounter = 0;
let cachedMetrics = { moranI: 0, meanCluster: 0, maxCluster: 0 };

function computeStructureMetrics(values, neighbors, threshold) {
  const n = values.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;

  let denom = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    denom += d * d;
  }

  let numer = 0;
  let W = 0;
  for (let i = 0; i < n; i++) {
    const di = values[i] - mean;
    const nb = neighbors[i];
    W += nb.length;
    for (let k = 0; k < nb.length; k++) {
      const j = nb[k];
      numer += di * (values[j] - mean);
    }
  }
  const moranI = denom > 0 && W > 0 ? (n / W) * (numer / denom) : 0;

  const visited = new Uint8Array(n);
  let clusterCount = 0;
  let clusterSum = 0;
  let maxCluster = 0;

  for (let i = 0; i < n; i++) {
    if (visited[i] || values[i] < threshold) continue;
    let size = 0;
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const cur = stack.pop();
      size += 1;
      const nb = neighbors[cur];
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        if (visited[j] || values[j] < threshold) continue;
        visited[j] = 1;
        stack.push(j);
      }
    }
    clusterCount += 1;
    clusterSum += size;
    if (size > maxCluster) maxCluster = size;
  }
  const meanCluster = clusterCount ? clusterSum / clusterCount : 0;
  return { moranI, meanCluster, maxCluster };
}

function tick(now) {
  const dtMs = now - last;
  last = now;
  if (app.running) {
    const frameSteps = clamp(Math.floor((dtMs / 16.67) * app.speed), 1, 10);
    for (let k = 0; k < frameSteps; k++) Sim.stepSim(sim, app.params, mesh.neighborList, rng, lats, lons);
  }
  if (!isDragging && app.rotationSpeed !== 0) {
    app.rotationLonDeg += (app.rotationSpeed * 180) / Math.PI;
  }
  if (app.rotationLonDeg > 180) app.rotationLonDeg -= 360;
  if (app.rotationLonDeg < -180) app.rotationLonDeg += 360;
  rotation = (app.rotationLonDeg * Math.PI) / 180;
  rotationLat = (app.rotationLatDeg * Math.PI) / 180;
  if (app.mode === "sun") {
    renderScalarField(ctx, sim.injected, mesh, app.drawGrid, canvas.width, canvas.height, rotation, rotationLat);
  } else {
    Render.renderToCanvas(ctx, sim, mesh, app.mode, app.drawGrid, canvas.width, canvas.height, rotation, rotationLat);
  }

  rotationLatSlider.value = app.rotationLatDeg;
  rotationLatValue.textContent = Math.round(app.rotationLatDeg) + "°";

  let sumE = 0;
  let sumI = 0;
  let sumS = 0;
  const n = sim.E.length;
  for (let i = 0; i < n; i++) {
    sumE += sim.E[i];
    sumI += sim.I[i];
    sumS += clamp01(sim.S[i]);
  }
  const meanE = sumE / n;
  const meanI = sumI / n;
  const meanS = sumS / n;
  frameCounter += 1;
  if (frameCounter % 5 === 0) {
    cachedMetrics = computeStructureMetrics(sim.S, mesh.neighborList, 0.5);
  }
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(10, 10, 320, 104);
  ctx.fillStyle = "white";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.fillText("t=" + sim.t.toFixed(1) + "  speed=" + app.speed.toFixed(1) + "x", 20, 32);
  ctx.fillText("E=" + meanE.toFixed(4) + "  I=" + meanI.toFixed(4), 20, 52);
  ctx.fillText("mean sigma=" + meanS.toFixed(3) + "  mode=" + app.mode, 20, 72);
  ctx.fillText(
    "Moran's I=" +
      cachedMetrics.moranI.toFixed(3) +
      "  cluster mean=" +
      cachedMetrics.meanCluster.toFixed(1) +
      "  max=" +
      cachedMetrics.maxCluster,
    20,
    92
  );
  ctx.restore();

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
