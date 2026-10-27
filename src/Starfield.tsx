import { useEffect, useRef } from 'react'

// The graphite theme's night sky behind the chat: slowly twinkling stars and, now and then, a shooting star. Once a
// conversation has messages the sky fades into the calm graphite surface (calm). Static under reduced motion; paused
// while the window is hidden; never catches pointer events.
type Star = { x: number; y: number; r: number; base: number; speed: number; phase: number }
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; length: number }

export function Starfield({ calm }: { calm: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars: Star[] = [], meteors: Meteor[] = [], width = 0, height = 0, frame = 0, last = 0, nextMeteor = 0
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      width = element.clientWidth; height = element.clientHeight
      element.width = Math.max(1, Math.round(width * ratio)); element.height = Math.max(1, Math.round(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const count = Math.min(260, Math.round(width * height / 5200))
      stars = Array.from({ length: count }, () => ({ x: Math.random() * width, y: Math.random() * height, r: Math.random() < .08 ? 1.3 + Math.random() * .7 : .4 + Math.random() * .8,
        base: .25 + Math.random() * .55, speed: .4 + Math.random() * 1.4, phase: Math.random() * Math.PI * 2 }))
      draw(performance.now())
    }
    const draw = (now: number) => {
      context.clearRect(0, 0, width, height)
      const time = now / 1000
      for (const star of stars) {
        const alpha = still ? star.base : star.base * (.55 + .45 * Math.sin(time * star.speed + star.phase))
        context.globalAlpha = Math.max(0, alpha)
        context.fillStyle = '#e9ecf2'
        context.beginPath(); context.arc(star.x, star.y, star.r, 0, Math.PI * 2); context.fill()
      }
      for (const meteor of meteors) {
        const fade = Math.min(1, meteor.life * 3)
        const tailX = meteor.x - meteor.vx * meteor.length, tailY = meteor.y - meteor.vy * meteor.length
        const gradient = context.createLinearGradient(meteor.x, meteor.y, tailX, tailY)
        gradient.addColorStop(0, `rgba(255, 255, 255, ${.95 * fade})`); gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        context.globalAlpha = 1; context.strokeStyle = gradient; context.lineWidth = 1.6; context.lineCap = 'round'
        context.beginPath(); context.moveTo(meteor.x, meteor.y); context.lineTo(tailX, tailY); context.stroke()
      }
      context.globalAlpha = 1
    }
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (document.hidden || now - last < 33) return
      const step = Math.min(.1, (now - last) / 1000); last = now
      if (now > nextMeteor) {
        const fromLeft = Math.random() < .5, speed = 520 + Math.random() * 380
        meteors.push({ x: fromLeft ? Math.random() * width * .5 : width * .5 + Math.random() * width * .5, y: Math.random() * height * .35,
          vx: (fromLeft ? 1 : -1) * speed * .82, vy: speed * .57, life: 1, length: .16 })
        nextMeteor = now + 7000 + Math.random() * 9000
      }
      meteors = meteors.filter(meteor => { meteor.x += meteor.vx * step; meteor.y += meteor.vy * step; meteor.life -= step * 1.1; return meteor.life > 0 && meteor.y < height + 40 })
      draw(now)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    if (!still) { nextMeteor = performance.now() + 2500; frame = requestAnimationFrame(tick) }
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])
  return <canvas ref={canvas} className="starfield" data-calm={calm} aria-hidden="true" />
}
