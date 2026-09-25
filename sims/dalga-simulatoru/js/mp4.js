// A minimal MP4 writer for one H.264 video track, so rendered videos need no
// library. It takes the encoded chunks from WebCodecs' VideoEncoder (in "avc"
// format, i.e. length-prefixed NAL units plus an avcC description) and lays
// them out as ftyp + mdat + moov, a plain non-fragmented MP4 that X/Twitter
// and every player accept.
'use strict'

const Mp4 = {
  /**
   * @param {{width: number, height: number, fps: number, description: Uint8Array,
   *          samples: {data: Uint8Array, key: boolean, pts: number}[]}} video
   *        pts is the presentation index of each sample, in frames, and
   *        samples are in decode order (the order the encoder produced them).
   * @returns {Blob}
   */
  build(video) {
    const { width, height, fps, description, samples } = video
    const count = samples.length

    // Decode times are 0, 1, 2, ... frames. If the encoder reordered frames
    // (B-frames), presentation runs ahead of decode by up to `delay` frames:
    // store per-sample composition offsets and an edit list that hides the
    // delay, so playback still starts at frame 0.
    let delay = 0
    samples.forEach((s, i) => { delay = Math.max(delay, i - s.pts) })
    const offsets = samples.map((s, i) => s.pts - i + delay)
    const reordered = offsets.some(o => o !== 0)

    const ftyp = this.box('ftyp', this.str('isom'), this.u32(512),
      this.str('isom'), this.str('iso2'), this.str('avc1'), this.str('mp41'))

    let dataSize = 0
    samples.forEach(s => { dataSize += s.data.length })
    const mdatHeader = this.concat(this.u32(8 + dataSize), this.str('mdat'))
    const firstSampleOffset = ftyp.length + mdatHeader.length

    const movieDuration = Math.round((count * 1000) / fps) // mvhd/tkhd use 1/1000 s
    const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(v => this.u32(v))

    const mvhd = this.fullBox('mvhd', 0, 0,
      this.u32(0), this.u32(0), this.u32(1000), this.u32(movieDuration),
      this.u32(0x00010000), this.u16(0x0100), new Uint8Array(10),
      ...matrix, new Uint8Array(24), this.u32(2))

    const tkhd = this.fullBox('tkhd', 0, 3,
      this.u32(0), this.u32(0), this.u32(1), this.u32(0), this.u32(movieDuration),
      new Uint8Array(8), this.u16(0), this.u16(0), this.u16(0), this.u16(0),
      ...matrix, this.u32(width << 16), this.u32(height << 16))

    const edts = reordered
      ? this.box('edts', this.fullBox('elst', 0, 0,
          this.u32(1), this.u32(movieDuration), this.u32(delay), this.u32(0x00010000)))
      : new Uint8Array(0)

    const mdhd = this.fullBox('mdhd', 0, 0,
      this.u32(0), this.u32(0), this.u32(fps), this.u32(count), this.u16(0x55c4), this.u16(0))
    const hdlr = this.fullBox('hdlr', 0, 0,
      this.u32(0), this.str('vide'), new Uint8Array(12), this.str('VideoHandler\0'))

    const avc1 = this.box('avc1',
      new Uint8Array(6), this.u16(1),            // reserved, data_reference_index
      new Uint8Array(16),                        // pre_defined + reserved
      this.u16(width), this.u16(height),
      this.u32(0x00480000), this.u32(0x00480000), // 72 dpi
      this.u32(0), this.u16(1),                  // reserved, frame_count
      new Uint8Array(32),                        // compressor name
      this.u16(0x0018), this.u16(0xffff),        // depth, pre_defined
      this.box('avcC', description))

    const keyframes = []
    samples.forEach((s, i) => { if (s.key) keyframes.push(this.u32(i + 1)) })

    const stbl = this.box('stbl',
      this.fullBox('stsd', 0, 0, this.u32(1), avc1),
      this.fullBox('stts', 0, 0, this.u32(1), this.u32(count), this.u32(1)),
      reordered
        ? this.fullBox('ctts', 0, 0, this.u32(count), ...offsets.flatMap(o => [this.u32(1), this.u32(o)]))
        : new Uint8Array(0),
      this.fullBox('stss', 0, 0, this.u32(keyframes.length), ...keyframes),
      this.fullBox('stsc', 0, 0, this.u32(1), this.u32(1), this.u32(count), this.u32(1)),
      this.fullBox('stsz', 0, 0, this.u32(0), this.u32(count), ...samples.map(s => this.u32(s.data.length))),
      this.fullBox('stco', 0, 0, this.u32(1), this.u32(firstSampleOffset)))

    const minf = this.box('minf',
      this.fullBox('vmhd', 0, 1, this.u16(0), new Uint8Array(6)),
      this.box('dinf', this.fullBox('dref', 0, 0, this.u32(1), this.fullBox('url ', 0, 1))),
      stbl)

    const moov = this.box('moov', mvhd,
      this.box('trak', tkhd, edts, this.box('mdia', mdhd, hdlr, minf)))

    return new Blob([ftyp, mdatHeader, ...samples.map(s => s.data), moov], { type: 'video/mp4' })
  },

  // ------------------------------------------------------------ byte helpers

  box(type, ...parts) {
    const payload = this.concat(...parts)
    return this.concat(this.u32(8 + payload.length), this.str(type), payload)
  },

  fullBox(type, version, flags, ...parts) {
    return this.box(type, new Uint8Array([version, flags >> 16, (flags >> 8) & 255, flags & 255]), ...parts)
  },

  u32(v) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0)
    return b
  },

  u16(v) {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setUint16(0, v & 0xffff)
    return b
  },

  str(s) {
    return Uint8Array.from(s, c => c.charCodeAt(0))
  },

  concat(...parts) {
    let length = 0
    parts.forEach(p => { length += p.length })
    const out = new Uint8Array(length)
    let offset = 0
    parts.forEach(p => { out.set(p, offset); offset += p.length })
    return out
  }
}
