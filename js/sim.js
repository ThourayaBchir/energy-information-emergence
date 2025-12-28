import { clamp01 } from "./utils.js";

export function makeInitialState(count, seed, rngFactory) {
  const rng = rngFactory(seed);
  const E = new Float32Array(count);
  const I = new Float32Array(count);
  const S = new Float32Array(count);
  const dE = new Float32Array(count);
  const dI = new Float32Array(count);
  const fluxSum = new Float32Array(count);
  const slow = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    E[i] = 0.02 * (rng() - 0.5) + 0.02 * (rng() - 0.5);
    I[i] = 0;
    S[i] = 0;
  }
  return { E, I, S, dE, dI, fluxSum, slow, t: 0 };
}

export function stepSim(state, params, neighbors, rng, lats, lons) {
  const { E, I, S, dE, dI, fluxSum, slow } = state;
  const n = E.length;

  const {
    dt,
    diffusion,
    sigma_slow,
    evaporation,
    info_gain,
    info_threshold,
    info_decay,
    info_cost,
    info_energy_cost,
    sigma_on,
    sigma_off,
    collapse_I,
    collapse_fraction,
    jitter,
    sun_strength,
    sun_width,
    sun_speed,
    sun_lat_bias,
    sun_lon_wobble,
    noise_floor,
  } = params;

  const t = state.t;
  const bandCenterLat = Math.sin(t * sun_speed) * (0.6 + 0.35 * sun_lat_bias);
  const wobble = Math.sin(t * sun_speed * 0.7) * sun_lon_wobble;

  dE.fill(0);
  dI.fill(0);
  fluxSum.fill(0);

  for (let i = 0; i < n; i++) {
    const lat = lats[i];
    const lon = lons[i];
    const latDist = (lat - bandCenterLat) / Math.max(1e-6, sun_width);
    const sunLatFactor = Math.exp(-0.5 * latDist * latDist);
    const lonFactor = 0.65 + 0.35 * Math.sin(2 * Math.PI * ((lon + Math.PI) / (2 * Math.PI) + wobble));
    const inject = sun_strength * sunLatFactor * lonFactor;

    dE[i] += inject - evaporation * E[i];
    slow[i] = 1.0 - clamp01(S[i]) * (1.0 - sigma_slow);
  }

  for (let i = 0; i < n; i++) {
    const nb = neighbors[i];
    const Ei = E[i];
    for (let kN = 0; kN < nb.length; kN++) {
      const j = nb[kN];
      if (j <= i) continue;
      const d = E[j] - Ei;
      const kij = diffusion * 0.5 * (slow[i] + slow[j]);
      const flow = kij * d;
      dE[i] += flow;
      dE[j] -= flow;
      const ad = Math.abs(d);
      fluxSum[i] += ad;
      fluxSum[j] += ad;
    }
  }

  for (let i = 0; i < n; i++) {
    const deg = neighbors[i].length || 1;
    const fluxMag = fluxSum[i] / deg;
    const above = Math.max(0, fluxMag - info_threshold);
    const gain = info_gain * above;
    dI[i] += gain;
    dE[i] -= gain * info_energy_cost;

    if (noise_floor > 0) {
      const gate = clamp01((fluxMag - info_threshold) / (info_threshold + 1e-6));
      dE[i] += noise_floor * (rng() - 0.5) * gate * gate * gate * gate;
    }

    const fluxSupport = clamp01(S[i]) * clamp01(fluxMag / (info_threshold + 1e-6));
    const effectiveDecay = info_decay * (1 - 0.6 * fluxSupport);
    const effectiveCost = info_cost * (1 - 0.6 * fluxSupport);

    dI[i] -= effectiveDecay * I[i];
    dE[i] -= effectiveCost * I[i];
  }

  for (let i = 0; i < n; i++) {
    E[i] += dE[i] * dt;
    I[i] = Math.max(0, I[i] + dI[i] * dt);
  }

  const relaxRate = 0.02;
  for (let i = 0; i < n; i++) {
    if (I[i] >= sigma_on) S[i] = Math.min(1, S[i] + relaxRate);
    else if (I[i] <= sigma_off) S[i] = Math.max(0, S[i] - relaxRate);
  }

  for (let i = 0; i < n; i++) {
    if (I[i] >= collapse_I) {
      const nb = neighbors[i];
      const release = collapse_fraction * I[i] * info_energy_cost;
      I[i] *= 0.25;
      if (I[i] < sigma_off) S[i] *= 0.5;
      const deg = nb.length || 1;
      let sumW = 0;
      const weights = new Array(deg);
      for (let kN = 0; kN < deg; kN++) {
        const j = nb[kN];
        const base = 0.6 + 0.8 * clamp01(S[j]);
        const jit = 1 + jitter * (rng() - 0.5);
        const w = Math.max(0.001, base * jit);
        weights[kN] = w;
        sumW += w;
      }
      const norm = sumW > 0 ? release / sumW : release / deg;
      for (let kN = 0; kN < deg; kN++) {
        const j = nb[kN];
        E[j] += weights[kN] * norm;
      }
      E[i] -= release;
    }
  }

  state.t = t + dt;
}

export const Sim = {
  makeInitialState,
  stepSim,
};
