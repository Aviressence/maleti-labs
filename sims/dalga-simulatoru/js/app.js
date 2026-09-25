// Wires the pieces together and owns the one live parameter object.
'use strict'

const App = {
  params: null,
  scene: null,
  toolbar: null,

  init() {
    this.params = this.loadParameters()

    this.scene = new SceneCanvas(document.getElementById('scene'), () => this.params, {
      // A drag or zoom on the canvas: refresh the panel's boxes and save.
      sourceMoved: () => { this.save(); this.refresh() },
      viewChanged: () => { this.save(); this.refresh() },
      resized: () => this.toolbar?.render()
    })
    this.toolbar = new Toolbar(this)

    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      document.body.classList.toggle('fullscreen')
    })
    window.addEventListener('keydown', e => this.onShortcut(e))

    this.refresh()
    const error = this.scene.start()
    if (error) {
      const box = document.getElementById('error')
      box.textContent = error
      box.hidden = false
    }
  },

  /**
   * A shared link wins over this browser's saved scene, so following someone's
   * URL shows their setup. Both go through the sanitiser; only the local save
   * may reference an uploaded image.
   */
  loadParameters() {
    const shared = Share.readFromLocation()
    Share.clearLocation()
    if (shared) {
      return sanitizeParameters(shared, { isMobile: IS_MOBILE, allowUploads: false })
    }
    return sanitizeParameters(SavedSettings.load(), { isMobile: IS_MOBILE, allowUploads: true })
  },

  save() {
    SavedSettings.save(this.params)
  },

  /** Pushes the current parameters into the panel and the canvas overlay. */
  refresh() {
    document.body.classList.toggle('toolbar-right', this.params.toolbarSide === 'right')
    this.toolbar.render()
    this.scene.refreshOverlay()
  },

  restart() {
    this.scene.restart()
  },

  togglePause() {
    this.params.pause = !this.params.pause
    this.refresh()
  },

  stepForward() {
    this.params.nextFrame += 5
  },

  /**
   * Starts or stops a video recording. A timer keeps the button's clock
   * ticking; the file downloads once the recorder has flushed.
   */
  toggleRecording() {
    const video = this.scene.video
    if (video.recording) {
      video.stop()
      return
    }
    if (!VideoRecorder.supported) {
      return
    }
    video.onFinished = ({ isMp4 }) => {
      clearInterval(this.recordTimer)
      this.toolbar.showVideoHint(isMp4 ? '' :
        'This browser can only record WebM. X/Twitter needs MP4: record in Chrome or Edge, or convert the file.')
      this.refresh()
    }
    this.toolbar.showVideoHint('Only the simulation is recorded, not the grid or markers. Recording runs at the speed you see.')
    video.start(this.scene.canvas)
    // Recording a paused simulation would just hold one frame.
    this.params.pause = false
    this.recordTimer = setInterval(() => this.toolbar.renderRecording(), 500)
    this.refresh()
  },

  /**
   * Renders the configured video offline and downloads it. A modal overlay
   * shows progress and blocks edits, since changing the scene mid-render
   * would change the video.
   */
  async renderVideo() {
    if (this.scene.rendering) {
      return
    }
    if (this.scene.video.recording) {
      this.scene.video.stop()
    }
    const overlay = document.getElementById('render-overlay')
    const fill = document.getElementById('render-fill')
    const status = document.getElementById('render-status')
    const cancel = document.getElementById('btn-render-cancel')
    const controller = new AbortController()
    cancel.onclick = () => controller.abort()
    const settings = { ...this.params.video }
    const started = performance.now()

    fill.style.width = '0%'
    status.textContent = 'Starting'
    overlay.hidden = false
    cancel.focus()
    this.toolbar.showVideoHint('')
    try {
      const renderer = new VideoRenderer(this.scene)
      const blob = await renderer.render(settings, fraction => {
        fill.style.width = `${(fraction * 100).toFixed(1)}%`
        const seconds = (performance.now() - started) / 1000
        const left = fraction > 0.02 ? Math.round((seconds / fraction) * (1 - fraction)) : null
        status.textContent = `${Math.round(fraction * 100)}%` + (left !== null ? `, about ${left} s left` : '')
      }, controller.signal)
      if (blob) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        downloadUrl(URL.createObjectURL(blob), `wave-${stamp}.mp4`, true)
        const took = ((performance.now() - started) / 1000).toFixed(1)
        this.toolbar.showVideoHint(`Saved a ${settings.seconds} s video (${(blob.size / 1048576).toFixed(1)} MB) in ${took} s.`)
      }
    } catch (e) {
      console.error(e)
      this.toolbar.showVideoHint(`Rendering failed: ${e.message || e}`)
    } finally {
      overlay.hidden = true
      this.refresh()
    }
  },

  resetAll() {
    SavedSettings.clear()
    this.params = makeDefaultParameters(IS_MOBILE)
    this.scene.rebuildBackground()
    this.scene.rebuildGradient()
    this.restart()
    this.refresh()
  },

  onShortcut(event) {
    // Never steal keys from a text field or an open menu, and leave browser
    // chords alone.
    const target = event.target
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable || Menu.layer || this.scene.rendering) {
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    // Space on a just-clicked button would press it again on keyup; drop the
    // focus so Space means "pause" and nothing else.
    if (event.key === ' ' && tag === 'BUTTON') {
      target.blur()
    }
    switch (event.key) {
      case ' ':
        this.togglePause()
        break
      case 'r':
      case 'R':
        this.params.pause = false
        this.restart()
        this.refresh()
        break
      case 'n':
      case 'N':
      case 'ArrowRight':
        this.stepForward()
        break
      case 'g':
      case 'G':
        this.params.grid.show = !this.params.grid.show
        this.save()
        this.refresh()
        break
      case '0':
        this.scene.resetView()
        break
      case 's':
      case 'S':
        this.scene.requestScreenshot()
        break
      case 'v':
      case 'V':
        this.toggleRecording()
        break
      default:
        return
    }
    event.preventDefault()
  }
}

App.init()
