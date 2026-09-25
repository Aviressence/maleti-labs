// Simulation parameters: defaults, limits, and the one function every piece of
// untrusted input goes through before the app touches it.
//
// "Untrusted" means anything the app did not just build itself: a shared link
// (anyone can hand-craft the #s= fragment), localStorage, and typed text fields.
// Every value is type-checked and clamped to a range the GPU can survive, and
// images may only point at the bundled assets (or, locally, at an uploaded
// data:image URL) - never at an arbitrary web address.
'use strict'

const STORAGE_KEY = 'wave-simulator-remastered'
const MAX_ZOOM = 20
/** Largest uploaded image we accept, in bytes of data URL. */
const MAX_UPLOAD_CHARS = 20 * 1024 * 1024

const WaveType = Object.freeze({ Plane: 0, Pulse: 1, Spherical: 2, Interactive: 3, PhasedArray: 4 })

/** [min, max] for every free numeric field. Sliders use the same numbers. */
const LIMITS = Object.freeze({
  amplitude: [-100, 100],
  frequency: [0, 10],
  sharpness: [0.001, 100],
  duration: [0, 100000],
  aCeil: [0, 1],
  /** Rendered video length; 140 s is the longest video X/Twitter accepts. */
  seconds: [1, 140],
  phasedArray: {
    count: [1, 16],
    spacing: [0.1, 2],
    angle: [0, 180],
    steer: [-90, 90],
    phase: [-360, 360]
  },
  shape: {
    sides: [3, 12],
    size: [0.05, 1.4],
    stretch: [0.1, 2],
    rotation: [0, 360],
    alpha: [0.05, 1],
    thickness: [0.005, 0.2],
    innerRatio: [0.1, 0.9],
    slitCount: [1, 8],
    slitWidth: [0.005, 0.15],
    slitSpacing: [0.02, 0.5]
  }
})

const LOD_VALUES = [1, 2, 2.8, 3]
const SPEED_VALUES = [1, 3, 8]
const SHAPE_KINDS = ['polygon', 'star', 'circle', 'ellipse', 'slits']
const GRID_COLORS = ['white', 'black']

// ------------------------------------------------------------------ helpers

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

/** Coordinates are rounded to 4 decimals before being stored. */
function roundCoord(value) {
  return Math.round(value * 10000) / 10000
}

/** A finite number inside [min, max], or the fallback. */
function num(value, [min, max], fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? clamp(n, min, max) : fallback
}

function int(value, range, fallback) {
  return Math.round(num(value, range, fallback))
}

/** One of a fixed set of values, or the fallback. */
function oneOf(value, allowed, fallback) {
  const n = typeof value === 'string' && typeof allowed[0] === 'number' ? Number(value) : value
  return allowed.includes(n) ? n : fallback
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function coord(value, fallback) {
  return roundCoord(num(value, [0, 1], fallback))
}

// ----------------------------------------------------------------- defaults

function defaultInitialCondition(type) {
  const base = {
    type: type,
    direction: 0,
    shape: 0,
    x: 0.5,
    y: 0.5,
    amplitude: 10,
    frequency: 0.05,
    sharpness: 1,
    duration: 800
  }
  switch (type) {
    case WaveType.Plane: return { ...base, amplitude: 0.7, frequency: 0.05, duration: 800 }
    case WaveType.Spherical: return { ...base, amplitude: 10, frequency: 0.04, duration: 1000 }
    // Long enough for the beam to form and cross the screen.
    case WaveType.PhasedArray: return { ...base, amplitude: 10, frequency: 0.04, duration: 4000 }
    default: return base
  }
}

/** Switching wave type keeps the position the user already chose. */
function switchWaveType(current, type) {
  const next = defaultInitialCondition(type)
  next.x = current.x
  next.y = current.y
  return next
}

/**
 * The grid is built outwards from the centre, so an even number of cells is
 * what makes the shorter axis land exactly on both edges *and* keeps a line on
 * the centre line - where the default source and every shape sit.
 */
function normaliseDivisions(divisions) {
  const even = Math.round(Number(divisions) / 2) * 2
  return clamp(Number.isFinite(even) ? even : 12, 2, 60)
}

/** Keeps the visible region inside the domain. */
function clampView(view) {
  const zoom = num(view.zoom, [1, MAX_ZOOM], 1)
  const half = 0.5 / zoom
  return {
    zoom: zoom,
    centreX: num(view.centreX, [half, 1 - half], 0.5),
    centreY: num(view.centreY, [half, 1 - half], 0.5)
  }
}

function makeDefaultParameters(isMobile) {
  return {
    pause: false,
    nextFrame: 0,
    showGradient: true,
    toolbarSide: 'left',
    LOD: isMobile ? 3 : 2,
    energy: false,
    boundary: 0,
    initialCondition: defaultInitialCondition(WaveType.Plane),
    grid: { show: false, snap: true, divisions: 12, color: 'white' },
    phasedArray: defaultPhasedArray(),
    video: { seconds: 10, fps: 60, speed: 1, fromStart: true },
    view: { zoom: 1, centreX: 0.5, centreY: 0.5 },
    aCeil: 1,
    speedDivider: 1
    // backgroundShape / backgroundImage / gradientImage are optional:
    // with none set, the default Lens image and Blue White Red gradient apply.
  }
}

function defaultShape(kind) {
  const base = {
    kind: kind,
    sides: 6,
    size: 0.5,
    stretch: 0.6,
    rotation: 0,
    x: 0.5,
    y: 0.5,
    alpha: 1,
    // Outlines by default: the drawn pixels are the wall, so the shape is a
    // cavity the wave can live inside rather than a solid block.
    hollow: true,
    thickness: 0.02,
    invert: false,
    innerRatio: 0.45,
    slitCount: 2,
    slitWidth: 0.035,
    slitSpacing: 0.16
  }
  switch (kind) {
    case 'slits': return { ...base, x: 0.35, size: 1, hollow: false, thickness: 0.02 }
    case 'ellipse': return { ...base, stretch: 0.55 }
    case 'star': return { ...base, sides: 5, innerRatio: 0.45 }
    default: return base
  }
}

// ------------------------------------------------------------------- images

/**
 * An image reference is either a bundled asset (`asset:<key>`) or, for local
 * use only, an uploaded `data:image/...` URL. Anything else is dropped, which
 * is what stops a shared link from making the browser fetch a remote URL.
 */
function sanitizeImage(ref, group, allowUploads) {
  if (!ref || typeof ref !== 'object' || typeof ref.src !== 'string') {
    return undefined
  }
  const src = ref.src
  if (src.startsWith('asset:')) {
    const key = src.slice(6)
    const asset = Object.prototype.hasOwnProperty.call(ASSETS[group], key) ? ASSETS[group][key] : null
    return asset ? { src: src, name: asset.name } : undefined
  }
  if (allowUploads && isUploadSrc(src)) {
    const name = typeof ref.name === 'string' ? ref.name.slice(0, 80) : 'Uploaded image'
    return { src: src, name: name }
  }
  return undefined
}

function isUploadSrc(src) {
  return typeof src === 'string' &&
    /^data:image\/(png|jpeg|gif|webp|bmp);base64,/.test(src) &&
    src.length <= MAX_UPLOAD_CHARS
}

/** The URL an image reference actually loads from. */
function resolveImageSrc(ref, group) {
  if (ref && ref.src.startsWith('asset:')) {
    const asset = ASSETS[group][ref.src.slice(6)]
    if (asset) return asset.src
  }
  if (ref && isUploadSrc(ref.src)) {
    return ref.src
  }
  const first = Object.values(ASSETS[group])[0]
  return first.src
}

// ------------------------------------------------------------- sanitising

function sanitizeInitialCondition(raw) {
  const type = oneOf(raw?.type, [0, 1, 2, 3, 4], WaveType.Plane)
  const d = defaultInitialCondition(type)
  if (!raw || typeof raw !== 'object') {
    return d
  }
  return {
    type: type,
    direction: oneOf(raw.direction, [0, 1, 2, 3], d.direction),
    shape: oneOf(raw.shape, [0, 1, 2], d.shape),
    x: coord(raw.x, d.x),
    y: coord(raw.y, d.y),
    amplitude: num(raw.amplitude, LIMITS.amplitude, d.amplitude),
    frequency: num(raw.frequency, LIMITS.frequency, d.frequency),
    sharpness: num(raw.sharpness, LIMITS.sharpness, d.sharpness),
    duration: num(raw.duration, LIMITS.duration, d.duration)
  }
}

function sanitizeShape(raw) {
  if (!raw || typeof raw !== 'object' || !SHAPE_KINDS.includes(raw.kind)) {
    return undefined
  }
  const d = defaultShape(raw.kind)
  const L = LIMITS.shape
  return {
    kind: raw.kind,
    sides: int(raw.sides, L.sides, d.sides),
    size: num(raw.size, L.size, d.size),
    stretch: num(raw.stretch, L.stretch, d.stretch),
    rotation: num(raw.rotation, L.rotation, d.rotation),
    x: coord(raw.x, d.x),
    y: coord(raw.y, d.y),
    alpha: num(raw.alpha, L.alpha, d.alpha),
    hollow: bool(raw.hollow, d.hollow),
    thickness: num(raw.thickness, L.thickness, d.thickness),
    invert: bool(raw.invert, d.invert),
    innerRatio: num(raw.innerRatio, L.innerRatio, d.innerRatio),
    slitCount: int(raw.slitCount, L.slitCount, d.slitCount),
    slitWidth: num(raw.slitWidth, L.slitWidth, d.slitWidth),
    slitSpacing: num(raw.slitSpacing, L.slitSpacing, d.slitSpacing)
  }
}

function sanitizeVideo(raw, d) {
  if (!raw || typeof raw !== 'object') {
    return { ...d }
  }
  return {
    seconds: num(raw.seconds, LIMITS.seconds, d.seconds),
    fps: oneOf(raw.fps, [30, 60], d.fps),
    speed: oneOf(raw.speed, [1, 2, 4], d.speed),
    fromStart: bool(raw.fromStart, d.fromStart)
  }
}

/**
 * Builds a complete, valid parameter set out of anything. Unknown keys are
 * dropped rather than copied, so nothing unexpected can ride along.
 *
 * @param {any} raw  parsed JSON from a link or from storage
 * @param {{isMobile: boolean, allowUploads: boolean}} options
 */
function sanitizeParameters(raw, options) {
  const d = makeDefaultParameters(options.isMobile)
  if (!raw || typeof raw !== 'object') {
    return d
  }
  const grid = raw.grid && typeof raw.grid === 'object' ? raw.grid : {}
  const out = {
    pause: false,
    nextFrame: 0,
    showGradient: bool(raw.showGradient, d.showGradient),
    toolbarSide: raw.toolbarSide === 'right' ? 'right' : 'left',
    LOD: options.isMobile ? 3 : oneOf(raw.LOD, LOD_VALUES, d.LOD),
    energy: bool(raw.energy, d.energy),
    boundary: oneOf(raw.boundary, [0, 1, 2], d.boundary),
    initialCondition: sanitizeInitialCondition(raw.initialCondition),
    grid: {
      show: bool(grid.show, d.grid.show),
      snap: bool(grid.snap, d.grid.snap),
      divisions: normaliseDivisions(grid.divisions ?? d.grid.divisions),
      color: oneOf(grid.color, GRID_COLORS, d.grid.color)
    },
    phasedArray: sanitizePhasedArray(raw.phasedArray),
    video: sanitizeVideo(raw.video, d.video),
    view: clampView(raw.view && typeof raw.view === 'object' ? raw.view : d.view),
    aCeil: num(raw.aCeil, LIMITS.aCeil, d.aCeil),
    speedDivider: oneOf(raw.speedDivider, SPEED_VALUES, d.speedDivider)
  }
  const shape = sanitizeShape(raw.backgroundShape)
  if (shape) {
    out.backgroundShape = shape
  } else {
    const bg = sanitizeImage(raw.backgroundImage, 'backgrounds', options.allowUploads)
    if (bg) out.backgroundImage = bg
  }
  const gradient = sanitizeImage(raw.gradientImage, 'gradients', options.allowUploads)
  if (gradient) out.gradientImage = gradient
  return out
}
