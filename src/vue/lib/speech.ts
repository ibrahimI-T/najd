// Read a reply aloud (after OpenClaw's text-to-speech and the reference app's read-aloud; owner request 2026-11-10 "outstanding NAJD").
// Uses the computer's own voices (Windows SAPI through the browser engine): free, offline, nothing leaves the computer.
// Code blocks, links and Markdown marks are not read; the language decides the voice.

export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')            // code blocks are not read aloud
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')       // pictures
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // links keep their words
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 20000)
}

export const languageOf = (text: string): 'ar' | 'en' => (text.match(/[؀-ۿ]/g)?.length || 0) > (text.match(/[A-Za-z]/g)?.length || 0) / 2 ? 'ar' : 'en'

// The best installed voice for the language: a local voice first, Arabic ones by their language tag.
export function pickVoice(voices: Pick<SpeechSynthesisVoice, 'lang' | 'localService' | 'name'>[], language: 'ar' | 'en') {
  const matching = voices.filter(voice => voice.lang.toLowerCase().startsWith(language))
  return matching.find(voice => voice.localService) || matching[0] || null
}
