#!/usr/bin/env node
"use strict";

import { W, H, createParams, createState, applyPhase, resetState, stepSim } from "../js/sim-core.js";
import { TEST_PRESETS } from "../js/sim-presets.js";

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = parseFloat(process.argv[idx + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function linearRegressionSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return NaN;
  return (n * sxy - sx * sy) / denom;
}

function asciiPlot(points, width = 48, height = 12) {
  if (!points.length) return;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of points) {
    if (p.logS < xmin) xmin = p.logS;
    if (p.logS > xmax) xmax = p.logS;
    if (p.logP < ymin) ymin = p.logP;
    if (p.logP > ymax) ymax = p.logP;
  }
  const w = Math.max(2, width);
  const h = Math.max(2, height);
  const grid = Array.from({ length: h }, () => Array(w).fill(" "));
  for (const p of points) {
    const x = xmax === xmin ? 0 : Math.round(((p.logS - xmin) / (xmax - xmin)) * (w - 1));
    const y = ymax === ymin ? 0 : Math.round(((p.logP - ymin) / (ymax - ymin)) * (h - 1));
    const row = h - 1 - y;
    grid[row][x] = "*";
  }
  console.log("logS (x) vs logP (y)");
  for (const row of grid) console.log(row.join(""));
}

class SOCMetrics {
  constructor(quietPeriod = 5) {
    this.quietPeriod = quietPeriod;
    this.reset();
  }

  reset() {
    this.avalanches = [];
    this.currentAvalanche = { size: 0, start: 0, active: false };
    this.timeSeries = [];
    this.lastCollapse = -Infinity;
  }

  step(t, collapseCount, globalActivity) {
    const hasCollapse = collapseCount > 0;
    if (hasCollapse && !this.currentAvalanche.active) {
      this.currentAvalanche = { size: 0, start: t, active: true };
    }

    if (this.currentAvalanche.active) {
      this.currentAvalanche.size += collapseCount;

      if (!hasCollapse && t - this.lastCollapse > this.quietPeriod) {
        this.currentAvalanche.duration = t - this.currentAvalanche.start;
        this.avalanches.push({ ...this.currentAvalanche });
        this.currentAvalanche.active = false;
      }
    }

    this.lastCollapse = hasCollapse ? t : this.lastCollapse;
    this.timeSeries.push(globalActivity);
  }

  analyze() {
    const sizeBins = {};
    this.avalanches.forEach((a) => {
      if (a.size <= 0) return;
      const bin = Math.floor(Math.log2(a.size));
      sizeBins[bin] = (sizeBins[bin] || 0) + 1;
    });

    const xs = [];
    const ys = [];
    Object.keys(sizeBins).sort((a, b) => Number(a) - Number(b)).forEach((bin) => {
      const size = Math.pow(2, Number(bin));
      xs.push(size);
      ys.push(sizeBins[bin]);
    });

    const logX = xs.map(Math.log);
    const logY = ys.map(Math.log);
    const slope = linearRegressionSlope(logX, logY);

    const total = this.avalanches.length;
    const avgSize = total > 0
      ? this.avalanches.reduce((s, a) => s + a.size, 0) / total
      : 0;

    return {
      tau: Number.isFinite(slope) ? -slope : NaN,
      totalAvalanches: total,
      avgSize: avgSize,
      sizeBins: sizeBins,
    };
  }
}

const warmup = parseInt(parseArg("--warmup", 1000), 10);
const measure = parseInt(parseArg("--measure", 4000), 10);
const plot = process.argv.includes("--plot");

const defaultPhase = 0.70;
const phaseArgIndex = process.argv.indexOf("--phase");
const phase = phaseArgIndex !== -1 ? parseArg("--phase", defaultPhase) : defaultPhase;
const presetIndex = process.argv.indexOf("--preset");
const presetName = presetIndex !== -1 && presetIndex + 1 < process.argv.length
  ? process.argv[presetIndex + 1].toUpperCase()
  : null;

const params = createParams();
if (presetName && TEST_PRESETS[presetName]) {
  const preset = TEST_PRESETS[presetName];
  Object.keys(preset).forEach((key) => {
    if (params[key] !== undefined) params[key] = preset[key];
  });
} else {
  applyPhase(params, phase);
}

const state = createState(1);
resetState(state, 1);

for (let t = 0; t < warmup; t++) {
  stepSim(state, params, t);
}

const metrics = new SOCMetrics();
for (let t = 0; t < measure; t++) {
  const res = stepSim(state, params, t);
  const globalActivity = res.releaseSum;
  metrics.step(t, res.collapseCount, globalActivity);
}

const results = metrics.analyze();
console.log(`tau,${Number.isFinite(results.tau) ? results.tau.toFixed(3) : "n/a"}`);
console.log(`totalAvalanches,${results.totalAvalanches}`);
console.log(`avgSize,${results.avgSize.toFixed(3)}`);

const points = Object.keys(results.sizeBins).sort((a, b) => Number(a) - Number(b)).map((bin) => {
  const size = Math.pow(2, Number(bin));
  const count = results.sizeBins[bin];
  return { logS: Math.log10(size), logP: Math.log10(count) };
});

console.log("logS,logP");
for (const row of points) {
  console.log(row.logS.toFixed(4) + "," + row.logP.toFixed(4));
}
if (plot) asciiPlot(points);

if (results.totalAvalanches < 5) {
  console.log("Need more data");
} else {
  const maxSize = Math.max(...metrics.avalanches.map((a) => a.size));
  const median = metrics.avalanches.map((a) => a.size).sort((a, b) => a - b)[Math.floor(metrics.avalanches.length / 2)];
  const ratio = median > 0 ? maxSize / median : 0;
  console.log(`Max/median ratio: ${ratio.toFixed(1)}`);
  console.log(`(SOC typically > 100, ordered < 10)`);
  console.log(`Largest event: ${maxSize} steps`);
  console.log(`(SOC: largest ~ total cells: ${W * H})`);
}
