// A small cascading dropdown menu, standing in for Angular Material's mat-menu.
//
// Items: { label, thumb?, thumbClass?, note?, action?: () => void, submenu?: Item[] }
// Opens below its trigger; submenus open to the side on hover, click or the
// right arrow key. Escape, a click outside, or choosing an item closes it.
'use strict'

const Menu = {
  layer: null,
  /** Open panels, outermost first. */
  panels: [],
  trigger: null,

  open(trigger, items) {
    this.close()
    this.trigger = trigger
    this.layer = document.createElement('div')
    this.layer.className = 'menu-layer'
    document.body.appendChild(this.layer)

    const rect = trigger.getBoundingClientRect()
    const panel = this.buildPanel(items, 0)
    this.place(panel, rect.left, rect.bottom + 2, null)
    panel.querySelector('.menu-item')?.focus()

    document.addEventListener('pointerdown', this.onOutside, true)
    document.addEventListener('keydown', this.onKey, true)
    window.addEventListener('resize', this.onResize)
    trigger.setAttribute('aria-expanded', 'true')
  },

  close() {
    if (!this.layer) {
      return
    }
    this.layer.remove()
    this.layer = null
    this.panels = []
    document.removeEventListener('pointerdown', this.onOutside, true)
    document.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('resize', this.onResize)
    if (this.trigger) {
      this.trigger.setAttribute('aria-expanded', 'false')
      this.trigger.focus({ preventScroll: true })
      this.trigger = null
    }
  },

  buildPanel(items, depth) {
    const panel = document.createElement('div')
    panel.className = 'menu-panel'
    panel.setAttribute('role', 'menu')
    for (const item of items) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'menu-item'
      button.setAttribute('role', 'menuitem')
      if (item.thumb) {
        const holder = document.createElement('span')
        holder.className = 'menu-thumb-holder'
        const img = document.createElement('img')
        img.className = item.thumbClass ?? 'menu-thumb'
        img.src = item.thumb
        img.alt = ''
        holder.appendChild(img)
        button.appendChild(holder)
      }
      const label = document.createElement('span')
      label.className = 'menu-label'
      label.textContent = item.label
      button.appendChild(label)
      if (item.note) {
        const note = document.createElement('span')
        note.className = 'menu-note'
        note.textContent = item.note
        button.appendChild(note)
      }
      if (item.submenu) {
        button.setAttribute('aria-haspopup', 'menu')
        button.appendChild(icon('i-arrow-right', 'menu-arrow'))
        const openSub = focusFirst => this.openSubmenu(button, item.submenu, depth, focusFirst)
        button.addEventListener('pointerenter', () => openSub(false))
        button.addEventListener('click', () => openSub(true))
      } else {
        button.addEventListener('pointerenter', () => this.closeFrom(depth + 1))
        button.addEventListener('click', () => {
          this.close()
          item.action?.()
        })
      }
      panel.appendChild(button)
    }
    this.closeFrom(depth)
    this.panels.push(panel)
    this.layer.appendChild(panel)
    return panel
  },

  openSubmenu(button, items, depth, focusFirst) {
    // Already open for this very item: nothing to do.
    if (this.panels[depth + 1] && this.panels[depth + 1].owner === button) {
      if (focusFirst) this.panels[depth + 1].querySelector('.menu-item')?.focus()
      return
    }
    const panel = this.buildPanel(items, depth + 1)
    panel.owner = button
    const parent = this.panels[depth].getBoundingClientRect()
    const row = button.getBoundingClientRect()
    this.place(panel, parent.right, row.top - 8, parent.left)
    this.panels[depth].querySelectorAll('.menu-item').forEach(b => b.classList.toggle('open', b === button))
    if (focusFirst) {
      panel.querySelector('.menu-item')?.focus()
    }
  },

  /** Removes every panel at `depth` and deeper. */
  closeFrom(depth) {
    while (this.panels.length > depth) {
      this.panels.pop().remove()
    }
    this.panels[depth - 1]?.querySelectorAll('.menu-item.open').forEach(b => b.classList.remove('open'))
  },

  /** Keeps a panel on screen; flips a submenu to the left when it would overflow. */
  place(panel, left, top, flipRight) {
    const margin = 8
    const { width, height } = panel.getBoundingClientRect()
    if (left + width > window.innerWidth - margin) {
      left = flipRight != null ? flipRight - width : window.innerWidth - margin - width
    }
    if (top + height > window.innerHeight - margin) {
      top = window.innerHeight - margin - height
    }
    panel.style.left = `${Math.max(margin, left)}px`
    panel.style.top = `${Math.max(margin, top)}px`
  },

  onOutside: e => {
    if (Menu.layer && !Menu.layer.contains(e.target)) {
      // Swallow the click on the trigger itself, so it does not reopen.
      if (Menu.trigger && Menu.trigger.contains(e.target)) {
        e.stopPropagation()
        e.preventDefault()
        Menu.trigger.dataset.justClosed = '1'
      }
      Menu.close()
    }
  },

  onResize: () => Menu.close(),

  onKey: e => {
    const panel = Menu.panels.find(p => p.contains(document.activeElement)) ?? Menu.panels[Menu.panels.length - 1]
    if (!panel) {
      return
    }
    const items = [...panel.querySelectorAll('.menu-item')]
    const index = items.indexOf(document.activeElement)
    const depth = Menu.panels.indexOf(panel)
    switch (e.key) {
      case 'Escape':
        Menu.close()
        break
      case 'ArrowDown':
        items[(index + 1) % items.length].focus()
        break
      case 'ArrowUp':
        items[(index - 1 + items.length) % items.length].focus()
        break
      case 'ArrowRight':
        if (document.activeElement?.getAttribute('aria-haspopup')) {
          document.activeElement.click()
        }
        break
      case 'ArrowLeft':
        if (depth > 0) {
          const owner = panel.owner
          Menu.closeFrom(depth)
          owner?.focus()
        }
        break
      case 'Tab':
        Menu.close()
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }
}

/** An inline SVG icon from the sprite in index.html. */
function icon(id, className) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''))
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', '#' + id)
  svg.appendChild(use)
  return svg
}
