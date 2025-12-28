import { clamp, normalize, midpoint } from "./utils.js";

export function createIcosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices = [
    normalize([-1, t, 0]),
    normalize([1, t, 0]),
    normalize([-1, -t, 0]),
    normalize([1, -t, 0]),
    normalize([0, -1, t]),
    normalize([0, 1, t]),
    normalize([0, -1, -t]),
    normalize([0, 1, -t]),
    normalize([t, 0, -1]),
    normalize([t, 0, 1]),
    normalize([-t, 0, -1]),
    normalize([-t, 0, 1]),
  ];

  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const midpointCache = new Map();
    const newFaces = [];

    function getMid(a, b) {
      const key = a < b ? a + ":" + b : b + ":" + a;
      if (midpointCache.has(key)) return midpointCache.get(key);
      const m = midpoint(vertices[a], vertices[b]);
      const idx = vertices.length;
      vertices.push(m);
      midpointCache.set(key, idx);
      return idx;
    }

    for (const f of faces) {
      const [a, b, c] = f;
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }

  const neighbors = Array.from({ length: vertices.length }, () => new Set());
  for (const [a, b, c] of faces) {
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }

  const neighborList = neighbors.map((set) => Array.from(set));
  return { vertices, neighborList, faces };
}

export function createHexSphere(subdivisions) {
  const base = createIcosphere(subdivisions);
  const verts = base.vertices;
  const faces = base.faces;
  const faceCenters = new Array(faces.length);

  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    const x = (verts[a][0] + verts[b][0] + verts[c][0]) / 3;
    const y = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
    const z = (verts[a][2] + verts[b][2] + verts[c][2]) / 3;
    faceCenters[f] = normalize([x, y, z]);
  }

  const neighborSets = new Array(faceCenters.length);
  for (let i = 0; i < faceCenters.length; i++) neighborSets[i] = new Set();
  const edgeToFace = new Map();
  for (let f = 0; f < faces.length; f++) {
    const tri = faces[f];
    const edges = [
      [tri[0], tri[1]],
      [tri[1], tri[2]],
      [tri[2], tri[0]],
    ];
    for (let e = 0; e < edges.length; e++) {
      const a = edges[e][0];
      const b = edges[e][1];
      const key = a < b ? a + ":" + b : b + ":" + a;
      if (edgeToFace.has(key)) {
        const other = edgeToFace.get(key);
        neighborSets[f].add(other);
        neighborSets[other].add(f);
      } else {
        edgeToFace.set(key, f);
      }
    }
  }

  const incidentFaces = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) incidentFaces[i] = [];
  for (let f = 0; f < faces.length; f++) {
    const tri = faces[f];
    incidentFaces[tri[0]].push(f);
    incidentFaces[tri[1]].push(f);
    incidentFaces[tri[2]].push(f);
  }

  const dualFaces = [];
  for (let v = 0; v < verts.length; v++) {
    const center = verts[v];
    const list = incidentFaces[v];
    if (list.length < 3) continue;
    const ref = Math.abs(center[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const ux = normalize([
      ref[1] * center[2] - ref[2] * center[1],
      ref[2] * center[0] - ref[0] * center[2],
      ref[0] * center[1] - ref[1] * center[0],
    ]);
    const vx = [
      center[1] * ux[2] - center[2] * ux[1],
      center[2] * ux[0] - center[0] * ux[2],
      center[0] * ux[1] - center[1] * ux[0],
    ];
    const order = list.map((f) => {
      const c = faceCenters[f];
      const dot = c[0] * center[0] + c[1] * center[1] + c[2] * center[2];
      const tx = c[0] - center[0] * dot;
      const ty = c[1] - center[1] * dot;
      const tz = c[2] - center[2] * dot;
      const ax = tx * ux[0] + ty * ux[1] + tz * ux[2];
      const ay = tx * vx[0] + ty * vx[1] + tz * vx[2];
      return { f, ang: Math.atan2(ay, ax) };
    });
    order.sort((a, b) => a.ang - b.ang);
    const f0 = order[0].f;
    for (let k = 1; k < order.length - 1; k++) {
      dualFaces.push([f0, order[k].f, order[k + 1].f]);
    }
  }

  return {
    vertices: faceCenters,
    faces: dualFaces,
    neighborList: neighborSets.map((s) => Array.from(s)),
  };
}

export function toLonLat(v) {
  const lon = Math.atan2(v[1], v[0]);
  const lat = Math.asin(v[2]);
  return [lon, lat];
}

export function createFibonacciSphere(count) {
  const n = Math.max(12, Math.floor(count));
  const vertices = new Array(n);
  const lats = new Array(n);
  const lons = new Array(n);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const z = 1 - 2 * t;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = i * goldenAngle;
    const x = Math.cos(phi) * r;
    const y = Math.sin(phi) * r;
    vertices[i] = [x, y, z];
    lons[i] = Math.atan2(y, x);
    lats[i] = Math.asin(z);
  }

  const neighborList = buildBinnedNeighbors(vertices, lats, lons, 6);
  return { type: "points", vertices, neighborList, lats, lons };
}

function buildBinnedNeighbors(vertices, lats, lons, k) {
  const n = vertices.length;
  const neighborSets = Array.from({ length: n }, () => new Set());
  const binsLat = Math.max(8, Math.floor(Math.sqrt(n / 6)));
  const binsLon = binsLat * 2;
  const bins = Array.from({ length: binsLat * binsLon }, () => []);
  const latToBin = (lat) => clamp(Math.floor(((lat + Math.PI / 2) / Math.PI) * binsLat), 0, binsLat - 1);
  const lonToBin = (lon) => {
    const u = (lon + Math.PI) / (2 * Math.PI);
    return clamp(Math.floor(u * binsLon), 0, binsLon - 1);
  };
  const binIdx = (bi, bj) => bi * binsLon + bj;
  const wrapLon = (bj) => (bj + binsLon) % binsLon;

  for (let i = 0; i < n; i++) {
    const bi = latToBin(lats[i]);
    const bj = lonToBin(lons[i]);
    bins[binIdx(bi, bj)].push(i);
  }

  for (let i = 0; i < n; i++) {
    const bi = latToBin(lats[i]);
    const bj = lonToBin(lons[i]);
    const candidates = [];
    for (let di = -1; di <= 1; di++) {
      const bLat = clamp(bi + di, 0, binsLat - 1);
      for (let dj = -1; dj <= 1; dj++) {
        const bLon = wrapLon(bj + dj);
        candidates.push(...bins[binIdx(bLat, bLon)]);
      }
    }
    const vi = vertices[i];
    const dists = [];
    for (let c = 0; c < candidates.length; c++) {
      const j = candidates[c];
      if (i === j) continue;
      const vj = vertices[j];
      const dot = vi[0] * vj[0] + vi[1] * vj[1] + vi[2] * vj[2];
      dists.push({ j, d: 1 - dot });
    }
    dists.sort((a, b) => a.d - b.d);
    const take = Math.min(k, dists.length);
    for (let m = 0; m < take; m++) {
      const j = dists[m].j;
      neighborSets[i].add(j);
      neighborSets[j].add(i);
    }
  }
  return neighborSets.map((s) => Array.from(s));
}

export function createTorus(segmentsU, segmentsV, R, r) {
  const vertices = [];
  const faces = [];
  const neighborList = [];
  const lons = [];
  const lats = [];
  const idx = (u, v) => v * segmentsU + u;

  for (let v = 0; v < segmentsV; v++) {
    const phi = (v / segmentsV) * Math.PI * 2;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    for (let u = 0; u < segmentsU; u++) {
      const theta = (u / segmentsU) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x = (R + r * cosP) * cosT;
      const y = (R + r * cosP) * sinT;
      const z = r * sinP;
      vertices.push([x, y, z]);
      lons.push(theta - Math.PI);
      lats.push((phi - Math.PI) / 2);
    }
  }

  for (let v = 0; v < segmentsV; v++) {
    for (let u = 0; u < segmentsU; u++) {
      const u1 = (u + 1) % segmentsU;
      const v1 = (v + 1) % segmentsV;
      const a = idx(u, v);
      const b = idx(u1, v);
      const c = idx(u1, v1);
      const d = idx(u, v1);
      faces.push([a, b, d], [b, c, d]);
    }
  }

  for (let i = 0; i < vertices.length; i++) neighborList.push(new Set());
  for (const f of faces) {
    const [a, b, c] = f;
    neighborList[a].add(b);
    neighborList[a].add(c);
    neighborList[b].add(a);
    neighborList[b].add(c);
    neighborList[c].add(a);
    neighborList[c].add(b);
  }
  return {
    vertices,
    faces,
    neighborList: neighborList.map((s) => Array.from(s)),
    lons,
    lats,
  };
}

export function createLatLonGrid(H, W) {
  const vertices = new Array(H * W);
  const lats = new Array(H * W);
  const lons = new Array(H * W);
  const neighborList = new Array(H * W);
  const faces = [];

  function idx(y, x) {
    return y * W + x;
  }

  for (let y = 0; y < H; y++) {
    const lat = (y / (H - 1)) * Math.PI - Math.PI / 2;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2 - Math.PI;
      const cx = Math.cos(lon);
      const sx = Math.sin(lon);
      const i = idx(y, x);
      vertices[i] = [cosLat * cx, cosLat * sx, sinLat];
      lats[i] = lat;
      lons[i] = lon;

      const up = y > 0 ? idx(y - 1, x) : idx(y, x);
      const dn = y < H - 1 ? idx(y + 1, x) : idx(y, x);
      const lf = idx(y, (x - 1 + W) % W);
      const rt = idx(y, (x + 1) % W);
      neighborList[i] = [up, dn, lf, rt];
    }
  }

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W; x++) {
      const x1 = (x + 1) % W;
      const a = idx(y, x);
      const b = idx(y, x1);
      const c = idx(y + 1, x1);
      const d = idx(y + 1, x);
      faces.push([a, b, d], [b, c, d]);
    }
  }

  return {
    type: "grid",
    vertices,
    faces,
    neighborList,
    lons,
    lats,
    grid: { H, W },
  };
}

export const Mesh = {
  createIcosphere,
  createHexSphere,
  createTorus,
  createLatLonGrid,
  createFibonacciSphere,
  toLonLat,
};
