import { useEffect, useRef } from 'react'
import { GROUP_LABEL, type SlashItem } from './slashCommands'

// The list that opens above the message box when the message starts with "/". The text box keeps the focus; the menu is driven by its keyboard handler
// (ArrowUp/ArrowDown, Enter or Tab to choose, Escape to close), so it is a listbox the text box points to with aria-activedescendant.
export function SlashMenu({ id, items, index, language, onChoose, onHover }: {
  id: string; items: SlashItem[]; index: number; language: 'ar' | 'en'; onChoose(item: SlashItem): void; onHover(index: number): void
}) {
  const active = useRef<HTMLDivElement>(null)
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest' }) }, [index, items])
  if (!items.length) return null
  return <ul className="slash-menu" id={id} role="listbox" aria-label={language === 'ar' ? 'الأوامر' : 'Commands'}>
    {items.map((item, position) => {
      const heading = position === 0 || items[position - 1].group !== item.group
      return <li key={item.id} role="presentation">
        {heading && <div className="slash-group" aria-hidden="true">{GROUP_LABEL[item.group][language]}</div>}
        <div role="option" id={`${id}-${item.id}`} aria-selected={position === index} aria-disabled={item.disabled ? true : undefined} data-slash={item.command}
          className={'slash-item' + (position === index ? ' active' : '') + (item.disabled ? ' disabled' : '')} ref={position === index ? active : undefined}
          onMouseEnter={() => onHover(position)} onMouseDown={event => { event.preventDefault(); onChoose(item) }}>
          <bdi dir="ltr" className="slash-command">/{item.command}</bdi>
          <span className="slash-label" dir="auto">{item.label}</span>
          <small className="slash-hint" dir="auto">{item.disabled || item.hint}</small>
        </div>
      </li>
    })}
  </ul>
}
