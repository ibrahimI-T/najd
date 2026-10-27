import { isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { useThumbnail } from './AttachmentChips'
import { ImageViewer } from './ImageViewer'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChartBlock } from './RichContent'
import { CodeBlock, PromptBlock } from './ChatBlocks'

// Pictures and videos from NAJD's own library (screenshots, generated media); external images stay as text. A click shows it whole.
function LibraryMedia({ id, alt, language }: { id: string; alt: string; language: 'ar' | 'en' }) {
  const url = useThumbnail(id)
  const [open, setOpen] = useState(false)
  if (!url) return <span className="library-media-missing">{alt}</span>
  return <>
    <button type="button" className="library-media-open" onClick={() => setOpen(true)} aria-label={language === 'ar' ? 'عرض الصورة كاملة' : 'View the picture'}><img className="library-media" src={url} alt={alt} /></button>
    {open && <ImageViewer src={url} alt={alt} ar={language === 'ar'} onClose={() => setOpen(false)} />}
  </>
}

// What the owner attached to a message: pictures as previews, other files by name.
function SentAttachment({ id, name, language }: { id: string; name: string; language: 'ar' | 'en' }) {
  const url = useThumbnail(id)
  const [open, setOpen] = useState(false)
  if (!url) return <span dir="auto">{name}</span>
  return <>
    <button type="button" className="sent-picture" onClick={() => setOpen(true)} title={name} aria-label={(language === 'ar' ? 'عرض ' : 'View ') + name}><img src={url} alt="" /></button>
    {open && <ImageViewer src={url} alt={name} ar={language === 'ar'} onClose={() => setOpen(false)} />}
  </>
}

function FencedBlock({ children, language }: { children?: ReactNode; language: 'ar' | 'en' }) {
  const code = isValidElement(children) ? children as ReactElement<{children?: string; className?: string}> : null
  const text = String(code?.props.children ?? '').replace(/\n$/, '')
  const name = (code?.props.className?.replace(/^language-/, '') || 'text').toLowerCase()
  // Defined rich blocks: charts are drawn as SVG, prompts get a copy box; everything else (pages, SVG and Mermaid
  // included) is a code block with copy, download, preview and the side panel.
  if (name === 'chart') return <ChartBlock source={text} ar={language === 'ar'} />
  if (name === 'prompt') return <PromptBlock text={text} lang={language} />
  return <CodeBlock text={text} fence={name} lang={language} />
}

export function ChatMessage({ message, language, activity }: { message: NajdMessage; language: 'ar' | 'en'; activity?: ReactNode }) {
  return <div className={'message-turn ' + message.role}>
    {message.role === 'assistant' && activity}
    <article className={'message ' + message.role}>
    {!!message.attachments?.length && <div className="message-attachments">{message.attachments.map(item => <SentAttachment key={item.id} id={item.id} name={item.name} language={language} />)}</div>}
    {message.role === 'assistant' && <span className="message-brand" dir="ltr">NAJD</span>}
    <div className="message-body" dir="auto">{message.role === 'user' ? message.text : <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith("najd-library://") || /^file:\/\/\//i.test(url) ? url : defaultUrlTransform(url)} components={{
      pre: ({ children }) => <FencedBlock language={language}>{children}</FencedBlock>,
      img: ({ alt, src }) => typeof src === 'string' && /^najd-library:\/\/[a-f0-9]{64}$/.test(src) ? <LibraryMedia id={src.slice(15)} alt={alt || ''} language={language} /> : <span>{alt}</span>,
      table: ({ children }) => <div className="message-table"><table>{children}</table></div>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
    }}>{message.text}</Markdown>}</div>
    </article>
  </div>
}
