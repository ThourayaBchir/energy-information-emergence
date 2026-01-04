export function createCore(width = 180, height = 130) {
  const W = width;
  const H = height;
  const N = W * H;
  const WRAP = true;

  const DEG = new Uint8Array(N);
  (function initDegrees() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let d = 0;
      if (WRAP || x > 0) d++;
      if (WRAP || x + 1 < W) d++;
      if (WRAP || y > 0) d++;
      if (WRAP || y + 1 < H) d++;
      DEG[idx(x, y)] = d;
    }
  })();

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function idx(x, y) { return y * W + x; }

  function torusDelta(a, b, period) {
    let d = a - b;
    if (!WRAP) return d;
    d = ((d + 0.5 * period) % period) - 0.5 * period;
    return d;
  }

  function createParams() {
    return {
      dt: 1.0,
      diffusion: 0.053,
      sigma_base: 0.327,
      sigma_gain: 3.34,
      evaporation: 0.017,
      sun_strength: 0.04,
      sun_width: 0.31,
      sun_speed: 0.0045,
      sun_wobble: 0.28,
      info_threshold: 0.078,
      info_gain: 0.744,
      info_power: 1.25,
      info_decay: 0.031,
      info_energy_cost: 1.0,
      sigma_on: 0.61,
      sigma_off: 0.07,
      sigma_rate: 0.032,
      sigma_write_cost: 0.9,
      sigma_maint_cost: 0.0151,
      sigma_relax: 0.0041,
      collapse_I: 1.49,
      collapse_fraction: 0.69,
      jitter: 0.594,
      jump_prob: 0.0245,
      contrast: 1.22
    };
  }

  function applyPhase(params, p) {
    params.diffusion = clamp(0.04 + 0.12 * p, 0.02, 0.20);
    params.sigma_gain = clamp(0.6 + 2.2 * p, 0.2, 3.2);
    params.sigma_base = clamp(0.20 - 0.16 * p, 0.02, 0.25);

    params.info_threshold = clamp(0.13 - 0.10 * p, 0.02, 0.18);
    params.info_gain = clamp(0.25 + 0.95 * p, 0.05, 1.4);
    params.info_power = clamp(1.25 + 1.15 * p, 1.0, 3.0);
    params.info_decay = clamp(0.030 - 0.020 * p, 0.005, 0.06);

    params.sigma_rate = clamp(0.002 + 0.014 * p, 0.001, 0.03);
    params.sigma_on = clamp(0.55 - 0.28 * p, 0.12, 0.75);
    params.sigma_off = clamp(params.sigma_on * 0.55, 0.05, params.sigma_on - 0.02);

    params.collapse_I = clamp(1.60 - 0.85 * p, 0.45, 1.80);
    params.collapse_fraction = clamp(0.12 + 0.55 * p, 0.05, 0.95);
    params.jitter = clamp(0.10 + 0.95 * p, 0.0, 1.3);
    params.jump_prob = p > 0.75 ? (0.0005 + 0.02 * (p - 0.75)) : 0.0003;

    params.sun_strength = clamp(0.08 + 0.22 * p, 0.03, 0.35);
    params.sun_width = clamp(0.30 - 0.18 * p, 0.08, 0.45);
    params.evaporation = clamp(0.006 - 0.004 * p, 0.001, 0.02);

    params.sigma_write_cost = clamp(0.25 + 1.25 * p, 0.05, 1.8);
    params.sigma_maint_cost = clamp(0.0006 + 0.004 * p, 0.0002, 0.010);
    params.sigma_relax = clamp(0.001 + 0.006 * p, 0.0005, 0.02);
  }

  function createState(seed = 1) {
    const E = new Float32Array(N);
    const I = new Float32Array(N);
    const S = new Float32Array(N);
    const dE = new Float32Array(N);
    const dI = new Float32Array(N);
    const fluxSum = new Float32Array(N);
    const state = {
      E, I, S, dE, dI, fluxSum,
      seed,
      rng: mulberry32(seed),
    };
    resetState(state, seed);
    return state;
  }

  function resetState(state, seed = state.seed) {
    state.seed = seed;
    state.rng = mulberry32(seed);
    for (let i = 0; i < N; i++) {
      state.E[i] = 0.02 * (state.rng() - 0.5);
      state.I[i] = 0;
      state.S[i] = 0;
    }
  }

  function sunInject(params, x, y, t) {
    const band = (Math.sin(t * params.sun_speed) * 0.35 + 0.5) * H;
    const wob = Math.sin(t * params.sun_speed * 0.73) * params.sun_wobble;
    const dy0 = torusDelta(y, band, H);
    const dy = dy0 / Math.max(1e-6, params.sun_width * H);
    const lat = Math.exp(-0.5 * dy * dy);
    const lon = 0.65 + 0.35 * Math.sin(2 * Math.PI * (x / W + wob));
    return params.sun_strength * lat * lon;
  }

  function stepSim(state, params, t) {
    const { E, I, S, dE, dI, fluxSum } = state;
    dE.fill(0);
    dI.fill(0);
    fluxSum.fill(0);

    let driveSum = 0;
    let dissSum = 0;
    let collapseCount = 0;
    let releaseSum = 0;

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const inj = sunInject(params, x, y, t);
      dE[i] += inj;
      driveSum += inj;

      const evap = params.evaporation * Math.max(0, E[i]);
      dE[i] -= evap;
      dissSum += evap;
    }

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const Ei = E[i];
      const si = clamp01(S[i]);

      const xr = WRAP ? ((x + 1) % W) : (x + 1);
      if (WRAP || xr < W) {
        const j = idx(xr, y);
        const d = E[j] - Ei;
        const sj = clamp01(S[j]);
        const conduct = params.sigma_base + params.sigma_gain * (si * sj);
        const flow = params.diffusion * conduct * d;
        dE[i] += flow; dE[j] -= flow;
        const ad = Math.abs(d);
        fluxSum[i] += ad; fluxSum[j] += ad;
      }

      const yd = WRAP ? ((y + 1) % H) : (y + 1);
      if (WRAP || yd < H) {
        const j = idx(x, yd);
        const d = E[j] - Ei;
        const sj = clamp01(S[j]);
        const conduct = params.sigma_base + params.sigma_gain * (si * sj);
        const flow = params.diffusion * conduct * d;
        dE[i] += flow; dE[j] -= flow;
        const ad = Math.abs(d);
        fluxSum[i] += ad; fluxSum[j] += ad;
      }
    }

    for (let i = 0; i < N; i++) {
      const deg = DEG[i] || 1;
      const flux = fluxSum[i] / deg;
      const above = Math.max(0, flux - params.info_threshold);
      const gain = params.info_gain * Math.pow(above, params.info_power);

      const predictedE = E[i] + dE[i] * params.dt;
      const available = Math.max(0, predictedE);
      const cost = gain * params.info_energy_cost;
      const afford = cost > 0 ? Math.min(1, available / (cost * params.dt + 1e-12)) : 1;
      const applied = gain * afford;

      dI[i] += applied;
      dE[i] -= applied * params.info_energy_cost;
      dissSum += applied * params.info_energy_cost;

      const decay = params.info_decay * I[i];
      dI[i] -= decay;
      dE[i] += decay * params.info_energy_cost;
      dissSum -= decay * params.info_energy_cost;
    }

    for (let i = 0; i < N; i++) {
      E[i] += dE[i] * params.dt;
      I[i] = Math.max(0, I[i] + dI[i] * params.dt);
    }

    for (let i = 0; i < N; i++) {
      const ii = I[i];
      const s0 = S[i];

      let ds = 0;
      if (ii >= params.sigma_on) ds = params.sigma_rate * (ii - params.sigma_on);
      else if (ii <= params.sigma_off) ds = params.sigma_rate * (ii - params.sigma_off);

      let s1 = clamp01(s0 + ds * params.dt);
      const wrote = Math.max(0, s1 - s0);

      if (wrote > 0) {
        const costW = wrote * params.sigma_write_cost;
        const payW = Math.min(Math.max(0, E[i]), costW);
        E[i] -= payW;
        dissSum += payW;
        if (payW < costW) s1 = s0 + wrote * (payW / (costW + 1e-12));
      }

      const maint = params.sigma_maint_cost * s1;
      const payM = Math.min(Math.max(0, E[i]), maint);
      E[i] -= payM;
      dissSum += payM;

      const relax = params.sigma_relax * s1;
      const s2 = clamp01(s1 - relax);
      E[i] += (s1 - s2) * params.sigma_write_cost * 0.6;
      S[i] = s2;
    }

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (I[i] < params.collapse_I) continue;

      const maxRelease = params.collapse_fraction * I[i] * params.info_energy_cost;
      const release = Math.min(Math.max(0, E[i]), maxRelease);
      if (release <= 0) continue;
      collapseCount += 1;
      releaseSum += release;

      I[i] = Math.max(0, I[i] - release / params.info_energy_cost);
      if (I[i] < params.sigma_off) S[i] *= 0.5;

      const nb = [
        idx((x - 1 + W) % W, y),
        idx((x + 1) % W, y),
        idx(x, (y - 1 + H) % H),
        idx(x, (y + 1) % H),
      ];

      let sumW = 0;
      const wts = new Float32Array(nb.length);
      for (let k = 0; k < nb.length; k++) {
        const j = nb[k];
        const base = 0.8 + 0.4 * (1 - clamp01(S[j]));
        const jit = Math.exp(params.jitter * (state.rng() - 0.5));
        const w = Math.max(1e-3, base * jit);
        wts[k] = w;
        sumW += w;
      }
      const norm = release / (sumW || nb.length);
      for (let k = 0; k < nb.length; k++) E[nb[k]] += wts[k] * norm;
      E[i] -= release;

      if (state.rng() < params.jump_prob) {
        const j = (state.rng() * N) | 0;
        const jumpShare = 0.5 * release;
        E[j] += jumpShare;
        E[i] -= jumpShare;
      }
    }

    return { driveSum, dissSum, collapseCount, releaseSum };
  }

  function computeCorrelationLengthSigma(state) {
    const maxR = Math.floor(Math.min(W, H) / 4);
    const corr = new Float32Array(maxR);
    const counts = new Uint32Array(maxR);

    let mean = 0;
    for (let i = 0; i < N; i++) mean += state.S[i];
    mean /= N;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y);
        const si = state.S[i] - mean;
        for (let dy = -maxR; dy <= maxR; dy++) {
          for (let dx = -maxR; dx <= maxR; dx++) {
            const r = Math.round(Math.hypot(dx, dy));
            if (r === 0 || r >= maxR) continue;
            const j = idx((x + dx + W) % W, (y + dy + H) % H);
            corr[r] += si * (state.S[j] - mean);
            counts[r]++;
          }
        }
      }
    }

    for (let r = 1; r < maxR; r++) {
      if (counts[r] > 0) corr[r] /= counts[r];
    }

    const c0 = corr[1];
    for (let r = 2; r < maxR; r++) {
      if (corr[r] < c0 / Math.E) {
        return r / Math.min(W, H);
      }
    }
    return maxR / Math.min(W, H);
  }

  return {
    W,
    H,
    N,
    WRAP,
    DEG,
    mulberry32,
    clamp01,
    clamp,
    idx,
    torusDelta,
    createParams,
    applyPhase,
    createState,
    resetState,
    stepSim,
    computeCorrelationLengthSigma,
  };
}

const defaultCore = createCore(180, 130);

export const W = defaultCore.W;
export const H = defaultCore.H;
export const N = defaultCore.N;
export const WRAP = defaultCore.WRAP;
export const DEG = defaultCore.DEG;
export const mulberry32 = defaultCore.mulberry32;
export const clamp01 = defaultCore.clamp01;
export const clamp = defaultCore.clamp;
export const idx = defaultCore.idx;
export const torusDelta = defaultCore.torusDelta;
export const createParams = defaultCore.createParams;
export const applyPhase = defaultCore.applyPhase;
export const createState = defaultCore.createState;
export const resetState = defaultCore.resetState;
export const stepSim = defaultCore.stepSim;
export const computeCorrelationLengthSigma = defaultCore.computeCorrelationLengthSigma;
