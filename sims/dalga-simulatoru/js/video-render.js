// Renders the simulation straight to an MP4, as fast as the GPU allows,
// instead of recording it in real time. Each video frame advances the
// simulation by a fixed number of steps, is copied to a 2D canvas, and is
// encoded to H.264 with WebCodecs; js/mp4.js then writes the file.
//
// Because timestamps are assigned per frame rather than read from a clock,
// the frame rate is exact no matter how fast or slow the machine is.
'use strict'

/** Steps per second the live view runs at: 3 steps per frame at 60 fps. */
const LIVE_STEPS_PER_SECOND = 180
/** Most frames the encoder may hold before we wait for it to catch up. */
const MAX_ENCODE_QUEUE = 6

/** H.264 High first, then Main and Baseline for weaker encoders. */
const RENDER_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.4D0033', 'avc1.42003E']

/** Yields to the browser so the progress bar can paint, without timer throttling. */
function yieldToBrowser() {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
}

class VideoRenderer {
  constructor(scene) {
    this.scene = scene
  }

  static get supported() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
  }

  /** The first H.264 configuration this browser can actually encode. */
  async pickConfig(width, height, fps) {
    for (const codec of RENDER_CODECS) {
      const config = {
        codec,
        width,
        height,
        bitrate: VIDEO_BITRATE,
        framerate: fps,
        avc: { format: 'avc' },
        latencyMode: 'quality'
      }
      try {
        const result = await VideoEncoder.isConfigSupported(config)
        if (result.supported) return config
      } catch { /* try the next one */ }
    }
    return null
  }

  /**
   * @param {{seconds: number, fps: number, speed: number, fromStart: boolean}} settings
   * @param {(fraction: number) => void} onProgress
   * @param {AbortSignal} signal
   * @returns {Promise<Blob | null>} the MP4, or null if cancelled
   */
  async render(settings, onProgress, signal) {
    const scene = this.scene
    const source = scene.canvas
    scene.rendering = true
    let encoder = null
    try {
      if (settings.fromStart) {
        scene.resize()
      }
      // Both images must be on the GPU before the first frame.
      while (!scene.textures.background || !scene.textures.gradient) {
        await new Promise(r => setTimeout(r, 50))
      }

      const even = n => Math.max(2, Math.floor(n / 2) * 2)
      const scale = Math.min(1, VIDEO_MAX_SIDE / Math.max(source.width, source.height))
      const width = even(source.width * scale)
      const height = even(source.height * scale)
      const copy = document.createElement('canvas')
      copy.width = width
      copy.height = height
      const ctx = copy.getContext('2d', { alpha: false })

      const fps = settings.fps
      const config = await this.pickConfig(width, height, fps)
      if (!config) {
        throw new Error('This browser cannot encode H.264 video. Use "Record live" instead.')
      }

      const samples = []
      let description = null
      let failure = null
      encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const d = meta?.decoderConfig?.description
          if (d && !description) {
            description = d instanceof ArrayBuffer
              ? new Uint8Array(d.slice(0))
              : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
          }
          const data = new Uint8Array(chunk.byteLength)
          chunk.copyTo(data)
          samples.push({ data, key: chunk.type === 'key', pts: Math.round((chunk.timestamp * fps) / 1e6) })
        },
        error: e => { failure = e }
      })
      encoder.configure(config)

      const total = Math.max(1, Math.round(settings.seconds * fps))
      const stepsPerFrame = Math.max(1, Math.round((LIVE_STEPS_PER_SECOND * settings.speed) / fps))
      const frameDuration = Math.round(1e6 / fps)

      for (let i = 0; i < total; i++) {
        if (signal.aborted) {
          return null
        }
        if (failure) {
          throw failure
        }
        scene.drawScene(stepsPerFrame)
        // Copy in the same task as the draw, before the buffer is presented.
        ctx.drawImage(source, 0, 0, width, height)
        const frame = new VideoFrame(copy, { timestamp: i * frameDuration, duration: frameDuration })
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
        frame.close()

        while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
          await yieldToBrowser()
        }
        if (i % 4 === 0) {
          onProgress(i / total)
          await yieldToBrowser()
        }
      }

      await encoder.flush()
      if (failure) {
        throw failure
      }
      onProgress(1)
      if (!description || samples.length === 0) {
        throw new Error('The encoder produced no video data.')
      }
      return Mp4.build({ width, height, fps, description, samples })
    } finally {
      if (encoder && encoder.state !== 'closed') {
        encoder.close()
      }
      scene.rendering = false
    }
  }
}
