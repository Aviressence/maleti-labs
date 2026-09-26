// Local persistence and device detection.
'use strict'

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
