type ResolvedTheme = 'dark' | 'light' | 'navy' | 'najd' | 'graphite'

function channels(hex: string): number[] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(value => {
    const normalized = value / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function blend(first: string, second: string, weight: number): string {
  const a = channels(first)
  const b = channels(second)
  return '#' + a.map((value, index) => Math.round(value * (1 - weight) + b[index] * weight).toString(16).padStart(2, '0')).join('')
}

export function accessibleAccent(chosen: string, theme: ResolvedTheme): string {
  // Najd Gold keeps its antique-gold identity regardless of the chosen accent.
  if (theme === 'najd') return '#d7ac62'
  const background = theme === 'navy' ? '#0b1324' : theme === 'dark' ? '#171717' : theme === 'graphite' ? '#0a0a0b' : '#f8f8f8'
  const target = theme === 'light' ? '#171717' : '#f4f4f4'
  for (let step = 0; step <= 20; step++) {
    const candidate = blend(chosen, target, step / 20)
    if (contrastRatio(candidate, background) >= 4.5) return candidate
  }
  return target
}

export function accentInk(accent: string): string {
  return contrastRatio(accent, '#071329') > contrastRatio(accent, '#ffffff') ? '#071329' : '#ffffff'
}
