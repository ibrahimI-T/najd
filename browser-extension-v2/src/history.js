// Earlier chats of this browser session in the side panel: "New chat" keeps the chat it closes here, and the owner can reopen one.
// Like the open chat, the list lives in session storage only (cleared when the browser closes, and on unlink); every answer is also saved
// in NAJD's own conversations, which keep the full record.
export const MAX_CHATS = 10
const ASK_ID = /^[a-f0-9]{24}$/

// The list with `closing` kept at the top (replacing an earlier copy of the same chat), newest first, at most MAX_CHATS.
export function keepChat(chats, closing, now = Date.now()) {
  const list = (Array.isArray(chats) ? chats : []).filter(chat => chat && Array.isArray(chat.items) && chat.items.length && ASK_ID.test(chat.id))
  const items = (Array.isArray(closing) ? closing : []).filter(item => item && ASK_ID.test(item.id))
  if (!items.length) return list.slice(0, MAX_CHATS)
  const id = items[0].id
  const title = String(items[0].text || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return [{ id, title, at: now, count: items.length, items }, ...list.filter(chat => chat.id !== id)].slice(0, MAX_CHATS)
}

// Takes one chat out of the list to reopen it: { chat, rest }, or chat null when it is not there.
export function takeChat(chats, id) {
  const list = Array.isArray(chats) ? chats : []
  const chat = list.find(item => item && item.id === id) || null
  return { chat, rest: chat ? list.filter(item => item !== chat) : list }
}
