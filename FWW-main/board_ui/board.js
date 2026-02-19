(function(){
  const BoardUI = {
    root: null,
    mount(root){
      if(!root) return
      this.root = root
      this.root.classList.add('board')
    },
    render(stacks){
      if(!this.root) return
      this.root.innerHTML = ''
      (stacks||[]).forEach(stack=>{
        this.root.appendChild(this._renderStack(stack))
      })
    },
    _renderStack(meta){
      const section = document.createElement('section')
      section.className = 'board__stack'

      const head = document.createElement('div')
      head.className = 'stack__head'
      const tag = document.createElement('span')
      tag.className = 'stack__tag'
      tag.textContent = meta.kind || ''
      const title = document.createElement('div')
      title.className = 'stack__title'
      title.textContent = meta.title || ''
      head.appendChild(tag)
      head.appendChild(title)
      section.appendChild(head)

      section.appendChild(this._renderCard(meta))

      if(Array.isArray(meta.children) && meta.children.length){
        const children = document.createElement('div')
        children.className = 'stack__children'
        meta.children.forEach(child=>{
          if(child && child.type==='mod'){
            children.appendChild(this._renderModChip(child))
          }
        })
        section.appendChild(children)
      }

      return section
    },
    _renderCard(meta){
      const card = document.createElement('div')
      card.classList.add('card')
      const isPortrait = meta.powerArmor || meta.portrait !== false
      card.classList.add(isPortrait ? 'card--portrait' : 'card--landscape')
      if(meta.powerArmor) card.classList.add('card--power-armor')

      const frame = document.createElement('div')
      frame.className = 'card__frame card-preview'
      // Оставляем только оружие (weapon) горизонтальным.
      // Броню (armor), химию (chem), алкоголь (alcohol) и моды (mod) убираем из списка, чтобы они были вертикальными.
      const isLandscapeByType = ['weapon'].includes((meta.type || '').toLowerCase())

      // Убираем meta.powerArmor из условия isLandscape, чтобы силовая броня тоже могла быть вертикальной
      const isLandscape = isLandscapeByType || (meta.portrait === false)
      frame.classList.add(isLandscape ? 'card-preview--landscape' : 'card-preview--portrait')

      const img = document.createElement('img')
      img.className = 'card__img'
      img.loading = 'lazy'
      img.decoding = 'async'
      img.alt = meta.title || meta.id || ''
      img.src = meta.img || this._fallbackImg(meta.kind)
      img.onerror = ()=>{ img.src = this._fallbackImg(meta.kind) }

      frame.appendChild(img)
      card.appendChild(frame)

      const title = document.createElement('h3')
      title.className = 'card__title'
      title.textContent = meta.title || ''
      card.appendChild(title)

      const toolbar = document.createElement('div')
      toolbar.className = 'card__toolbar'
      if(Array.isArray(meta.actions)){
        meta.actions.forEach(action=>{
          const btn = document.createElement('button')
          btn.className = 'btn'
          if(action.kind) btn.classList.add(`btn--${action.kind}`)
          btn.textContent = action.label || action.id || ''
          if(typeof action.handler === 'function'){
            btn.addEventListener('click', action.handler)
          }
          toolbar.appendChild(btn)
        })
      }
      card.appendChild(toolbar)

      return card
    },
    _renderModChip(meta){
      const chip = document.createElement('div')
      chip.className = 'mod-chip'

      const title = document.createElement('div')
      title.className = 'mod-chip__title'
      title.textContent = meta.title || ''
      chip.appendChild(title)

      const actions = document.createElement('div')
      actions.className = 'mod-chip__actions'
      if(Array.isArray(meta.actions)){
        meta.actions.forEach(action=>{
          const btn = document.createElement('button')
          btn.className = 'btn'
          if(action.kind) btn.classList.add(`btn--${action.kind}`)
          btn.textContent = action.label || action.id || ''
          if(typeof action.handler === 'function'){
            btn.addEventListener('click', action.handler)
          }
          actions.appendChild(btn)
        })
      }
      chip.appendChild(actions)

      return chip
    },
    _fallbackImg(kind){
      if((kind||'').toLowerCase()==='character') return 'images/missing-unit.png'
      return 'images/missing-item.png'
    }
  }

  window.BoardUI = BoardUI
})()

// Example adapter skeleton:
// function buildStacks(state, db) {
//   return (state.roster.units||[]).map(unit => ({
//     kind: 'character',
//     id: unit.id,
//     title: unit.name,
//     img: unit.img,
//     portrait: true,
//     powerArmor: false,
//     actions: [],
//     children: (unit.cards||[]).map(card => ({
//       type: 'mod',
//       id: card.modId || card.itemId,
//       title: card.modId ? db.itemsById[card.modId]?.name : db.itemsById[card.itemId]?.name,
//       actions: []
//     }))
//   }))
// }
