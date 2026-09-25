// Records the simulation to a video file, using only the browser's own
// MediaRecorder: no libraries, nothing leaves the machine.
//
// Frames are copied from the WebGL canvas into a 2D canvas right after each
// simulation draw, in the same frame (the WebGL drawing buffer is cleared once
// it is presented). That copy also lets the video have even dimensions, which
// H.264 needs, and stay within 1920 px, the largest size X/Twitter accepts.
// Overlays such as the grid and the source markers are HTML, so they are not
// part of the video.
'use strict'

const VIDEO_MAX_SIDE = 1920
/** High enough that fine high-frequency patterns survive compression. */
const VIDEO_BITRATE = 16000000

/** Best format this browser can record: MP4 (H.264) first, since X needs it. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.640033',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm'
]

class VideoRecorder {
  constructor() {
    this.recorder = null
    this.startedAt = 0
    this.onFinished = null
  }

  static get supported() {
    return typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      VIDEO_TYPES.some(t => MediaRecorder.isTypeSupported(t))
  }

  get recording() {
    return this.recorder !== null
  }

  /** Seconds since recording started. */
  get elapsed() {
    return this.recording ? (performance.now() - this.startedAt) / 1000 : 0
  }

  /** @param {HTMLCanvasElement} source the WebGL canvas */
  start(source) {
    const even = n => Math.max(2, Math.floor(n / 2) * 2)
    const scale = Math.min(1, VIDEO_MAX_SIDE / Math.max(source.width, source.height))
    this.canvas = document.createElement('canvas')
    this.canvas.width = even(source.width * scale)
    this.canvas.height = even(source.height * scale)
    this.ctx = this.canvas.getContext('2d', { alpha: false })

    // Frame rate 0: a frame is emitted only when requestFrame() is called,
    // i.e. exactly once per simulation draw.
    this.stream = this.canvas.captureStream(0)
    this.track = this.stream.getVideoTracks()[0]
    this.type = VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t))
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.type,
      videoBitsPerSecond: VIDEO_BITRATE
    })
    this.recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.onstop = () => this.finish()
    this.recorder.start(1000)
    this.startedAt = performance.now()
    this.frame(source)
  }

  /** Copies the current simulation frame into the video. */
  frame(source) {
    if (!this.recording) {
      return
    }
    const { width, height } = this.canvas
    // Letterbox if the simulation was resized mid-recording, rather than
    // stretching it.
    const scale = Math.min(width / source.width, height / source.height)
    const w = source.width * scale
    const h = source.height * scale
    this.ctx.fillStyle = 'black'
    this.ctx.fillRect(0, 0, width, height)
    this.ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
    this.track.requestFrame()
  }

  stop() {
    if (this.recording && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
  }

  finish() {
    const type = this.type
    const blob = new Blob(this.chunks, { type: type.split(';')[0] })
    this.stream.getTracks().forEach(t => t.stop())
    this.recorder = null
    this.chunks = []
    const isMp4 = type.startsWith('video/mp4')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadUrl(URL.createObjectURL(blob), `wave-${stamp}.${isMp4 ? 'mp4' : 'webm'}`, true)
    this.onFinished?.({ isMp4, size: blob.size })
  }
}
