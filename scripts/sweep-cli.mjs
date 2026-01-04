#!/usr/bin/env node
"use strict";

import {
  createParams,
  createState,
  applyPhase,
  resetState,
  stepSim,
  computeCorrelationLengthSigma,
} from "../js/sim-core.js";
import { TEST_PRESETS } from "../js/sim-presets.js";

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  const v = parseFloat(process.argv[idx + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const warmup = parseInt(parseArg("--warmup", 300), 10);
const measure = parseInt(parseArg("--measure", 800), 10);
const phaseStep = parseArg("--step", 0.02);
const modeIdx = process.argv.indexOf("--mode");
const mode = modeIdx !== -1 && modeIdx + 1 < process.argv.length ? process.argv[modeIdx + 1] : "both";
const runPresets = mode === "both" || mode === "presets";
const runPhases = mode === "both" || mode === "phase";

const params = createParams();
const state = createState(1);

function runPresetSweep() {
  const presets = Object.entries(TEST_PRESETS);
  console.log("mode,id,xiNorm,regime");
  for (let i = 0; i < presets.length; i++) {
    const [name, preset] = presets[i];
    resetState(state, 1);
    Object.keys(preset).forEach((key) => {
      if (params[key] !== undefined) params[key] = preset[key];
    });
    for (let t = 0; t < warmup; t++) {
      stepSim(state, params, t);
    }

    for (let t = 0; t < measure; t++) {
      stepSim(state, params, t);
    }

    const xiNorm = computeCorrelationLengthSigma(state);
    let regime = "none";
    if (xiNorm > 0.2) regime = "pattern";
    console.log("preset," + name + "," + xiNorm.toFixed(3) + "," + regime);
  }
}

function runPhaseSweep() {
  const phases = [];
  for (let p = 0.0; p <= 1.0001; p += phaseStep) phases.push(p);
  if (!runPresets) console.log("mode,id,xiNorm,regime");

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    resetState(state, 1);
    applyPhase(params, p);
    for (let t = 0; t < warmup; t++) {
      stepSim(state, params, t);
    }

    for (let t = 0; t < measure; t++) {
      stepSim(state, params, t);
    }

    const xiNorm = computeCorrelationLengthSigma(state);
    let regime = "none";
    if (xiNorm > 0.2) regime = "pattern";
    console.log("phase," + p.toFixed(2) + "," + xiNorm.toFixed(3) + "," + regime);
  }
}

if (runPresets) runPresetSweep();
if (runPhases) runPhaseSweep();
