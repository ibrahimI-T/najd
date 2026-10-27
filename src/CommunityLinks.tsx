import { Globe } from 'lucide-react'

// The Discord mark (simple-icons), drawn in the current text colour so it follows each theme.
function DiscordMark({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.319 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.211 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418z" /></svg>
}

// The sidebar's community card: a wide "join the community" button, then the website and the author's credit.
export function CommunityLinks({ language }: { language: 'ar' | 'en' }) {
  const ar = language === 'ar'
  const open = (name: 'community' | 'website' | 'author') => { void window.najdLinks?.open(name).catch(() => {}) }
  return <nav className="community" aria-label={ar ? 'المجتمع' : 'Community'}>
    <button type="button" className="community-join" data-link="community" onClick={() => open('community')}>
      <span className="community-mark"><DiscordMark size={20} /></span>
      <span className="community-text"><strong>{ar ? 'انضم إلى المجتمع' : 'Join the community'}</strong><small>{ar ? 'خادم نجد على ديسكورد' : 'NAJD on Discord'}</small></span>
    </button>
    <div className="community-row">
      <button type="button" className="community-chip" data-link="website" title="najdagent.si" onClick={() => open('website')}>
        <Globe size={15} /><span dir="ltr">najdagent.si</span>
      </button>
      <button type="button" className="community-chip" data-link="author" title={ar ? 'صُنع بواسطة FM' : 'Made by FM'} onClick={() => open('author')}>
        <DiscordMark size={15} /><span className="community-credit"><small>{ar ? 'صُنع بواسطة' : 'Made by'}</small><b dir="ltr">@fm.1</b></span>
      </button>
    </div>
  </nav>
}
