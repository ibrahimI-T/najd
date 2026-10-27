// A small Telegram Bot API client (long polling, no public address needed). The bot token is never put in an error, a log or a URL shown to anyone.
const fail = code => Object.assign(new Error(code), { code })

function createTelegramApi({ token, fetchImpl = globalThis.fetch }) {
  if (typeof token !== 'string' || !/^\d{6,}:[\w-]{30,}$/.test(token)) throw fail('INVALID_TOKEN')
  async function call(method, body = {}, { signal, timeoutMs = 20000 } = {}) {
    let response
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]) })
    } catch (error) { throw fail(signal?.aborted ? 'CANCELLED' : 'NETWORK') }
    let data
    try { data = await response.json() } catch { throw fail('BAD_RESPONSE') }
    if (!data || data.ok !== true) {
      if (response.status === 401 || response.status === 404) throw fail('INVALID_TOKEN')
      if (response.status === 409) throw fail('CONFLICT') // another process is polling this bot
      if (response.status === 429) throw Object.assign(fail('RATE_LIMITED'), { retryAfter: Number(data?.parameters?.retry_after) || 5 })
      throw fail('API_ERROR')
    }
    return data.result
  }
  // A photo goes up as multipart form data (JSON cannot carry bytes); same error rules as call().
  async function upload(method, form, { timeoutMs = 60000 } = {}) {
    let response
    try { response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', redirect: 'error', body: form, signal: AbortSignal.timeout(timeoutMs) }) } catch { throw fail('NETWORK') }
    let data
    try { data = await response.json() } catch { throw fail('BAD_RESPONSE') }
    if (!data || data.ok !== true) { if (response.status === 429) throw Object.assign(fail('RATE_LIMITED'), { retryAfter: Number(data?.parameters?.retry_after) || 5 }); throw fail('API_ERROR') }
    return data.result
  }
  return {
    getMe: signal => call('getMe', {}, { signal }),
    // bytes: a Buffer of a JPEG or PNG (at most 10 MB, Telegram's photo limit).
    sendPhoto: (chatId, bytes, { mime = 'image/jpeg', caption } = {}) => {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) return Promise.reject(fail('INVALID_INPUT'))
      const form = new FormData()
      form.set('chat_id', String(chatId))
      if (caption) form.set('caption', String(caption).slice(0, 1000))
      form.set('photo', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'najd.png' : 'najd.jpg')
      return upload('sendPhoto', form)
    },
    // Long poll: the request itself waits up to `timeout` seconds, so the client timeout is longer.
    getUpdates: (offset, signal, timeout = 25) => call('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] }, { signal, timeoutMs: (timeout + 10) * 1000 }),
    sendMessage: (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
    editMessageText: (chatId, messageId, text, extra = {}) => call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra }),
    answerCallbackQuery: (id, text) => call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }),
    deleteMessage: (chatId, messageId) => call('deleteMessage', { chat_id: chatId, message_id: messageId }),
    // A file the owner sent (a photo): its bytes, at most maxBytes (Telegram bots can download up to 20 MB). The download URL carries the token,
    // so it is built here and never shown anywhere.
    async downloadFile(fileId, maxBytes = 10 * 1024 * 1024) {
      if (typeof fileId !== 'string' || !/^[\w-]{10,200}$/.test(fileId)) throw fail('INVALID_INPUT')
      const info = await call('getFile', { file_id: fileId })
      if (!info || typeof info.file_path !== 'string' || !/^[\w./-]{1,200}$/.test(info.file_path) || info.file_path.includes('..')) throw fail('BAD_RESPONSE')
      if (Number(info.file_size) > maxBytes) throw fail('FILE_TOO_LARGE')
      let response
      try { response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${info.file_path}`, { redirect: 'error', signal: AbortSignal.timeout(60000) }) } catch { throw fail('NETWORK') }
      if (!response.ok || !response.body) throw fail('API_ERROR')
      const parts = []
      let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw fail('FILE_TOO_LARGE'); parts.push(chunk) }
      return { bytes: Buffer.concat(parts), path: info.file_path }
    },
    sendChatAction: (chatId, action = 'typing') => call('sendChatAction', { chat_id: chatId, action }),
    setMyCommands: commands => call('setMyCommands', { commands })
  }
}
module.exports = { createTelegramApi }
