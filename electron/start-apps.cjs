// Apps installed on this computer, as the Start menu lists them (owner request 2026-10-20: "open Discord" must work
// for any installed app, asked in Arabic or English). Get-StartApps lists desktop programs and Store apps with the
// AppID Start itself uses; the desktop host opens one through shell:AppsFolder. The list is read in the user's own
// session and kept for five minutes.
const { execFile } = require('node:child_process')

// Common Arabic spellings of app names, so a request written in Arabic finds the English Start entry.
const ARABIC = {
  'ديسكورد': 'discord', 'دسكورد': 'discord', 'واتساب': 'whatsapp', 'واتس اب': 'whatsapp', 'واتس': 'whatsapp', 'تيليجرام': 'telegram', 'تلقرام': 'telegram', 'تليجرام': 'telegram',
  'سبوتيفاي': 'spotify', 'زوم': 'zoom', 'زووم': 'zoom', 'ستيم': 'steam', 'تيمز': 'teams', 'سكايب': 'skype', 'سلاك': 'slack',
  'وورد': 'word', 'ورد': 'word', 'اكسل': 'excel', 'إكسل': 'excel', 'بوربوينت': 'powerpoint', 'باوربوينت': 'powerpoint', 'اوتلوك': 'outlook', 'أوتلوك': 'outlook', 'ون نوت': 'onenote',
  'فوتوشوب': 'photoshop', 'اليستريتور': 'illustrator', 'بريمير': 'premiere', 'فيجوال ستوديو كود': 'visual studio code', 'في اس كود': 'visual studio code',
  'كروم': 'chrome', 'جوجل كروم': 'chrome', 'ايدج': 'edge', 'إيدج': 'edge', 'فايرفوكس': 'firefox', 'اوبرا': 'opera', 'بريف': 'brave',
  'المفكرة': 'notepad', 'الحاسبة': 'calculator', 'الرسام': 'paint', 'الكاميرا': 'camera', 'الصور': 'photos', 'المتجر': 'microsoft store',
  'اوبس': 'obs', 'في ال سي': 'vlc', 'نتفلكس': 'netflix', 'يوتيوب': 'youtube', 'انستقرام': 'instagram', 'تيك توك': 'tiktok', 'ماينكرافت': 'minecraft'
}
const normal = text => String(text).toLowerCase().normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim()

function createStartApps({ run = defaultRun, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  let cached = null, at = 0
  async function list() {
    if (cached && now() - at < ttlMs) return cached
    const text = await run()
    const parsed = JSON.parse(text || '[]')
    cached = (Array.isArray(parsed) ? parsed : [parsed])
      .filter(row => typeof row?.Name === 'string' && typeof row?.AppID === 'string' && row.AppID.length <= 512 && !/[\x00-\x1f"]/.test(row.AppID))
      .map(row => ({ name: row.Name.slice(0, 200), appId: row.AppID }))
    at = now()
    return cached
  }
  // The best Start entry for a name: exact, then starting with it, then containing it. Uninstallers, help files and
  // readme entries are passed over when the app itself is there.
  // exact: only a Start entry with exactly this name (used for names that could also be file names, like Paint.NET).
  async function find(name, { exact = false } = {}) {
    const wanted = normal(ARABIC[normal(name)] || name)
    if (!wanted || wanted.length > 200) return { match: null, suggestions: [] }
    const apps = await list()
    const usable = apps.filter(app => !/uninstall|readme|help|license|release notes|إلغاء التثبيت/i.test(app.name) && !/\.(rtf|txt|html?|chm|pdf|url)$/i.test(app.appId))
    const named = usable.map(app => ({ app, key: normal(app.name) }))
    const match = (named.find(row => row.key === wanted) || !exact && (named.find(row => row.key.startsWith(wanted + ' ') || row.key.startsWith(wanted)) ||
      named.find(row => row.key.includes(wanted))))?.app || null
    const words = wanted.split(' ').filter(word => word.length > 2)
    const suggestions = match ? [] : named.filter(row => words.some(word => row.key.includes(word))).slice(0, 10).map(row => row.app.name)
    return { match, suggestions }
  }
  return { list, find }
}

function defaultRun() {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress'],
  { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (failure, stdout) => failure ? reject(failure) : resolve(stdout)))
}

module.exports = { createStartApps, ARABIC }
