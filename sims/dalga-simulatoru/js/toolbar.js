// The side panel. Most controls are wired declaratively from index.html:
//
//   data-path="grid.divisions"   which parameter the control edits
//   data-effect="grid"           what has to happen after it changes
//   data-label="grid.divisions"  a text readout of a parameter
//   data-visible="isPlane"       shown only while that predicate holds
//
// render() pushes the current parameters into every control. The app calls it
// after any change from anywhere, so the panel can never show stale values.
'use strict'

const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const MAX_UPLOAD_SIDE = 8192

/** When each data-visible block is shown. */
const VISIBILITY = {
  isDesktop: () => !IS_MOBILE,
  shapeHasSides: p => ['polygon', 'star'].includes(p.backgroundShape?.kind),
  shapeIsStar: p => p.backgroundShape?.kind === 'star',
  shapeIsEllipse: p => p.backgroundShape?.kind === 'ellipse',
  shapeIsSlits: p => p.backgroundShape?.kind === 'slits',
  shapeNotSlits: p => p.backgroundShape?.kind !== 'slits',
  shapeIsHollow: p => !!p.backgroundShape?.hollow,
  isPlane: p => p.initialCondition.type === WaveType.Plane,
  hasPulseShape: p => [WaveType.Pulse, WaveType.Interactive].includes(p.initialCondition.type),
  hasPosition: p => [WaveType.Pulse, WaveType.Spherical].includes(p.initialCondition.type),
  showsX: p => p.initialCondition.type === WaveType.Spherical || p.initialCondition.shape !== 2,
  showsY: p => p.initialCondition.type === WaveType.Spherical || p.initialCondition.shape !== 1,
  hasDuration: p => [WaveType.Plane, WaveType.Spherical, WaveType.PhasedArray].includes(p.initialCondition.type),
  hasFrequency: p => [WaveType.Plane, WaveType.Spherical, WaveType.PhasedArray].includes(p.initialCondition.type),
  isPhased: p => p.initialCondition.type === WaveType.PhasedArray,
  isLinearArray: p => p.phasedArray.mode === 'linear',
  isCustomArray: p => p.phasedArray.mode === 'custom'
}

/** Sliders whose values must stay whole numbers when typed. */
const COUNT_PATHS = ['backgroundShape.sides', 'backgroundShape.slitCount', 'phasedArray.count', 'grid.divisions']

/** Effects that are too heavy to run on every slider tick: applied on release. */
const ON_RELEASE = ['shape', 'array']

function getPath(obj, path) {
  return path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj)
}

function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, key) => (o == null ? undefined : o[key]), obj)
  if (target != null) {
    target[last] = value
  }
}

/** Clamps a typed number into the range its field allows. */
function clampTyped(path, value) {
  const key = path.split('.').pop()
  if (key === 'x' || key === 'y') {
    return coord(value, 0.5)
  }
  const range = path.startsWith('backgroundShape.') ? LIMITS.shape[key]
    : path.startsWith('phasedArray.') ? LIMITS.phasedArray[key]
    : LIMITS[key]
  return range ? clamp(value, range[0], range[1]) : value
}

/** WebKit has no ::range-progress, so the filled part is a CSS variable. */
function fillRange(el) {
  const min = Number(el.min)
  const max = Number(el.max)
  el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`)
}

class Toolbar {
  constructor(app) {
    this.app = app
    this.root = document.getElementById('toolbar')
    this.thumbnails = new Map()
    this.shareTimer = null
    this.bindControls()
    this.bindButtons()
    this.bindFileSelects()
  }

  get params() {
    return this.app.params
  }

  $(id) {
    return document.getElementById(id)
  }

  // ------------------------------------------------------- generic controls

  bindControls() {
    for (const el of this.root.querySelectorAll('[data-path]')) {
      const path = el.dataset.path
      const effect = el.dataset.effect
      if (el.type === 'range') {
        // Live while dragging; heavier effects (a shape rebuild) on release.
        el.addEventListener('input', () => {
          setPath(this.params, path, Number(el.value))
          fillRange(el)
          if (ON_RELEASE.includes(effect)) {
            this.renderLabels()
            this.app.scene.refreshOverlay()
          } else {
            this.apply(effect)
          }
        })
        if (ON_RELEASE.includes(effect)) {
          el.addEventListener('change', () => this.apply(effect))
        }
      } else if (el.type === 'checkbox') {
        el.addEventListener('change', () => {
          setPath(this.params, path, el.checked)
          this.apply(effect)
        })
      } else if (el.type === 'radio') {
        el.addEventListener('change', () => {
          if (el.checked) {
            setPath(this.params, path, el.dataset.type === 'string' ? el.value : Number(el.value))
            this.apply(effect)
          }
        })
      } else if (el.type === 'text') {
        // Committed on blur or Enter. A bad value puts the last good one back.
        el.addEventListener('change', () => {
          const value = Number(el.value.trim().replace(',', '.'))
          if (el.value.trim() === '' || !Number.isFinite(value)) {
            el.value = `${getPath(this.params, path)}`
            return
          }
          const next = clampTyped(path, value)
          el.value = `${next}`
          if (getPath(this.params, path) !== next) {
            setPath(this.params, path, next)
            this.apply(effect)
          }
        })
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter') el.blur()
        })
      }
    }

    this.bindValueEditors()

    this.$('wave-type').addEventListener('change', e => {
      const type = Number(e.target.value)
      const ic = this.params.initialCondition
      if (type !== ic.type) {
        this.params.initialCondition = switchWaveType(ic, type)
        this.app.restart()
      }
      this.app.save()
      this.app.refresh()
    })
  }

  /**
   * The number next to each slider can be clicked to type an exact value:
   * a slider 150 px wide cannot land on, say, exactly 45 of 360 degrees.
   * Enter or leaving the box commits, Escape cancels.
   */
  bindValueEditors() {
    for (const label of this.root.querySelectorAll('.range-container [data-label]')) {
      const range = label.parentElement.querySelector('input[type="range"]')
      if (!range) {
        continue
      }
      label.tabIndex = 0
      label.setAttribute('role', 'button')
      label.title = 'Click to type a value'
      const open = () => this.editValue(label, range)
      label.addEventListener('click', open)
      label.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    }
  }

  editValue(label, range) {
    const path = range.dataset.path
    const box = document.createElement('input')
    box.type = 'text'
    box.inputMode = 'decimal'
    box.className = 'text-field range-edit'
    box.value = `${getPath(this.params, path)}`
    box.setAttribute('aria-label', `${label.parentElement.querySelector('.range-label')?.textContent ?? 'Value'}, ${range.min} to ${range.max}`)
    label.hidden = true
    label.after(box)
    box.focus()
    box.select()

    let done = false
    const close = commit => {
      if (done) return
      done = true
      const value = Number(box.value.trim().replace(',', '.'))
      box.remove()
      label.hidden = false
      label.focus({ preventScroll: true })
      if (!commit || box.value.trim() === '' || !Number.isFinite(value)) {
        return
      }
      const min = Number(range.min)
      const max = Number(range.max)
      const step = Number(range.step)
      let next = clamp(value, min, max)
      // Counts (sides, slits, elements, divisions) keep to their steps; the
      // others take any typed value, rounded to 4 decimals, so an angle can
      // be 22.5 even though its slider moves in whole degrees.
      next = COUNT_PATHS.includes(path)
        ? clamp(min + Math.round((next - min) / step) * step, min, max)
        : Math.round(next * 10000) / 10000
      next = clampTyped(path, next)
      setPath(this.params, path, next)
      this.apply(range.dataset.effect)
    }
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
    })
    box.addEventListener('blur', () => close(true))
  }

  /** What each data-effect means. */
  apply(effect) {
    const app = this.app
    const params = this.params
    switch (effect) {
      case 'shape':
        app.scene.rebuildBackground()
        break
      case 'restart':
      case 'array':
        app.restart()
        break
      case 'arrayMode':
        if (params.phasedArray.mode === 'custom') {
          this.materializeArray()
        }
        app.restart()
        break
      case 'source':
        // The interactive pulse reads its settings live; the others restart.
        if (params.initialCondition.type !== WaveType.Interactive) {
          app.restart()
        }
        break
      case 'redraw':
        params.nextFrame++
        break
      case 'grid':
        params.grid.divisions = normaliseDivisions(params.grid.divisions)
        params.nextFrame++
        break
      case 'view':
        params.view = clampView(params.view)
        break
    }
    app.save()
    app.refresh()
  }

  // ---------------------------------------------------------------- buttons

  bindButtons() {
    const app = this.app
    this.$('btn-pause').addEventListener('click', () => app.togglePause())
    this.$('btn-next').addEventListener('click', () => app.stepForward())
    this.$('btn-restart').addEventListener('click', () => {
      this.params.pause = false
      app.restart()
      app.refresh()
    })
    this.$('btn-dock').addEventListener('click', () => {
      this.params.toolbarSide = this.params.toolbarSide === 'right' ? 'left' : 'right'
      app.save()
      app.refresh()
    })
    this.$('btn-reset-view').addEventListener('click', () => app.scene.resetView())
    this.$('btn-png').addEventListener('click', () => app.scene.requestScreenshot())
    this.$('btn-record').addEventListener('click', () => app.toggleRecording())
    this.$('btn-render').addEventListener('click', () => app.renderVideo())
    this.$('btn-share').addEventListener('click', () => this.copyShareLink())
    this.$('btn-add-source').addEventListener('click', () => {
      const sources = this.params.phasedArray.sources
      if (sources.length < MAX_SOURCES) {
        sources.push({ x: 0.5, y: 0.5, phase: 0 })
        this.apply('array')
      }
    })
    this.$('btn-reset-all').addEventListener('click', () => {
      if (confirm('Reset parameters to default?\nThis action cannot be undone.')) {
        app.resetAll()
      }
    })
  }

  async copyShareLink() {
    const ok = await Share.copyToClipboard(Share.buildLink(this.params))
    const button = this.$('btn-share')
    button.textContent = ok ? 'Link copied' : 'Copy failed'
    clearTimeout(this.shareTimer)
    this.shareTimer = setTimeout(() => {
      button.textContent = 'Copy link to this scene'
    }, 2500)
  }

  // ------------------------------------------------ background and gradient

  bindFileSelects() {
    const setups = [
      { button: 'background-select', input: 'background-file', menu: () => this.backgroundMenu(), apply: (src, name) => this.setBackgroundImage(src, name) },
      { button: 'gradient-select', input: 'gradient-file', menu: () => this.gradientMenu(), apply: (src, name) => this.setGradientImage(src, name) }
    ]
    for (const s of setups) {
      const button = this.$(s.button)
      const input = this.$(s.input)
      button.addEventListener('click', () => {
        // The pointerdown that closed this menu should not reopen it.
        if (button.dataset.justClosed) {
          delete button.dataset.justClosed
          return
        }
        Menu.open(button, s.menu())
      })
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          this.readUpload(input.files[0], s.apply)
        }
        input.value = ''
      })
      button.addEventListener('dragover', e => {
        e.preventDefault()
        button.classList.add('drop-hover')
      })
      button.addEventListener('dragleave', () => button.classList.remove('drop-hover'))
      button.addEventListener('drop', e => {
        e.preventDefault()
        button.classList.remove('drop-hover')
        const file = e.dataTransfer?.files?.[0]
        if (file) {
          this.readUpload(file, s.apply)
        }
      })
    }
  }

  shapeThumbnail(def) {
    const key = JSON.stringify(def)
    let url = this.thumbnails.get(key)
    if (!url) {
      url = Shapes.thumbnail(def)
      this.thumbnails.set(key, url)
    }
    return url
  }

  backgroundMenu() {
    const shapeItem = def => ({
      label: Shapes.describe(def),
      thumb: this.shapeThumbnail(def),
      action: () => this.setShape(def)
    })
    const images = Object.entries(ASSETS.backgrounds).map(([key, asset], i) => ({
      label: asset.name,
      note: i === 0 ? '(default)' : undefined,
      thumb: asset.src,
      action: () => i === 0 ? this.resetBackground() : this.setBackgroundImage(`asset:${key}`, asset.name)
    }))
    return [
      {
        label: 'Shapes',
        submenu: [
          {
            label: 'Polygons',
            // Polygons start with a corner at the top. For 4 and 8 sides that
            // reads as a diamond, so those are turned to sit on a flat edge.
            submenu: Shapes.POLYGON_SIDES.map(sides => shapeItem({
              ...defaultShape('polygon'),
              sides: sides,
              rotation: sides % 4 === 0 ? 180 / sides : 0
            }))
          },
          ...Shapes.OTHER_KINDS.map(kind => shapeItem(defaultShape(kind)))
        ]
      },
      { label: 'Images', submenu: images },
      {
        label: 'File',
        submenu: [
          { label: 'Open', action: () => this.$('background-file').click() },
          { label: 'Download Example', action: () => downloadUrl(ASSETS.backgrounds.lens.src, 'Background Example.png') }
        ]
      }
    ]
  }

  gradientMenu() {
    const first = Object.keys(ASSETS.gradients)[0]
    const templates = Object.entries(ASSETS.gradients).map(([key, asset]) => ({
      label: asset.name,
      note: key === first ? '(default)' : undefined,
      thumb: asset.src,
      thumbClass: 'menu-gradient-thumb',
      action: () => key === first ? this.resetGradient() : this.setGradientImage(`asset:${key}`, asset.name)
    }))
    return [
      {
        label: 'File',
        submenu: [
          { label: 'Open', action: () => this.$('gradient-file').click() },
          { label: 'Download Example', action: () => downloadUrl(ASSETS.gradients[first].src, 'Gradient Example.png') }
        ]
      },
      { label: 'Templates', submenu: templates }
    ]
  }

  setShape(def) {
    this.params.backgroundShape = def
    delete this.params.backgroundImage
    this.backgroundChanged()
  }

  setBackgroundImage(src, name) {
    delete this.params.backgroundShape
    this.params.backgroundImage = { src: src, name: name }
    this.backgroundChanged()
  }

  resetBackground() {
    delete this.params.backgroundShape
    delete this.params.backgroundImage
    this.backgroundChanged()
  }

  backgroundChanged() {
    this.app.scene.rebuildBackground()
    this.app.save()
    this.app.refresh()
  }

  setGradientImage(src, name) {
    this.params.gradientImage = { src: src, name: name }
    this.gradientChanged()
  }

  resetGradient() {
    delete this.params.gradientImage
    this.gradientChanged()
  }

  gradientChanged() {
    this.app.scene.rebuildGradient()
    this.app.save()
    this.app.refresh()
  }

  /**
   * Accepts only real raster images of a sane size, and only hands them on
   * once the browser has actually decoded them.
   */
  readUpload(file, apply) {
    const fail = message => {
      const box = this.$('upload-error')
      box.textContent = message
      box.hidden = false
      setTimeout(() => { box.hidden = true }, 5000)
    }
    if (!UPLOAD_TYPES.includes(file.type)) {
      fail('Only PNG, JPEG, GIF, WebP or BMP images can be used.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      fail('That image is larger than 15 MB.')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => fail('The file could not be read.')
    reader.onload = () => {
      const src = reader.result
      if (!isUploadSrc(src)) {
        fail('That file is not a supported image.')
        return
      }
      const image = new Image()
      image.onerror = () => fail('That file is not a valid image.')
      image.onload = () => {
        if (image.naturalWidth > MAX_UPLOAD_SIDE || image.naturalHeight > MAX_UPLOAD_SIDE) {
          fail(`Images can be at most ${MAX_UPLOAD_SIDE} pixels on a side.`)
          return
        }
        apply(src, file.name.slice(0, 80))
      }
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  // ------------------------------------------------------------ phased array

  /**
   * Switching to custom starts from whatever the linear array currently looks
   * like, so its layout and phases become editable instead of vanishing.
   */
  materializeArray() {
    const pa = this.params.phasedArray
    const canvas = this.app.scene.canvas
    const linear = { ...this.params, phasedArray: { ...pa, mode: 'linear' } }
    pa.sources = phasedArraySources(linear, canvas.width, canvas.height).map(s => {
      // Phases as degrees in (-180, 180], rounded to 0.1.
      let degrees = ((s.phase * 180) / Math.PI) % 360
      if (degrees > 180) degrees -= 360
      if (degrees <= -180) degrees += 360
      return { x: coord(s.x, 0.5), y: coord(s.y, 0.5), phase: Math.round(degrees * 10) / 10 }
    })
  }

  /** The custom source list: one row per source, rebuilt only when the count changes. */
  renderSourceList() {
    const list = this.$('source-list')
    const sources = this.params.phasedArray.sources
    if (list.children.length !== sources.length) {
      list.replaceChildren(...sources.map((_, i) => this.sourceRow(i)))
    }
    sources.forEach((source, i) => {
      const row = list.children[i]
      row.querySelector('.source-pos').textContent = `x ${source.x.toFixed(3)}  y ${source.y.toFixed(3)}`
      const phase = row.querySelector('input')
      if (document.activeElement !== phase) phase.value = `${source.phase}`
    })
    this.$('btn-add-source').disabled = sources.length >= MAX_SOURCES
  }

  sourceRow(index) {
    const row = document.createElement('div')
    row.className = 'source-row'

    const number = document.createElement('span')
    number.className = 'source-number'
    number.textContent = `${index + 1}`

    const pos = document.createElement('span')
    pos.className = 'source-pos'

    const phase = document.createElement('input')
    phase.type = 'text'
    phase.inputMode = 'decimal'
    phase.className = 'text-field source-phase'
    phase.setAttribute('aria-label', `Phase of source ${index + 1}, degrees`)
    phase.addEventListener('change', () => {
      const source = this.params.phasedArray.sources[index]
      const value = Number(phase.value.trim().replace(',', '.'))
      if (!source || phase.value.trim() === '' || !Number.isFinite(value)) {
        phase.value = source ? `${source.phase}` : ''
        return
      }
      source.phase = clamp(value, ...LIMITS.phasedArray.phase)
      phase.value = `${source.phase}`
      this.apply('array')
    })
    phase.addEventListener('keydown', e => {
      if (e.key === 'Enter') phase.blur()
    })

    const unit = document.createElement('span')
    unit.textContent = '°'

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'icon-button small'
    remove.title = `Remove source ${index + 1}`
    remove.setAttribute('aria-label', remove.title)
    remove.appendChild(icon('i-close'))
    remove.addEventListener('click', () => {
      this.params.phasedArray.sources.splice(index, 1)
      // Indices shift, so rebuild every row.
      this.$('source-list').replaceChildren()
      this.apply('array')
    })

    row.append(number, pos, phase, unit, remove)
    return row
  }

  /** Wavelength relative to the screen, so "spacing in λ" means something. */
  renderWavelength() {
    const params = this.params
    const canvas = this.app.scene.canvas
    const lambda = wavelengthCells(params.initialCondition.frequency, params.LOD)
    const shorter = Math.min(canvas.width, canvas.height)
    this.$('pa-wavelength').textContent = Number.isFinite(lambda) && shorter > 0
      ? `Wavelength λ ≈ ${((lambda / shorter) * 100).toFixed(1)}% of the shorter side. Lower the frequency for a longer wave.`
      : 'Frequency is 0, so there is no wavelength to steer with.'
  }

  // ----------------------------------------------------------------- render

  render() {
    const params = this.params

    for (const el of this.root.querySelectorAll('[data-visible]')) {
      el.hidden = !VISIBILITY[el.dataset.visible](params)
    }
    this.$('shape-section').hidden = !params.backgroundShape

    for (const el of this.root.querySelectorAll('[data-path]')) {
      const value = getPath(params, el.dataset.path)
      if (value === undefined) {
        continue
      }
      if (el.type === 'checkbox') {
        el.checked = !!value
      } else if (el.type === 'radio') {
        el.checked = (el.dataset.type === 'string' ? el.value : Number(el.value)) === value
      } else if (el.type === 'text') {
        // Never overwrite what the user is in the middle of typing.
        if (document.activeElement !== el) el.value = `${value}`
      } else {
        el.value = `${value}`
        if (el.type === 'range') fillRange(el)
      }
    }
    this.renderLabels()
    if (params.initialCondition.type === WaveType.PhasedArray) {
      this.renderSourceList()
      this.renderWavelength()
    }

    this.$('wave-type').value = `${params.initialCondition.type}`
    this.$('shape-sides-label').textContent = params.backgroundShape?.kind === 'star' ? 'Points' : 'Sides'
    this.$('background-name').textContent = params.backgroundShape
      ? Shapes.describe(params.backgroundShape)
      : (params.backgroundImage?.name ?? ASSETS.backgrounds.lens.name)
    this.$('gradient-name').textContent = params.gradientImage?.name ?? Object.values(ASSETS.gradients)[0].name
    this.$('share-warning').hidden = !Share.hasUnshareableContent(params)

    this.renderRecording()

    const paused = params.pause
    const pause = this.$('btn-pause')
    pause.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause')
    pause.setAttribute('aria-label', paused ? 'Play' : 'Pause')
    pause.title = paused ? 'Play (Space)' : 'Pause (Space)'

    const right = params.toolbarSide === 'right'
    const dock = this.$('btn-dock')
    dock.querySelector('use').setAttribute('href', right ? '#i-chevron-left' : '#i-chevron-right')
    dock.title = right ? 'Move panel to the left' : 'Move panel to the right'
    dock.setAttribute('aria-label', dock.title)
  }

  /** Record button label, with a running timer while recording. */
  renderRecording() {
    const button = this.$('btn-record')
    const video = this.app.scene.video
    if (!VideoRenderer.supported) {
      this.$('btn-render').disabled = true
      this.$('btn-render').title = 'This browser cannot encode video; use Record live'
    }
    if (!VideoRecorder.supported) {
      button.disabled = true
      button.title = 'This browser cannot record video'
      return
    }
    const seconds = Math.floor(video.elapsed)
    button.textContent = video.recording
      ? `Stop recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : 'Record live'
    button.classList.toggle('recording', video.recording)
    button.setAttribute('aria-pressed', String(video.recording))
  }

  showVideoHint(text) {
    const hint = this.$('video-hint')
    hint.textContent = text
    hint.hidden = !text
  }

  renderLabels() {
    for (const el of this.root.querySelectorAll('[data-label]')) {
      const value = getPath(this.params, el.dataset.label)
      if (typeof value !== 'number') {
        continue
      }
      const digits = el.dataset.digits
      el.textContent = (digits ? value.toFixed(Number(digits)) : `${value}`) + (el.dataset.suffix ?? '')
    }
  }
}
