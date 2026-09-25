// The simulation canvas: WebGL ping-pong between two float textures, plus the
// DOM overlay (grid, source marker, coordinate readout, gradient legend).
//
// Nothing here re-renders on its own schedule except the WebGL loop. The
// overlay is updated by calling refreshOverlay(), which the app does after
// every change - there is no change detection to fall out of sync.
'use strict'

/** Simulation cells across the wider axis at LOD 1. */
const BASE_RESOLUTION = 3000
/** Upper bound on total cells, so an extreme window shape cannot melt the GPU. */
const MAX_CELLS = 6000000
/** How long the display size must hold still before the GPU resources rebuild. */
const RESIZE_SETTLE_MS = 180

const SVG_NS = 'http://www.w3.org/2000/svg'

class SceneCanvas {
  /**
   * @param {HTMLElement} root  the #scene element from index.html
   * @param {() => any} getParams  always returns the live parameter object
   * @param {{sourceMoved: () => void, viewChanged: () => void, resized?: () => void}} events
   */
  constructor(root, getParams, events) {
    this.getParams = getParams
    this.events = events

    this.canvas = root.querySelector('canvas')
    this.gridSvg = root.querySelector('.grid-overlay')
    this.marker = root.querySelector('.source-marker')
    this.arrayMarkers = root.querySelector('.array-markers')
    this.readoutEl = root.querySelector('.coord-readout')
    this.legend = root.querySelector('.gradient-legend')

    this.gl = null
    this.programs = null
    this.quad = null
    this.textures = { textures: [], frameBuffers: [], background: null, gradient: null }
    this.textureOffset = 0
    this.step = 0
    this.renders = 0
    this.resetPending = false
    this.screenshotPending = false
    this.touch = { active: false, position: [0, 0] }

    this.lastSize = null
    this.sizeSettledAt = null
    this.appliedSize = null

    this.ctrlHeld = false
    this.dragging = false
    /** The object with x/y that the current left-drag moves. */
    this.dragTarget = null
    this.panning = false
    this.panOrigin = null
    /** Last pointer position in simulation coordinates, for the readout. */
    this.pointer = null

    this.backgroundKey = ''
    this.gradientKey = ''
    this.gridKey = ''
    /** Decoded bitmaps, keyed by src, so a resize does not decode them again. */
    this.imageCache = new Map()
    this.video = new VideoRecorder()
    /** True while a video render owns the simulation. */
    this.rendering = false

    this.bindEvents()
  }

  get params() {
    return this.getParams()
  }

  // ------------------------------------------------------------ geometry

  get view() {
    return this.params.view
  }

  /** Wave types whose source sits at a point the user can drag. */
  get isPositionable() {
    const type = this.params.initialCondition.type
    return type === WaveType.Pulse || type === WaveType.Spherical
  }

  get isPhased() {
    return this.params.initialCondition.type === WaveType.PhasedArray
  }

  get isInteractive() {
    return this.params.initialCondition.type === WaveType.Interactive
  }

  /** The grid also appears on demand while Ctrl snaps the interactive pulse. */
  get showGrid() {
    return this.params.grid.show || (this.ctrlHeld && this.isInteractive)
  }

  get displayAspect() {
    const el = this.canvas
    if (!el.clientWidth || !el.clientHeight) {
      return 1.5
    }
    return el.clientWidth / el.clientHeight
  }

  /**
   * Cell size in normalised coordinates. Cells are always square in pixels and
   * `divisions` counts them across the shorter axis, so the shorter axis always
   * divides exactly and the longer one simply gets more cells.
   */
  get gridStep() {
    const divisions = normaliseDivisions(this.params.grid.divisions)
    const aspect = this.displayAspect
    return aspect >= 1
      ? { x: 1 / (divisions * aspect), y: 1 / divisions }
      : { x: 1 / divisions, y: aspect / divisions }
  }

  /**
   * Lines are laid out from the middle outwards, which keeps them symmetric
   * and guarantees a line through the centre. Returned in screen space so they
   * follow zoom and pan.
   */
  lineOffsets(step, viewCentre) {
    const lines = []
    if (!(step > 0.0005)) {
      return lines
    }
    const zoom = this.view.zoom
    const count = Math.ceil(0.5 / step) + 1
    for (let k = -count; k <= count; k++) {
      const value = 0.5 + k * step
      if (value < -0.0001 || value > 1.0001) {
        continue
      }
      const screen = (value - viewCentre) * zoom + 0.5
      if (screen >= -0.001 && screen <= 1.001) {
        lines.push(screen)
      }
    }
    return lines
  }

  /** Snapping is measured from the centre, to match how the lines are drawn. */
  snapPoint(point) {
    const step = this.gridStep
    const snap = (value, s) => clamp01(roundCoord(0.5 + Math.round((value - 0.5) / s) * s))
    return { x: snap(point.x, step.x), y: snap(point.y, step.y) }
  }

  /** Screen position to simulation coordinates, through the view transform. */
  toSimCoords(event) {
    const rect = this.canvas.getBoundingClientRect()
    const screenX = (event.clientX - rect.left) / rect.width
    const screenY = 1 - (event.clientY - rect.top) / rect.height
    const zoom = this.view.zoom
    return {
      x: clamp01((screenX - 0.5) / zoom + this.view.centreX),
      y: clamp01((screenY - 0.5) / zoom + this.view.centreY)
    }
  }

  // ------------------------------------------------------------- overlay

  refreshOverlay() {
    const params = this.params
    const view = this.view

    // Grid: only rebuilt when the set of lines actually changes.
    if (this.showGrid) {
      const step = this.gridStep
      const xs = this.lineOffsets(step.x, view.centreX)
      const ys = this.lineOffsets(step.y, view.centreY)
      const key = xs.join(',') + '|' + ys.join(',')
      if (key !== this.gridKey) {
        this.gridKey = key
        this.gridSvg.replaceChildren(
          ...xs.map(x => this.svgLine(x, 0, x, 1)),
          ...ys.map(y => this.svgLine(0, y, 1, y))
        )
      }
      // SVG elements have no .hidden property; the attribute works on both.
      this.gridSvg.removeAttribute('hidden')
      this.gridSvg.classList.toggle('dark', params.grid.color === 'black')
    } else {
      this.gridSvg.setAttribute('hidden', '')
    }

    // Source marker. CSS y grows downward, ours upward.
    this.marker.hidden = !this.isPositionable
    if (this.isPositionable) {
      const ic = params.initialCondition
      this.marker.style.left = `${((ic.x - view.centreX) * view.zoom + 0.5) * 100}%`
      this.marker.style.top = `${(1 - ((ic.y - view.centreY) * view.zoom + 0.5)) * 100}%`
      this.marker.classList.toggle('dragging', this.dragging)
    }
    this.refreshArrayMarkers()
    this.canvas.classList.toggle('grabbable', this.isPositionable || this.isPhased)

    // Readout.
    const p = this.pointer
    if (p) {
      const zoom = view.zoom > 1.005 ? `   ${view.zoom.toFixed(2)}x` : ''
      this.readoutEl.textContent = `x ${p.x.toFixed(3)}   y ${p.y.toFixed(3)}${zoom}`
      this.readoutEl.hidden = false
    } else {
      this.readoutEl.hidden = true
    }

    // Gradient legend.
    this.legend.hidden = !params.showGradient
    const gradientSrc = resolveImageSrc(params.gradientImage, 'gradients')
    if (this.legend.getAttribute('src') !== gradientSrc) {
      this.legend.src = gradientSrc
    }
  }

  /** Simulation coordinates to CSS left/top percentages. */
  toScreenPercent(x, y) {
    const view = this.view
    return {
      left: ((x - view.centreX) * view.zoom + 0.5) * 100,
      top: (1 - ((y - view.centreY) * view.zoom + 0.5)) * 100
    }
  }

  /** One small marker per phased-array element, numbered in custom mode. */
  refreshArrayMarkers() {
    const box = this.arrayMarkers
    if (!this.isPhased) {
      box.hidden = true
      return
    }
    box.hidden = false
    const pa = this.params.phasedArray
    const sources = phasedArraySources(this.params, this.canvas.width, this.canvas.height)
    while (box.children.length > sources.length) {
      box.lastChild.remove()
    }
    while (box.children.length < sources.length) {
      const marker = document.createElement('div')
      marker.className = 'array-marker'
      box.appendChild(marker)
    }
    sources.forEach((source, i) => {
      const marker = box.children[i]
      const pos = this.toScreenPercent(source.x, source.y)
      marker.style.left = `${pos.left}%`
      marker.style.top = `${pos.top}%`
      marker.textContent = pa.mode === 'custom' ? `${i + 1}` : ''
      marker.classList.toggle('dragging', this.dragging && this.dragTarget === pa.sources[i])
    })
  }

  svgLine(x1, y1, x2, y2) {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('x1', x1)
    line.setAttribute('y1', y1)
    line.setAttribute('x2', x2)
    line.setAttribute('y2', y2)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    return line
  }

  // ------------------------------------------------------------- pointer

  bindEvents() {
    const c = this.canvas
    c.addEventListener('pointerdown', e => this.onPointerDown(e))
    c.addEventListener('pointermove', e => this.onPointerMove(e))
    c.addEventListener('pointerup', e => this.onPointerUp(e))
    c.addEventListener('pointerleave', () => { this.pointer = null; this.refreshOverlay() })
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false })
    c.addEventListener('dblclick', () => this.resetView())
    c.addEventListener('contextmenu', e => e.preventDefault())
    window.addEventListener('keydown', e => {
      if (e.key === 'Control' && !this.ctrlHeld) { this.ctrlHeld = true; this.refreshOverlay() }
    })
    window.addEventListener('keyup', e => {
      if (e.key === 'Control' && this.ctrlHeld) { this.ctrlHeld = false; this.refreshOverlay() }
    })
    window.addEventListener('blur', () => {
      if (this.ctrlHeld) { this.ctrlHeld = false; this.refreshOverlay() }
    })
  }

  onPointerDown(event) {
    // Middle or right button, or Shift with the left button, pans the view.
    if (event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey)) {
      event.preventDefault()
      this.panning = true
      this.panOrigin = {
        clientX: event.clientX,
        clientY: event.clientY,
        centreX: this.view.centreX,
        centreY: this.view.centreY
      }
      this.canvas.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) {
      return
    }
    this.dragTarget = this.dragTargetAt(event)
    if (!this.dragTarget) {
      return
    }
    this.dragging = true
    this.canvas.setPointerCapture(event.pointerId)
    this.moveSource(event, false)
  }

  /**
   * What a left-click grabs: the single source, the whole linear array (its
   * centre jumps to the pointer, like the single source does), or in custom
   * mode the nearest element within reach.
   */
  dragTargetAt(event) {
    if (this.isPositionable) {
      return this.params.initialCondition
    }
    if (!this.isPhased) {
      return null
    }
    const pa = this.params.phasedArray
    if (pa.mode === 'linear') {
      return pa
    }
    const rect = this.canvas.getBoundingClientRect()
    let best = null
    let bestDistance = 18
    for (const source of pa.sources) {
      const pos = this.toScreenPercent(source.x, source.y)
      const distance = Math.hypot(
        rect.left + (pos.left / 100) * rect.width - event.clientX,
        rect.top + (pos.top / 100) * rect.height - event.clientY
      )
      if (distance < bestDistance) {
        best = source
        bestDistance = distance
      }
    }
    return best
  }

  onPointerMove(event) {
    if (this.panning && this.panOrigin) {
      const rect = this.canvas.getBoundingClientRect()
      const zoom = this.view.zoom
      const dx = (event.clientX - this.panOrigin.clientX) / rect.width / zoom
      const dy = (event.clientY - this.panOrigin.clientY) / rect.height / zoom
      this.params.view = clampView({
        zoom: zoom,
        centreX: this.panOrigin.centreX - dx,
        centreY: this.panOrigin.centreY + dy
      })
      this.refreshOverlay()
      return
    }
    let point = this.toSimCoords(event)
    if (this.shouldSnap()) {
      point = this.snapPoint(point)
    }
    this.pointer = point
    if (this.dragging) {
      this.moveSource(event, false)
    }
    this.refreshOverlay()
  }

  onPointerUp(event) {
    if (this.panning) {
      this.panning = false
      this.panOrigin = null
      this.releaseCapture(event.pointerId)
      this.events.viewChanged()
      return
    }
    if (this.dragging) {
      this.dragging = false
      this.releaseCapture(event.pointerId)
      // Restart the simulation once, at the end of the drag.
      this.moveSource(event, true)
      this.dragTarget = null
      this.refreshOverlay()
      return
    }
    if (this.isInteractive && event.button === 0) {
      let point = this.toSimCoords(event)
      if (this.shouldSnap()) {
        point = this.snapPoint(point)
      }
      this.touch.active = true
      this.touch.position = [point.x, point.y]
    }
  }

  /** Wheel zooms about the cursor, so the point under it stays put. */
  onWheel(event) {
    event.preventDefault()
    const before = this.toSimCoords(event)
    const factor = Math.exp(-event.deltaY * 0.0015)
    const zoom = clamp(this.view.zoom * factor, 1, MAX_ZOOM)
    const rect = this.canvas.getBoundingClientRect()
    const screenX = (event.clientX - rect.left) / rect.width
    const screenY = 1 - (event.clientY - rect.top) / rect.height
    this.params.view = clampView({
      zoom: zoom,
      centreX: before.x - (screenX - 0.5) / zoom,
      centreY: before.y - (screenY - 0.5) / zoom
    })
    this.refreshOverlay()
    this.events.viewChanged()
  }

  resetView() {
    this.params.view = { zoom: 1, centreX: 0.5, centreY: 0.5 }
    this.refreshOverlay()
    this.events.viewChanged()
  }

  releaseCapture(pointerId) {
    try {
      this.canvas.releasePointerCapture(pointerId)
    } catch { /* already released */ }
  }

  /** Ctrl snaps the interactive pulse; dragging uses the toolbar's snap setting. */
  shouldSnap() {
    if (this.isInteractive) {
      return this.ctrlHeld
    }
    return (this.isPositionable || this.isPhased) && this.params.grid.snap
  }

  moveSource(event, commit) {
    let point = this.toSimCoords(event)
    point = this.params.grid.snap
      ? this.snapPoint(point)
      : { x: roundCoord(point.x), y: roundCoord(point.y) }
    const target = this.dragTarget
    if (!target || (target.x === point.x && target.y === point.y && !commit)) {
      return
    }
    target.x = point.x
    target.y = point.y
    this.refreshOverlay()
    if (commit) {
      this.events.sourceMoved()
      this.restart()
    }
  }

  // ------------------------------------------------------- public actions

  /** Restarts the simulation from step 0 on the next frame. */
  restart() {
    this.resetPending = true
  }

  /** The background description changed; rebuild its texture. */
  rebuildBackground() {
    this.backgroundKey = ''
    if (this.gl) {
      this.updateBackground(this.canvas.width, this.canvas.height)
    }
    this.params.nextFrame++
  }

  rebuildGradient() {
    this.gradientKey = ''
    if (this.gl) {
      this.updateGradient()
    }
    this.params.nextFrame++
    this.refreshOverlay()
  }

  /**
   * A WebGL drawing buffer is cleared once the frame is presented, so the
   * capture has to happen right after a draw. The render loop consumes this.
   */
  requestScreenshot() {
    this.screenshotPending = true
    this.params.nextFrame = Math.max(this.params.nextFrame, 1)
  }

  // ------------------------------------------------------------ WebGL setup

  /** Returns an error message, or null when the GPU side is ready. */
  start() {
    const gl = this.canvas.getContext('webgl2')
    if (!gl) {
      return 'WebGL 2 is not available. Your browser or graphics driver may not support it.'
    }
    // Rendering into RGBA32F textures - which the whole simulation does -
    // needs this extension.
    if (!gl.getExtension('EXT_color_buffer_float')) {
      return 'This GPU cannot render to float textures (EXT_color_buffer_float is missing).'
    }
    this.gl = gl

    const compute = this.createProgram(SHADERS.vertex, SHADERS.compute)
    const render = this.createProgram(SHADERS.vertex, SHADERS.render)
    if (!compute || !render) {
      return 'The shaders failed to compile. See the browser console for details.'
    }
    const uniforms = (program, names) => {
      const out = {}
      for (const [key, name] of Object.entries(names)) {
        out[key] = gl.getUniformLocation(program, name)
      }
      return out
    }
    this.programs = {
      compute: {
        program: compute,
        position: gl.getAttribLocation(compute, 'i_VertexPosition'),
        u: uniforms(compute, {
          step: 'u_Step', width: 'u_Width', height: 'u_Height', boundary: 'u_Boundary',
          initialCondition: 'u_InitCondition', direction: 'u_Direction', shape: 'u_Shape',
          sourceX: 'u_SourceX', sourceY: 'u_SourceY', amplitude: 'u_Amplitude',
          frequency: 'u_Frequency', sharpness: 'u_Sharpness', duration: 'u_Duration',
          aCeil: 'aCeil', texture: 'u_Texture', backgroundTexture: 'u_Background_Texture',
          LOD: 'u_LOD', touchIsActive: 'u_touchIsActive',
          sources: 'u_Sources', sourceCount: 'u_SourceCount'
        })
      },
      render: {
        program: render,
        position: gl.getAttribLocation(render, 'i_VertexPosition'),
        u: uniforms(render, {
          step: 'u_Step', width: 'u_Width', height: 'u_Height', energy: 'u_Energy',
          zoom: 'u_Zoom', viewCentre: 'u_ViewCentre', texture: 'u_Texture',
          backgroundTexture: 'u_Background_Texture', gradientTexture: 'u_Gradient_Texture'
        })
      }
    }

    // One full-screen quad, drawn as a triangle strip.
    this.quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, -1, 1, 1, -1, -1, -1]), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)

    this.resize()
    requestAnimationFrame(t => this.frame(t))
    return null
  }

  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl
    const compile = (type, source) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error: ' + gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, vertexSource)
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource)
    if (!vs || !fs) {
      return null
    }
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link error: ' + gl.getProgramInfoLog(program))
      return null
    }
    return program
  }

  /**
   * Sizes the simulation grid to the display's aspect ratio, so the domain
   * always fills the screen exactly, then restarts from step 0.
   */
  resize() {
    const gl = this.gl
    this.appliedSize = { width: this.canvas.clientWidth, height: this.canvas.clientHeight }
    let width = Math.max(2, Math.round(BASE_RESOLUTION / this.params.LOD))
    let height = Math.max(2, Math.round(width / this.displayAspect))
    // A very tall or wide window would ask for tens of millions of cells;
    // scale down uniformly instead, which keeps the cells square.
    const cells = width * height
    if (cells > MAX_CELLS) {
      const scale = Math.sqrt(MAX_CELLS / cells)
      width = Math.max(2, Math.round(width * scale))
      height = Math.max(2, Math.round(height * scale))
    }
    this.canvas.width = width
    this.canvas.height = height
    this.initTextures(width, height)
    this.step = 0
    gl.viewport(0, 0, width, height)
    this.params.pause = false
    this.gridKey = ''
    this.refreshOverlay()
    // The grid size feeds panel readouts (the phased-array wavelength).
    this.events.resized?.()
    if (this.textures.background && this.textures.gradient) {
      this.drawScene(1)
    }
  }

  /** Allocates the ping-pong pair, freeing the previous one. */
  initTextures(width, height) {
    const gl = this.gl
    this.textures.textures.forEach(t => gl.deleteTexture(t))
    this.textures.frameBuffers.forEach(f => gl.deleteFramebuffer(f))
    this.textures.textures = []
    this.textures.frameBuffers = []

    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null)
      this.setNearest()
      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      this.textures.textures.push(texture)
      this.textures.frameBuffers.push(fb)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    this.updateBackground(width, height)
    this.updateGradient()
  }

  /**
   * RGBA32F is not filterable without OES_texture_float_linear: a LINEAR
   * filter would make the texture incomplete and every sample would read as
   * alpha 1, turning the whole domain into a wall.
   */
  setNearest() {
    const gl = this.gl
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  uploadTexture(source) {
    const gl = this.gl
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, gl.RGBA, gl.FLOAT, source)
    this.setNearest()
    return texture
  }

  /**
   * Builds the obstacle map at the simulation's own resolution. Shapes are
   * drawn straight into it; bitmaps are scaled to fit and centred.
   */
  updateBackground(width, height) {
    const params = this.params
    const shape = params.backgroundShape
    const src = resolveImageSrc(params.backgroundImage, 'backgrounds')
    const key = shape
      ? `shape:${width}x${height}:${JSON.stringify(shape)}`
      : `image:${width}x${height}:${src.length}:${src.slice(-64)}`
    if (key === this.backgroundKey) {
      return
    }
    if (shape) {
      this.backgroundKey = key
      this.installBackground(Shapes.render(shape, width, height))
      return
    }
    this.loadImage(src, img => {
      // A slower decode may finish after the user picked something else.
      const now = this.params
      if (now.backgroundShape || resolveImageSrc(now.backgroundImage, 'backgrounds') !== src) {
        return
      }
      this.backgroundKey = key
      this.installBackground(Shapes.composite(img, width, height))
      this.params.nextFrame++
    })
  }

  installBackground(canvas) {
    const gl = this.gl
    const texture = this.uploadTexture(canvas)
    if (this.textures.background) {
      gl.deleteTexture(this.textures.background)
    }
    this.textures.background = texture
  }

  updateGradient() {
    const src = resolveImageSrc(this.params.gradientImage, 'gradients')
    if (src === this.gradientKey) {
      return
    }
    this.loadImage(src, img => {
      if (resolveImageSrc(this.params.gradientImage, 'gradients') !== src) {
        return
      }
      this.gradientKey = src
      const texture = this.uploadTexture(img)
      if (this.textures.gradient) {
        this.gl.deleteTexture(this.textures.gradient)
      }
      this.textures.gradient = texture
      this.params.nextFrame++
    })
  }

  loadImage(src, onLoad) {
    const cached = this.imageCache.get(src)
    if (cached && cached.complete && cached.naturalWidth > 0) {
      onLoad(cached)
      return
    }
    const image = cached ?? new Image()
    if (!cached) {
      this.imageCache.set(src, image)
      image.src = src
    }
    image.addEventListener('load', () => onLoad(image), { once: true })
  }

  // -------------------------------------------------------------- the loop

  frame(time) {
    requestAnimationFrame(t => this.frame(t))
    // A video render drives the simulation itself; stay out of its way.
    if (this.rendering) {
      return
    }
    const params = this.params
    if (this.resetPending) {
      this.resetPending = false
      this.resize()
    }
    // Until both images have decoded there is nothing sensible to simulate:
    // an unbound background samples as alpha 1, i.e. wall everywhere.
    const ready = this.textures.background && this.textures.gradient
    if (ready && ((!params.pause && this.renders % params.speedDivider === 0) || params.nextFrame > 0)) {
      this.drawScene(3)
      if (params.nextFrame > 0) {
        params.nextFrame--
      }
      if (this.screenshotPending) {
        // Same frame as the draw: the buffer is gone by the next one.
        this.captureScreenshot()
      }
      // Same reason: the video frame is copied right after the draw.
      this.video.frame(this.canvas)
    }
    this.renders++

    // Resizing rebuilds both float textures and restarts the simulation, so it
    // must not run on every frame of a panel slide or window drag: wait until
    // the size has held still for a moment.
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!this.lastSize || width !== this.lastSize.width || height !== this.lastSize.height) {
      this.lastSize = { width: width, height: height }
      this.sizeSettledAt = time
    } else if (this.sizeSettledAt != null && time - this.sizeSettledAt >= RESIZE_SETTLE_MS) {
      this.sizeSettledAt = null
      if (width !== this.appliedSize.width || height !== this.appliedSize.height) {
        this.resize()
      }
    }
  }

  drawScene(iterations) {
    const gl = this.gl
    const params = this.params
    const ic = params.initialCondition
    const { compute, render } = this.programs
    const t = this.textures

    // The phased-array emitters, packed as vec3(x, y, phase) for the shader.
    const sourceData = new Float32Array(MAX_SOURCES * 3)
    let sourceCount = 0
    if (ic.type === WaveType.PhasedArray) {
      const sources = phasedArraySources(params, gl.canvas.width, gl.canvas.height).slice(0, MAX_SOURCES)
      sources.forEach((source, i) => sourceData.set([source.x, source.y, source.phase], i * 3))
      sourceCount = sources.length
    }

    for (let i = 0; i < iterations; i++) {
      const read = this.textureOffset % 2
      const write = (this.textureOffset + 1) % 2

      // Pass 1: advance the wave equation one step into the other texture.
      gl.useProgram(compute.program)
      const cu = compute.u
      gl.uniform1i(cu.step, this.step)
      gl.uniform1f(cu.width, gl.canvas.width)
      gl.uniform1f(cu.height, gl.canvas.height)
      gl.uniform1i(cu.boundary, params.boundary)
      gl.uniform1i(cu.initialCondition, ic.type)
      gl.uniform1i(cu.direction, ic.direction)
      gl.uniform1i(cu.shape, ic.shape)
      gl.uniform1f(cu.amplitude, ic.amplitude)
      gl.uniform1f(cu.frequency, ic.frequency)
      gl.uniform1f(cu.sharpness, ic.sharpness)
      gl.uniform1f(cu.duration, ic.duration)
      if (ic.type === WaveType.Interactive) {
        // The interactive source follows the pointer instead of the stored x/y.
        gl.uniform1i(cu.touchIsActive, this.touch.active ? 1 : 0)
        gl.uniform1f(cu.sourceX, this.touch.position[0])
        gl.uniform1f(cu.sourceY, this.touch.position[1])
      } else {
        gl.uniform1i(cu.touchIsActive, 0)
        gl.uniform1f(cu.sourceX, ic.x)
        gl.uniform1f(cu.sourceY, ic.y)
      }
      gl.uniform3fv(cu.sources, sourceData)
      gl.uniform1i(cu.sourceCount, sourceCount)
      gl.uniform1f(cu.aCeil, params.aCeil)
      gl.uniform1f(cu.LOD, params.LOD)
      gl.uniform1i(cu.texture, 0)
      gl.uniform1i(cu.backgroundTexture, 1)
      this.bindQuad(compute.position)
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.frameBuffers[write])
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t.textures[read])
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, t.background)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      // Pass 2: colour the new state onto the screen.
      gl.useProgram(render.program)
      const ru = render.u
      gl.uniform1i(ru.step, this.step)
      gl.uniform1f(ru.width, gl.canvas.width)
      gl.uniform1f(ru.height, gl.canvas.height)
      gl.uniform1i(ru.energy, params.energy ? 1 : 0)
      gl.uniform1f(ru.zoom, this.view.zoom)
      gl.uniform2f(ru.viewCentre, this.view.centreX, this.view.centreY)
      gl.uniform1i(ru.texture, 0)
      gl.uniform1i(ru.backgroundTexture, 1)
      gl.uniform1i(ru.gradientTexture, 2)
      this.bindQuad(render.position)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t.textures[write])
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, t.background)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, t.gradient)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      this.textureOffset += 1
      this.step += 1
      this.touch.active = false
    }
  }

  bindQuad(location) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(location)
  }

  /**
   * canvas.toBlob on a WebGL canvas needs preserveDrawingBuffer, which would
   * slow every frame down for a rare screenshot. Reading the pixels back
   * explicitly costs nothing until the button is pressed.
   */
  captureScreenshot() {
    this.screenshotPending = false
    const gl = this.gl
    const width = this.canvas.width
    const height = this.canvas.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')
    const image = ctx.createImageData(width, height)
    // GL's origin is bottom-left, the 2D canvas's is top-left.
    const rowBytes = width * 4
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes
      image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes)
    }
    ctx.putImageData(image, 0, 0)

    out.toBlob(blob => {
      if (!blob) {
        return
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      downloadUrl(URL.createObjectURL(blob), `wave-${stamp}.png`, true)
    }, 'image/png')
  }
}

/** Starts a download of a URL (blob: or data:). */
function downloadUrl(url, filename, revoke) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  if (revoke) {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
}
