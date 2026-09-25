// Draws obstacle maps procedurally instead of shipping rasterised PNGs.
//
// Every shape is sized against the *shorter* canvas axis with equal x/y
// scaling, so a circle is always a circle and a polygon is always regular,
// whatever the window's aspect ratio. Vertices come from R*cos(2*pi*k/n), so
// the shapes are symmetric to floating-point precision.
//
// Coordinate note: the compute shader samples the background with
// gl_FragCoord.xy / size, and gl_FragCoord.y counts up from the *bottom* while
// texture row 0 is the *top* of the image. Backgrounds are therefore displayed
// vertically mirrored. Canvas y is used directly as the on-screen "up" axis
// here, which cancels that mirroring out: a shape at y = 0.9 really does
// appear near the top.
'use strict'

const Shapes = {
  POLYGON_SIDES: [3, 4, 5, 6, 7, 8, 9, 10],
  OTHER_KINDS: ['circle', 'ellipse', 'star', 'slits'],

  /**
   * Places a bitmap obstacle map on a canvas of the requested size without
   * distorting it: scaled uniformly to fit and centred, with the margins left
   * transparent, i.e. ordinary free medium.
   */
  composite(image, width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (image.width > 0 && image.height > 0) {
      const scale = Math.min(width / image.width, height / image.height)
      const w = image.width * scale
      const h = image.height * scale
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
    }
    return canvas
  },

  /** Human-readable name used in the menu and the "Background" label. */
  describe(def) {
    const polygonNames = {
      3: 'Triangle', 4: 'Square', 5: 'Pentagon', 6: 'Hexagon',
      7: 'Heptagon', 8: 'Octagon', 9: 'Nonagon', 10: 'Decagon'
    }
    let name
    switch (def.kind) {
      case 'circle': name = 'Circle'; break
      case 'ellipse': name = 'Ellipse'; break
      case 'star': name = `${def.sides}-Point Star`; break
      case 'slits': name = def.slitCount === 1 ? 'Single Slit' : `${def.slitCount} Slits`; break
      default: name = polygonNames[def.sides] ?? `${def.sides}-gon`
    }
    // Hollow is the default, so only the unusual variants get a suffix.
    if (!def.hollow && def.kind !== 'slits') name += ' (filled)'
    if (def.invert) name += ' (inverted)'
    return name
  },

  render(def, width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    const alpha = clamp01(def.alpha)
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
    ctx.lineJoin = 'round'

    // Equal scale on both axes is what keeps the shapes regular.
    const unit = Math.min(width, height)
    const radius = (def.size * unit) / 2
    const cx = def.x * width
    const cy = def.y * height

    if (def.invert) {
      // Fill the world, then cut the shape out of it.
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(255, 255, 255, 1)'
      ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
    }

    this.tracePath(ctx, def, cx, cy, radius, unit, height)

    if (def.kind === 'slits') {
      ctx.fill()
    } else if (def.hollow) {
      ctx.lineWidth = Math.max(2, def.thickness * unit)
      ctx.stroke()
    } else {
      ctx.fill()
    }
    return canvas
  },

  tracePath(ctx, def, cx, cy, radius, unit, height) {
    ctx.beginPath()
    // Positive rotation reads as counter-clockwise on screen; the leading vertex
    // starts at the top so a triangle points up, a pentagon sits flat, etc.
    const phase = Math.PI / 2 - (def.rotation * Math.PI) / 180

    switch (def.kind) {
      case 'circle':
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        break

      case 'ellipse':
        ctx.ellipse(cx, cy, radius, radius * def.stretch, -phase + Math.PI / 2, 0, Math.PI * 2)
        break

      case 'star': {
        const points = Math.max(3, Math.round(def.sides))
        const inner = radius * clamp(def.innerRatio, 0.05, 0.95)
        for (let k = 0; k < points * 2; k++) {
          const r = k % 2 === 0 ? radius : inner
          const angle = phase + (k * Math.PI) / points
          const px = cx + r * Math.cos(angle)
          const py = cy + r * Math.sin(angle)
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.closePath()
        break
      }

      case 'slits': {
        const barrierThickness = Math.max(2, def.thickness * unit)
        const slitHeight = def.slitWidth * unit
        const spacing = def.slitSpacing * unit
        const count = Math.max(1, Math.round(def.slitCount))
        const left = cx - barrierThickness / 2
        // Gap centres spread symmetrically around cy; the barrier is drawn as
        // the segments *between* the gaps, top to bottom.
        const edges = [0]
        for (let i = 0; i < count; i++) {
          const c = cy + (i - (count - 1) / 2) * spacing
          edges.push(c - slitHeight / 2, c + slitHeight / 2)
        }
        edges.push(height)
        for (let i = 0; i < edges.length; i += 2) {
          if (edges[i + 1] > edges[i]) {
            ctx.rect(left, edges[i], barrierThickness, edges[i + 1] - edges[i])
          }
        }
        break
      }

      default: {
        const n = Math.max(3, Math.round(def.sides))
        for (let k = 0; k < n; k++) {
          const angle = phase + (k * 2 * Math.PI) / n
          const px = cx + radius * Math.cos(angle)
          const py = cy + radius * Math.sin(angle)
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.closePath()
        break
      }
    }
  },

  /**
   * Small preview for the menu, coloured the way the simulation shows it:
   * light is the medium the wave travels through, dark is wall.
   */
  thumbnail(def, width = 108, height = 72) {
    const map = this.render(def, width, height)

    // Recolour the alpha map to the shader's wall colour, vec4(0.1, 0.1, 0.3).
    const walls = document.createElement('canvas')
    walls.width = width
    walls.height = height
    const wallCtx = walls.getContext('2d')
    wallCtx.drawImage(map, 0, 0)
    wallCtx.globalCompositeOperation = 'source-in'
    wallCtx.fillStyle = '#1a1a4d'
    wallCtx.fillRect(0, 0, width, height)

    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')
    ctx.fillStyle = '#eef1fa'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(walls, 0, 0)
    return out.toDataURL('image/png')
  }
}
