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

    // Dar ekranda panel kapalı başlar; simülasyon tüm ekranı kullanır
    if (window.matchMedia('(max-width: 700px)').matches) {
      document.body.classList.add('fullscreen')
    }
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      document.body.classList.toggle('fullscreen')
    })
    window.addEventListener('keydown', e => this.onShortcut(e))

    this.refresh()
    this.setupRotateGate()
    const error = this.scene.start()
    if (error) {
      const box = document.getElementById('error')
      box.textContent = error
      box.hidden = false
    }
  },

  /** The scene this browser saved last time (sanitised). */
  loadParameters() {
    return sanitizeParameters(SavedSettings.load(), { isMobile: IS_MOBILE, allowUploads: true })
  },

  /**
   * Dikey telefonda simülasyon anlamsız: uyarı gösterilir, simülasyon duraklatılır;
   * ekran yan çevrilince uyarı kalkar ve simülasyon başlar.
   */
  setupRotateGate() {
    const gate = document.getElementById('rotate-gate')
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 700px)')
    const update = () => {
      const portrait = mq.matches
      if (portrait === !gate.hidden && this.scene.hold === portrait) return
      gate.hidden = !portrait
      const wasHeld = this.scene.hold
      this.scene.hold = portrait
      if (wasHeld && !portrait) this.restart()     // çevrilince baştan başlar
    }
    mq.addEventListener ? mq.addEventListener('change', update) : mq.addListener(update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    update()
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
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable || Menu.layer) {
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
      case '0':
        this.scene.resetView()
        break
      default:
        return
    }
    event.preventDefault()
  }
}

App.init()
