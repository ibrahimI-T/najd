// A test-owned Electron window shaped like a chat app (Claude, Kimi, ChatGPT desktop): the conversation and its input sit more than
// 20 levels deep, the input is a rich contenteditable editor (no plain value), and Send appends the message to the conversation.
// Started by tests/desktop-electron-smoke.cjs with its title as the first argument; nothing here touches any user window.
const { app, BrowserWindow } = require('electron')
const title = process.argv.find(arg => arg.startsWith('--title='))?.slice(8) || 'NAJD Deep Chat Fixture'
const nest = (depth, inner) => depth ? `<div class="n${depth}">${nest(depth - 1, inner)}</div>` : inner
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>body{font:15px system-ui;margin:0;padding:16px;background:#1d1d1f;color:#eee} #log p{margin:6px 0} #box{min-height:40px;border:1px solid #777;padding:8px;margin:12px 0;border-radius:8px} button{padding:8px 16px}</style></head>
<body><nav aria-label="Conversations">${Array.from({ length: 40 }, (_, i) => `<a href="#c${i}">Conversation ${i}</a> `).join('')}</nav>
${nest(22, `<main aria-label="Chat"><section id="log" aria-label="Messages"><p>Assistant: The quarterly numbers are ready for review.</p><p>You: Thanks, summarise them.</p></section>
<div id="box" role="textbox" aria-label="Message" aria-multiline="true" contenteditable="true"></div><button id="send" aria-label="Send message">Send</button><p id="status">Nothing sent</p></main>`)}
<script>document.getElementById('send').addEventListener('click', () => { const box = document.getElementById('box'); const text = box.innerText.trim(); if (!text) return; const p = document.createElement('p'); p.textContent = 'You: ' + text; document.getElementById('log').appendChild(p); box.innerText = ''; document.getElementById('status').textContent = 'Sent: ' + text })</script>
</body></html>`
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 760, height: 620, x: 80, y: 80, title, webPreferences: { sandbox: true, contextIsolation: true } })
  win.on('page-title-updated', event => event.preventDefault())
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
app.on('window-all-closed', () => app.quit())
