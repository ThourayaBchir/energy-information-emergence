import { clamp, clamp01, hslToRgb } from "./utils.js";

export function renderToCanvas(ctx, sim, mesh, mode, drawGrid, width, height, rotLon, rotLat) {
  ctx.clearRect(0, 0, width, height);

  let Emin = Infinity;
  let Emax = -Infinity;
  let Imin = Infinity;
  let Imax = -Infinity;
  for (let i = 0; i < sim.E.length; i++) {
    const e = sim.E[i];
    const inf = sim.I[i];
    if (e < Emin) Emin = e;
    if (e > Emax) Emax = e;
    if (inf < Imin) Imin = inf;
    if (inf > Imax) Imax = inf;
  }
  const Er = Math.max(1e-6, Emax - Emin);
  const Ir = Math.max(1e-6, Imax - Imin);

  if (mesh.type === "grid") {
    const H = mesh.grid.H;
    const W = mesh.grid.W;
    const scale = Math.max(1, Math.floor(Math.min(width / W, height / H)));
    const renderW = W * scale;
    const renderH = H * scale;
    const offsetX = Math.floor((width - renderW) / 2);
    const offsetY = Math.floor((height - renderH) / 2);

    if (!mesh._gridCache || mesh._gridCache.w !== renderW || mesh._gridCache.h !== renderH) {
      mesh._gridCache = { w: renderW, h: renderH, imageData: ctx.createImageData(renderW, renderH) };
    }
    const data = mesh._gridCache.imageData.data;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const eN = (sim.E[i] - Emin) / Er;
        const iN = (sim.I[i] - Imin) / Ir;
        const s = clamp01(sim.S[i]);
        let r = 0;
        let g = 0;
        let b = 0;
        if (mode === "energy") {
          const rgb = hslToRgb(220 - 220 * eN, 0.85, 0.5);
          r = rgb.r;
          g = rgb.g;
          b = rgb.b;
        } else if (mode === "info") {
          const rgb = hslToRgb(120, 0.85, 0.1 + 0.75 * iN);
          r = rgb.r;
          g = rgb.g;
          b = rgb.b;
        } else if (mode === "sigma") {
          const v = Math.round(20 + 200 * s);
          r = v;
          g = v;
          b = v;
        } else {
          const rgb = hslToRgb(220 - 220 * eN, 0.85, 0.12 + 0.65 * iN);
          r = Math.min(255, rgb.r + Math.round(28 * s));
          g = Math.min(255, rgb.g + Math.round(28 * s));
          b = Math.min(255, rgb.b + Math.round(28 * s));
        }

        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x * scale + sx;
            const py = y * scale + sy;
            const p = (py * renderW + px) * 4;
            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
            data[p + 3] = 255;
          }
        }
      }
    }

    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(mesh._gridCache.imageData, offsetX, offsetY);

    if (drawGrid && scale >= 4) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      for (let y = 0; y <= H; y++) {
        const py = offsetY + y * scale;
        ctx.beginPath();
        ctx.moveTo(offsetX, py);
        ctx.lineTo(offsetX + renderW, py);
        ctx.stroke();
      }
      for (let x = 0; x <= W; x++) {
        const px = offsetX + x * scale;
        ctx.beginPath();
        ctx.moveTo(px, offsetY);
        ctx.lineTo(px, offsetY + renderH);
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }

  const cosLat = Math.cos(rotLat);
  const sinLat = Math.sin(rotLat);
  const cosLon = Math.cos(rotLon);
  const sinLon = Math.sin(rotLon);

  function rotateVec(v) {
    let x = v[0];
    let y = v[1];
    let z = v[2];
    const y1 = y * cosLat - z * sinLat;
    const z1 = y * sinLat + z * cosLat;
    y = y1;
    z = z1;
    const x1 = x * cosLon + z * sinLon;
    const z2 = -x * sinLon + z * cosLon;
    x = x1;
    z = z2;
    return [x, y, z];
  }

  function colorFor(idx) {
    const eN = (sim.E[idx] - Emin) / Er;
    const iN = (sim.I[idx] - Imin) / Ir;
    const s = clamp01(sim.S[idx]);
    if (mode === "energy") {
      const rgb = hslToRgb(220 - 220 * eN, 0.85, 0.5);
      return [rgb.r, rgb.g, rgb.b];
    }
    if (mode === "info") {
      const rgb = hslToRgb(120, 0.85, 0.1 + 0.75 * iN);
      return [rgb.r, rgb.g, rgb.b];
    }
    if (mode === "sigma") {
      const v = Math.round(20 + 200 * s);
      return [v, v, v];
    }
    const rgb = hslToRgb(220 - 220 * eN, 0.85, 0.12 + 0.65 * iN);
    return [
      Math.min(255, rgb.r + Math.round(28 * s)),
      Math.min(255, rgb.g + Math.round(28 * s)),
      Math.min(255, rgb.b + Math.round(28 * s)),
    ];
  }

  const lightDir = (() => {
    const lx = 0.35;
    const ly = 0.2;
    const lz = 0.9;
    const ll = Math.hypot(lx, ly, lz) || 1;
    return [lx / ll, ly / ll, lz / ll];
  })();

  let projected = mesh._projectedCache;
  if (!projected || projected.length !== mesh.vertices.length) {
    projected = new Array(mesh.vertices.length);
    for (let i = 0; i < projected.length; i++) {
      projected[i] = { x: 0, y: 0, z: 0 };
    }
    mesh._projectedCache = projected;
  }
  let maxXY = 1e-6;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    const r = rotateVec(v);
    const x = r[0];
    const y = r[1];
    const z = r[2];
    const p = projected[i];
    p.x = x;
    p.y = y;
    p.z = z;
    const rxy = Math.hypot(x, y);
    if (rxy > maxXY) maxXY = rxy;
  }

  const scale = (Math.min(width, height) * 0.46) / maxXY;
  const cx = width * 0.5;
  const cy = height * 0.5;

  if (mesh.type === "points") {
    const rPx = Math.max(1, Math.round(scale * 0.012));

    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      if (p.z <= 0) continue;
      const px = cx + p.x * scale;
      const py = cy - p.y * scale;
      const base = colorFor(i);
      const shade = 0.5 + 0.5 * Math.max(0, p.x * lightDir[0] + p.y * lightDir[1] + p.z * lightDir[2]);
      const r = Math.round(base[0] * shade);
      const g = Math.round(base[1] * shade);
      const b = Math.round(base[2] * shade);
      ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
      ctx.fillRect(px - rPx, py - rPx, rPx * 2, rPx * 2);
    }

    if (drawGrid) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  const faces = mesh.faces;
  const drawFaces = [];
  for (let f = 0; f < faces.length; f++) {
    const a = faces[f][0];
    const b = faces[f][1];
    const c = faces[f][2];
    const pa = projected[a];
    const pb = projected[b];
    const pc = projected[c];
    const zAvg = (pa.z + pb.z + pc.z) / 3;
    if (zAvg <= 0) continue;
    const abx = pb.x - pa.x;
    const aby = pb.y - pa.y;
    const abz = pb.z - pa.z;
    const acx = pc.x - pa.x;
    const acy = pc.y - pa.y;
    const acz = pc.z - pa.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (nz < 0) {
      nx *= -1;
      ny *= -1;
      nz *= -1;
    }
    const diff = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
    const shade = 0.35 + 0.65 * diff;
    drawFaces.push({ a, b, c, zAvg, shade });
  }
  drawFaces.sort((fa, fb) => fa.zAvg - fb.zAvg);

  for (let i = 0; i < drawFaces.length; i++) {
    const f = drawFaces[i];
    const pa = projected[f.a];
    const pb = projected[f.b];
    const pc = projected[f.c];
    const xa = cx + pa.x * scale;
    const ya = cy - pa.y * scale;
    const xb = cx + pb.x * scale;
    const yb = cy - pb.y * scale;
    const xc = cx + pc.x * scale;
    const yc = cy - pc.y * scale;

    const ca = colorFor(f.a);
    const cb = colorFor(f.b);
    const cc = colorFor(f.c);
    const baseR = (ca[0] + cb[0] + cc[0]) / 3;
    const baseG = (ca[1] + cb[1] + cc[1]) / 3;
    const baseB = (ca[2] + cb[2] + cc[2]) / 3;
    const r = Math.round(baseR * f.shade);
    const g = Math.round(baseG * f.shade);
    const bcol = Math.round(baseB * f.shade);

    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.lineTo(xc, yc);
    ctx.closePath();
    ctx.fillStyle = "rgb(" + r + "," + g + "," + bcol + ")";
    ctx.fill();
    if (drawGrid) {
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
  }

  if (mesh.type !== "torus") {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (drawGrid && mesh.type !== "torus") {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 5) {
        const latRad = (lat * Math.PI) / 180;
        const lonRad = (lon * Math.PI) / 180;
        let x = Math.cos(latRad) * Math.cos(lonRad);
        let y = Math.cos(latRad) * Math.sin(lonRad);
        let z = Math.sin(latRad);
        const y1 = y * cosLat - z * sinLat;
        const z1 = y * sinLat + z * cosLat;
        y = y1;
        z = z1;
        const x1 = x * cosLon + z * sinLon;
        const z2 = -x * sinLon + z * cosLon;
        x = x1;
        z = z2;
        if (z <= 0) continue;
        const px = cx + x * scale;
        const py = cy - y * scale;
        if (lon === -180) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

export const Render = {
  renderToCanvas,
};
