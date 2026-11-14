// Icon tiles for catalog cards (same rules as src/workstation/MarketView.tsx), with the Vue icon set.
import type { Component } from 'vue'
import { BookOpen, Bot, Box, Brain, Code, Database, FileSpreadsheet, FileText, Globe, GraduationCap, Landmark, Mail, Megaphone, Microscope, Monitor, Music, Palette, PenLine, Presentation, Puzzle, Scale, Search, Smartphone, Video, Wand2, Wrench } from 'lucide-vue-next'
import type { CatalogEntry } from '../../workstation/types'
type Glyph = Component
const ICONS: [RegExp, Glyph, string][] = [
  [/pdf/, FileText, '#e5484d'], [/excel|sheet|xlsx/, FileSpreadsheet, '#30a46c'], [/word|docx/, FileText, '#3e63dd'], [/slide|pptx|keynote|presentation/, Presentation, '#f76b15'],
  [/github|code|dev|test|refactor|api|terraform/, Code, '#8e8c99'], [/image|logo|design|theme|palette/, Palette, '#e93d82'], [/3d|model3d|scene/, Box, '#8e4ec6'], [/video/, Video, '#e5484d'],
  [/audio|tts|podcast|speech/, Music, '#12a594'], [/scholar|academic|cite|anki|cv|interview/, GraduationCap, '#0090ff'], [/imf|finance|stock|equity|invest|pricing|saas|value/, Landmark, '#f5d90a'],
  [/world-bank|igo|data|metrics/, Database, '#12a594'], [/edgar|legal|tos|regulat|iso|risk/, Scale, '#a1a1aa'], [/browser|web|seo|landing|site/, Globe, '#0090ff'], [/computer|desktop/, Monitor, '#0090ff'],
  [/mobile|android|ios|wechat/, Smartphone, '#30a46c'], [/mail|newsletter/, Mail, '#3e63dd'], [/marketing|campaign|copy|churn|ad-/, Megaphone, '#f76b15'], [/research|scientific|cross-examine/, Microscope, '#3e63dd'],
  [/humanizer|writing|writer|edit/, PenLine, '#e5484d'], [/find-skills|search/, Search, '#30a46c'], [/agent|delegat|automation/, Bot, '#8e4ec6'], [/brain|memory|plan/, Brain, '#e93d82'],
  [/doc|guide|glossary|minutes|recap/, BookOpen, '#0090ff'], [/tool|builder|creator/, Wrench, '#8e8c99']
]
export function iconFor(entry: Pick<CatalogEntry, 'id' | 'kind' | 'categories'>): [Glyph, string] {
  const key = (entry.id + ' ' + entry.categories.join(' ')).toLowerCase()
  const found = ICONS.find(([pattern]) => pattern.test(key))
  return found ? [found[1], found[2]] : entry.kind === 'plugin' ? [Puzzle, '#8e8c99'] : [Wand2, '#8e8c99']
}

