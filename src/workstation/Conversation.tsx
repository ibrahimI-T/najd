import { isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowDown, Check, ChevronDown, CircleAlert, Copy, Pencil, RotateCcw, ShieldCheck, Square } from 'lucide-react'
import { CanvasProvider, CodeBlock, PromptBlock, type CanvasItem } from '../ChatBlocks'
import { ChartBlock } from '../RichContent'
import { buildActivity, formatCompact, summarize, type ActivityRow, type AgentActivityEvent } from '../activity'
import { Banner, Button, IconButton, useLang } from './ui'
import { errorText } from './errorText'
export { errorText }
import type { Conversation as Chat, WorkRun } from './useConversation'

function useLibraryImage(id: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let live = true; void window.najdLibrary?.thumbnail(id).then(value => { if (live) setUrl(value) }).catch(() => {}); return () => { live = false } }, [id])
  return url
}
// A picture from NAJD's library opens whole in a viewer, with the file opened in its program or shown in its folder.
export function ImageViewer({ id, src, name, onClose }: { id?: string; src: string; name: string; onClose: () => void }) {
  const { s } = useLang()
  const [failed, setFailed] = useState(false)
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [onClose])
  return <div className="c-viewer" role="dialog" aria-modal="true" aria-label={name} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }} data-image-viewer>
    <img src={src} alt={name} />
    <div className="c-viewer-bar"><bdi>{name}</bdi><span className="w-grow" />
      {id && window.najdLibrary?.open && <Button onClick={() => { void window.najdLibrary!.open!(id).then(opened => setFailed(!opened)).catch(() => setFailed(true)) }}>{s('فتح في البرنامج', 'Open in its app')}</Button>}
      {id && <Button onClick={() => { void window.najdLibrary?.reveal(id).catch(() => setFailed(true)) }}>{s('عرض في المجلد', 'Show in folder')}</Button>}
      <Button variant="primary" onClick={onClose} data-close>{s('إغلاق', 'Close')}</Button></div>
    {failed && <Banner tone="error">{s('تعذر فتح الملف.', 'The file could not be opened.')}</Banner>}
  </div>
}
function Picture({ id, name, className }: { id: string; name: string; className: string }) {
  const url = useLibraryImage(id), [open, setOpen] = useState(false)
  if (!url) return <span className="c-file" dir="auto">{name}</span>
  return <><button type="button" className="c-picture" onClick={() => setOpen(true)} aria-label={name} data-picture={id}><img className={className} src={url} alt={name} /></button>{open && <ImageViewer id={id} src={url} name={name} onClose={() => setOpen(false)} />}</>
}
function LibraryImage({ id, alt }: { id: string; alt: string }) { return <Picture id={id} name={alt || 'image'} className="c-media" /> }
function Attachment({ id, name }: { id: string; name: string }) { return <Picture id={id} name={name} className="c-sent-image" /> }

function Fence({ children }: { children?: ReactNode }) {
  const { lang, ar } = useLang()
  const code = isValidElement(children) ? children as ReactElement<{ children?: string; className?: string }> : null
  const text = String(code?.props.children ?? '').replace(/\n$/, ''), name = (code?.props.className?.replace(/^language-/, '') || 'text').toLowerCase()
  if (name === 'chart') return <ChartBlock source={text} ar={ar} />
  if (name === 'prompt') return <PromptBlock text={text} lang={lang} />
  return <CodeBlock text={text} fence={name} lang={lang} />
}
export function MessageBody({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith('najd-library://') || /^file:\/\/\//i.test(url) ? url : defaultUrlTransform(url)} components={{
    pre: ({ children }) => <Fence>{children}</Fence>,
    img: ({ alt, src }) => typeof src === 'string' && /^najd-library:\/\/[a-f0-9]{64}$/.test(src) ? <LibraryImage id={src.slice(15)} alt={alt || ''} /> : <span>{alt}</span>,
    table: ({ children }) => <div className="c-table"><table>{children}</table></div>,
    a: ({ children, href }) => href && /^file:\/\/\//i.test(href) ? <a href={href} onClick={event => { event.preventDefault(); void window.najdSessions?.openFile?.({ path: decodeURIComponent(href.replace(/^file:\/\/\//i, '')).replace(/\//g, '\\'), mode: 'open' }) }}>{children}</a> : <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
  }}>{text}</Markdown>
}

const STATUS = { running: '◌', succeeded: '✓', failed: '✕', cancelled: '–', 'awaiting-approval': '…', unconfirmed: '?' } as const
function Step({ event }: { event: AgentActivityEvent }) {
  return <li className={'a-step ' + event.status}><span aria-hidden>{STATUS[event.status]}</span><strong dir="auto">{event.title}</strong>{event.summary && <small dir="auto">{event.summary}</small>}{event.durationMs !== undefined && <time>{formatCompact(event.durationMs, 'en')}</time>}</li>
}
const rowEvents = (row: ActivityRow) => row.type === 'event' ? [row.event] : row.group.items
// Real task events only, shown in English with the agent's own work. Collapsed once the run is over; the steps stay available.
export function Activity({ run, onStop }: { run: WorkRun; onStop?: () => void }) {
  const view = buildActivity(run.activity)
  const live = !run.finishedAt
  const [open, setOpen] = useState(live)
  useEffect(() => { setOpen(live) }, [live])
  if (!view.events.length && !live) return null
  return <section className="a-box" dir="ltr" lang="en" data-activity={live ? 'running' : 'done'}>
    <button type="button" className="a-head" aria-expanded={open} onClick={() => setOpen(value => !value)}><ChevronDown size={14} aria-hidden data-open={open} />
      <span>{live ? (view.waiting ? 'Waiting for your approval' : 'Working') : summarize(view.counts, 'en') || 'Finished'}</span>
      {run.finishedAt && <time>{formatCompact(run.finishedAt - run.startedAt, 'en')}</time>}</button>
    {open && <ol className="a-steps">{view.rows.flatMap(rowEvents).map(event => <Step key={event.id} event={event} />)}</ol>}
    {onStop && live && <Button variant="ghost" icon={Square} onClick={onStop}>Stop</Button>}
  </section>
}

function CopyAction({ text }: { text: string }) {
  const { s } = useLang(), [done, setDone] = useState(false)
  return <IconButton label={s('نسخ', 'Copy')} icon={done ? Check : Copy} size={14} onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }) }} />
}


export function Thread({ chat, onCanvas, onEdit }: { chat: Chat; onCanvas: (item: CanvasItem) => void; onEdit: (text: string) => void }) {
  const { s, ar, lang } = useLang()
  const { messages, workRuns, activeSessionId, approval, busy, activeTaskId, importing } = chat
  const lastUser = [...messages].reverse().find(message => message.role === 'user')?.text
  const pending = workRuns.filter(run => run.sessionId === activeSessionId && !messages.slice(run.afterIndex).some(item => item.role === 'assistant')).slice(-1)
  const interrupted = !busy && !approval && !importing && messages.at(-1)?.role === 'user' && !workRuns.some(run => run.sessionId === activeSessionId)
  return <div className="c-scroll" ref={chat.scroll.ref} onScroll={chat.scroll.onScroll} data-thread>
    <CanvasProvider onOpen={onCanvas}><div className="c-list" aria-live="polite">{messages.map((message, index) => {
      const run: WorkRun | undefined = message.activity ? { key: 'saved:' + index, sessionId: activeSessionId, afterIndex: index, startedAt: Date.parse(message.activity.startedAt), finishedAt: message.activity.finishedAt ? Date.parse(message.activity.finishedAt) : Date.now(), steps: [], activity: message.activity }
        : message.role === 'assistant' ? workRuns.find(item => item.sessionId === activeSessionId && item.afterIndex === index) : undefined
      return <article key={index} className={'c-msg ' + message.role}>
        {message.role === 'assistant' && run && <Activity run={run} />}
        {!!message.attachments?.length && <div className="c-attached">{message.attachments.map(item => <Attachment key={item.id} id={item.id} name={item.name} />)}</div>}
        <div className="c-body" dir="auto">{message.role === 'user' ? message.text : <MessageBody text={message.text} />}</div>
        <div className="c-actions"><CopyAction text={message.text} />
          {message.role === 'user' && index === messages.length - 1 && !busy && <IconButton label={s('تعديل', 'Edit')} icon={Pencil} size={14} onClick={() => onEdit(message.text)} />}
          {message.role === 'assistant' && index === messages.length - 1 && !busy && lastUser && <IconButton label={s('إعادة المحاولة', 'Retry')} icon={RotateCcw} size={14} onClick={() => { void chat.submitText(lastUser, {}) }} />}
        </div>
      </article>
    })}</div></CanvasProvider>
    {pending.map(run => <Activity key={run.key} run={run} onStop={busy && activeTaskId || approval?.taskId ? () => { void chat.stop() } : undefined} />)}
    {interrupted && <Banner tone="warn" action={<Button onClick={() => { void chat.submitText(messages.at(-1)!.text, { alreadySaved: true }) }}>{s('أكمل الطلب', 'Resume the request')}</Button>}>{s('لم يصل رد على هذا الطلب: توقف العمل قبل أن يكتمل.', 'This request never got its answer: the work stopped before it finished.')}</Banner>}
    {approval && <section className="c-approval" role="alert" dir="ltr" lang="en" data-approval>
      <h3><ShieldCheck size={16} aria-hidden />Approval needed</h3>
      <p dir="auto">{approval.agent?.summary || (approval.localOnly ? 'Read this file for a local preview only.' : 'NAJD asks to carry out this action.')}</p>
      {approval.path && <code dir="ltr">{approval.path}</code>}
      {approval.agent?.body && <pre dir="ltr">{approval.agent.body}</pre>}
      <div><Button variant="primary" onClick={() => { void chat.respondToApproval('ALLOW_ONCE') }} disabled={busy}>Allow once</Button>
        {approval.agent && <Button onClick={() => { void chat.respondToApproval('ALLOW_TASK') }} disabled={busy}>Allow for this task</Button>}
        <Button variant="danger" onClick={() => { void chat.respondToApproval('DENY') }} disabled={busy}>Deny</Button></div>
    </section>}
    {chat.localPreview && chat.localPreview.sessionId === activeSessionId && <section className="c-preview" aria-label={s('معاينة محلية', 'Local preview')}><pre tabIndex={0}>{chat.localPreview.text}</pre><Button onClick={() => chat.setLocalPreview(null)}>{s('إزالة المعاينة', 'Clear preview')}</Button></section>}
    {chat.errorCode && <Banner tone={chat.errorCode === 'CANCELLED' ? 'info' : 'error'} action={<IconButton label={s('إغلاق', 'Dismiss')} icon={CircleAlert} onClick={() => chat.setErrorCode(null)} />}>{errorText(chat.errorCode, lang)}</Banner>}
    {chat.scroll.showLatest && <button type="button" className="c-latest" onClick={chat.scroll.toLatest} aria-label={ar ? 'آخر المحادثة' : 'Latest messages'}><ArrowDown size={15} aria-hidden /></button>}
  </div>
}
