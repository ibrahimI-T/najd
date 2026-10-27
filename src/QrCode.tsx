import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// A QR code drawn as SVG rects (no script, no network), dark on a white tile so every phone camera reads it.
export function QrCode({ value, size = 184, label }: { value: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(value, 'Byte')
    code.make()
    const count = code.getModuleCount(), dark: [number, number][] = []
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (code.isDark(row, col)) dark.push([col, row])
    return { count, dark }
  }, [value])
  const quiet = 4, span = cells.count + quiet * 2
  return <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${span} ${span}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width={span} height={span} fill="#fff" />
    {cells.dark.map(([x, y]) => <rect key={x + '-' + y} x={x + quiet} y={y + quiet} width={1} height={1} fill="#111" />)}
  </svg>
}
