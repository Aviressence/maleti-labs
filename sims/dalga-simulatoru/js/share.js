// Scene links, local persistence and device detection.
//
// A whole scene fits in the URL fragment (a few hundred bytes of JSON) because
// backgrounds are stored as shape definitions or bundled-asset keys, not as
// pixels. An uploaded bitmap is the one thing that cannot travel in a link.
'use strict'

const Share = {
  PREFIX: '#s=',
  /** Anything longer than this in the fragment is not ours; ignore it. */
  MAX_FRAGMENT: 8192,

  hasUnshareableContent(params) {
    return isUploadSrc(params.backgroundImage?.src) || isUploadSrc(params.gradientImage?.src)
  },

  buildLink(params) {
    // Round-trip through the sanitiser with uploads disabled: that drops the
    // transient playback state and any uploaded image in one go.
    const payload = sanitizeParameters(params, { isMobile: false, allowUploads: false })
    delete payload.pause
    delete payload.nextFrame
    const base = location.href.split('#')[0]
    return base + this.PREFIX + this.encode(JSON.stringify(payload))
  },

  /** Reads a scene out of the current URL, or null. Never trusted as-is. */
  readFromLocation() {
    const hash = location.hash
    if (!hash.startsWith(this.PREFIX) || hash.length > this.MAX_FRAGMENT) {
      return null
    }
    try {
      return JSON.parse(this.decode(hash.slice(this.PREFIX.length)))
    } catch (e) {
      console.warn('Ignoring unreadable shared scene', e)
      return null
    }
  },

  /** Removes the fragment so later edits are not mistaken for the shared scene. */
  clearLocation() {
    if (location.hash.startsWith(this.PREFIX)) {
      try {
        history.replaceState(null, '', location.href.split('#')[0])
      } catch {
        location.hash = ''
      }
    }
  },

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // The async clipboard needs a secure context, which file:// may not be.
      try {
        const field = document.createElement('textarea')
        field.value = text
        field.className = 'offscreen'
        document.body.appendChild(field)
        field.select()
        const ok = document.execCommand('copy')
        field.remove()
        return ok
      } catch {
        return false
      }
    }
  },

  // URL-safe base64 over UTF-8 bytes.
  encode(text) {
    let binary = ''
    new TextEncoder().encode(text).forEach(b => { binary += String.fromCharCode(b) })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },

  decode(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4))
    return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
  }
}

const SavedSettings = {
  load() {
    try {
      const text = localStorage.getItem(STORAGE_KEY)
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  },

  save(params) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params))
    } catch (e) {
      // An uploaded image can blow past the ~5 MB quota, and some browsers
      // refuse storage on file:// entirely. Losing the save beats crashing.
      console.warn('Could not save settings', e)
    }
  },

  clear() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch { /* storage unavailable */ }
  }
}

/**
 * Phone/tablet or desktop: phones get a coarser default grid and no LOD picker.
 */
const IS_MOBILE = (() => {
  const ua = navigator.userAgent
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const uaLooksMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
  // iPadOS 13+ reports itself as a Mac, so fall back to touch point detection.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return uaLooksMobile || iPadOS || (coarsePointer && window.innerWidth < 1024)
})()
