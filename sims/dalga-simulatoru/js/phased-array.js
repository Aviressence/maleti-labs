// Multiple emitters with individual phase offsets - a phased array.
// Idea from starrfree/wave-simulator issue #2 (see CREDITS.md).
//
// Two modes:
//  - linear: N elements on a line, evenly spaced in wavelengths. The phases
//    are derived from a steering angle so the main beam points that way.
//  - custom: a free list of sources, each with its own position and phase.
//
// The geometry of a linear array is computed in *cells* rather than
// normalised coordinates, because cells are square while normalised x and y
// are not (x runs across the width, y across the height).
'use strict'

const MAX_SOURCES = 16
/** Distance a wave travels per simulation step, in cells: c * dt / dx = 0.7. */
const WAVE_SPEED = 0.7

function defaultPhasedArray() {
  return {
    mode: 'linear',
    count: 8,
    /** Element spacing, in wavelengths. Half a wavelength avoids grating lobes. */
    spacing: 0.5,
    /** Direction of the array's own axis, degrees counter-clockwise from +x. */
    angle: 90,
    /** Beam direction relative to broadside, degrees. */
    steer: 0,
    /** Array centre, normalised. */
    x: 0.2,
    y: 0.5,
    /** Custom mode only: { x, y, phase (degrees) }. */
    sources: []
  }
}

function sanitizePhasedArray(raw) {
  const d = defaultPhasedArray()
  if (!raw || typeof raw !== 'object') {
    return d
  }
  const L = LIMITS.phasedArray
  const sources = Array.isArray(raw.sources) ? raw.sources.slice(0, MAX_SOURCES) : []
  return {
    mode: raw.mode === 'custom' ? 'custom' : 'linear',
    count: int(raw.count, L.count, d.count),
    spacing: num(raw.spacing, L.spacing, d.spacing),
    angle: num(raw.angle, L.angle, d.angle),
    steer: num(raw.steer, L.steer, d.steer),
    x: coord(raw.x, d.x),
    y: coord(raw.y, d.y),
    sources: sources
      .filter(s => s && typeof s === 'object')
      .map(s => ({ x: coord(s.x, 0.5), y: coord(s.y, 0.5), phase: num(s.phase, L.phase, 0) }))
  }
}

/** Wavelength in cells for a given source frequency. */
function wavelengthCells(frequency, LOD) {
  // The source oscillates as cos(step * frequency * LOD), i.e. with angular
  // frequency frequency * LOD per step.
  const omega = frequency * LOD
  return omega > 0 ? (2 * Math.PI * WAVE_SPEED) / omega : Infinity
}

/**
 * Every emitter as { x, y (normalised), phase (radians) }.
 *
 * @param {number} width   simulation grid width in cells
 * @param {number} height  simulation grid height in cells
 */
function phasedArraySources(params, width, height) {
  const pa = params.phasedArray
  if (pa.mode === 'custom') {
    return pa.sources.map(s => ({ x: s.x, y: s.y, phase: (s.phase * Math.PI) / 180 }))
  }

  const ic = params.initialCondition
  let lambda = wavelengthCells(ic.frequency, params.LOD)
  // Frequency 0 has no wavelength: keep the layout sensible, drop the steering.
  const steerable = Number.isFinite(lambda)
  if (!steerable) {
    lambda = wavelengthCells(0.04, params.LOD)
  }
  const spacing = pa.spacing * lambda
  const k = (2 * Math.PI) / lambda

  const axis = (pa.angle * Math.PI) / 180
  const ux = Math.cos(axis)
  const uy = Math.sin(axis)
  // Broadside is the axis turned clockwise by 90 degrees: a vertical array
  // (angle 90) fires to the right. Steering turns it counter-clockwise.
  const beam = axis - Math.PI / 2 + (pa.steer * Math.PI) / 180
  const alongBeam = ux * Math.cos(beam) + uy * Math.sin(beam)

  const cx = pa.x * width
  const cy = pa.y * height
  const out = []
  for (let n = 0; n < pa.count; n++) {
    const offset = (n - (pa.count - 1) / 2) * spacing
    out.push({
      x: (cx + offset * ux) / width,
      y: (cy + offset * uy) / height,
      // Elements further along the beam fire later, so every wavefront lines
      // up perpendicular to the beam: phase = -k * (position . beam).
      phase: steerable ? -k * offset * alongBeam : 0
    })
  }
  return out
}
