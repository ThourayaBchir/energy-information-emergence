# Spherical Emergence: Energy + Information

See it here: https://information-dynamics.netlify.app/

This project is an interactive simulation of a local, open, non-equilibrium system on a sphere (or related topology). It shows how persistent structure can emerge without agents, goals, or optimization. Everything is driven by local rules and thermodynamic costs.

![Simulation snapshot](img_eis.png)

## Core idea

Structure is a temporary resistance to energy flow that is born from unstable gradients, paid for by dissipation, and recycled through collapse into the randomness that seeds its successor.

## What the simulation models

Each node stores three fields:

- **E (energy):** injected by a moving "sun" band, diffuses, and evaporates.
- **I (information):** condenses only when local flux exceeds a threshold; decays and costs energy.
- **S (sigma):** graded resistance in [0, 1] that slows diffusion; updated with hysteresis.

The system is fully local: updates depend only on neighboring nodes.

## Dynamics

1. A moving band injects energy (open system).
2. Energy diffuses to smooth gradients.
3. Strong gradients create information.
4. Information turns on structure (sigma).
5. Structure resists diffusion, reshaping flow.
6. Information is costly and decays.
7. If information grows too large, collapse releases energy with small randomness.
8. The released energy seeds new gradients and new structure.

The loop is: drive -> gradients -> information -> structure -> inhibited flow -> collapse -> energy + noise -> new gradients.

## Topologies

- **Hex sphere:** dual of icosphere faces (more uniform neighborhoods).
- **Fibonacci sphere:** near-uniform point set with approximate neighbors.
- **Lat/Lon grid:** equirectangular grid (fast but has polar artifacts).
- **Torus:** periodic in both directions.

## Parameters (knobs)

Energy flow:
- `diffusion`, `sigma_slow`, `evaporation`

Information:
- `info_gain`, `info_threshold`, `info_decay`, `info_cost`, `info_energy_cost`

Sigma hysteresis:
- `sigma_on`, `sigma_off`

Collapse:
- `collapse_I`, `collapse_fraction`, `jitter`

Sun drive:
- `sun_strength`, `sun_width`, `sun_speed`, `sun_lat_bias`, `sun_lon_wobble`

Noise:
- `noise_floor` (optional, flux-gated)

## Expected regimes

- **Smooth equilibration:** little or no structure.
- **Persistent channels/bands:** stable sigma patterns that guide flow.
- **Punctuated change:** collapse events reshape structure.
- **Shutdown:** excessive constraint or weak drive stalls dynamics.

Structure persists only in a bounded region of parameter space.

## TODO

- Run automated parameter sweeps to map regimes and show phase diagrams.
- Define measurable outputs.

## Notes

This is an experimental hypothesis; outputs may include numerical artifacts.

## How to run

This project uses ES modules, so you need to serve it over `http://` (opening the HTML file via `file://` will be blocked by CORS).

From the project root, run:

```sh
python3 -m http.server 8000
```

Then open in your browser:

```
http://localhost:8000/index.html
```

If you prefer a different port, adjust the `8000` above.

Open the HTML file in a browser:

- `index.html`

No build step or dependencies required.

## Diagram



```text
SYSTEM LOOP

Sun drive (moving band)
  │
  ▼
ENERGY (E)
  • injected + evaporates
  • diffuses (slowed by sigma)
  │
  ▼
Gradients / flux ──> FLUX > θ ?
                        │
                        ▼
                 INFORMATION (I)
                  • created from flux
                  • costs energy
                  • decays
                        │
        ┌───────────────┼───────────────┐
        │                               │
     I ≥ σ_on                        I ≤ σ_off
        │                               │
        ▼                               ▼
    sigma rises                     sigma falls
        │                               │
        └───────────────┬───────────────┘
                        ▼
                     SIGMA (σ)
                        │
                        └─ slows diffusion (feeds back to gradients)

If I ≥ collapse_I or E very low:
  COLLAPSE → release energy + jitter → neighbors → new gradients

KEY FEEDBACK LOOPS
Positive: flux → I → σ → holds gradients → flux
Negative: I maintenance drains E → E drops → collapse
Reset:    collapse → energy + noise → new patterns

TOPOLOGY-AGNOSTIC
Works on: hex sphere, Fibonacci, grid, torus
Only neighbor graph changes; rules stay the same
```

Summary of causal flow:

Drive → E gradients
Gradients → flux → I created (costs E)
I → σ via hysteresis (I ≥ on → σ↑, I ≤ off → σ↓)
σ → slows diffusion → preserves gradients → sustains flux
I maintenance + decay drains E over time
Collapse (I or E critical) → release σ as E + jitter → reset → new gradients

This creates self-organizing criticality: structure emerges, persists under drive, then collapses and reorganizes with novelty.



## Main Equations and Knobs

Main equations (with meaning):

Sun drive + evaporation:

```text
inject = sun_strength * exp(-0.5 * ((lat - bandCenterLat) / sun_width)^2) * (0.65 + 0.35 * sin(2π * (lon_norm + wobble)))
dE += inject - evaporation * E
```

Symmetric diffusion (local energy balance):

```text
flow = diffusion * 0.5 * (slow_i + slow_j) * (E[j] - E[i])
E[i] += flow
E[j] -= flow
slow_i = sigma_slow + 2 * (1 - sigma_slow) * sigma_i
```

State update (after accumulating dE, dI):

```text
E[i] += dE[i] * dt
I[i] = max(0, I[i] + dI[i] * dt)
```

Flux -> information (with energy cost):

```text
flux_i = (1 / deg_i) * Σ_j |E[j] - E[i]|
gain = info_gain * max(0, flux_i - info_threshold)
I += gain
E -= info_energy_cost * gain
```

Information decay + maintenance:

```text
fluxSupport = sigma_i * clamp01(flux_i / (info_threshold + ε))
dI -= info_decay * I * (1 - 0.6 * fluxSupport)
dE -= info_cost * I * (1 - 0.6 * fluxSupport)
```

Sigma hysteresis:

```text
if I >= sigma_on:  sigma += relaxRate
if I <= sigma_off: sigma -= relaxRate
sigma = clamp01(sigma)
```

Collapse (novelty):

```text
release = collapse_fraction * I * info_energy_cost
E[j] += release * weight_j / Σ weight
E[i] -= release
I[i] *= 0.25
if I[i] < sigma_off: sigma[i] *= 0.5
```

Collapse jitter:

```text
weight_j *= 1 + jitter * (rng() - 0.5)
```

Collapse weights (base term):

```text
weight_j = (0.6 + 0.8 * sigma_j) * jitter
```

Noise (flux-gated):

```text
gate = clamp01((flux - info_threshold) / (info_threshold + ε))
dE += noise_floor * (rng() - 0.5) * gate^4
```

Implementation notes:

- Collapse triggers only when I >= collapse_I.
- Flux is accumulated once per undirected edge (j <= i is skipped), then averaged per node.
- Integration is explicit Euler with per-step accumulators (dE, dI).

Knobs (controls):

- Energy flow: diffusion, sigma_slow (mobility floor), evaporation
- Information: info_gain, info_threshold, info_decay, info_cost, info_energy_cost
- Sigma hysteresis: sigma_on, sigma_off
- Collapse: collapse_I, collapse_fraction, jitter
- Sun drive: sun_strength, sun_width, sun_speed, sun_lat_bias, sun_lon_wobble
- Noise: noise_floor
