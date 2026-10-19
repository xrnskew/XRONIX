import { useEffect, useRef } from 'react'

// Фон рабочей версии: тёмное «тепловое поле», мягкое красное свечение из угла.
// Оно связано с работой ИИ: пока ИИ думает, поле разгорается и течёт быстрее (energy → 1),
// когда приходит план, по нему проходит вспышка (pulse). Других анимаций на странице нет.
// Рисуется в половинном разрешении и ~30 кадров в секунду; при скрытой вкладке не рисуется.

let target = 0
let pulse = 0
export const setShaderEnergy = (e: number) => { target = e }
export const pulseShader = () => { pulse = 1 }

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_energy; // 0..1: насколько активен ИИ
uniform float u_pulse;  // 1 → 0: вспышка, когда готов план

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;

  vec2 q = vec2(fbm(p * 1.15 + vec2(0.0, t)), fbm(p * 1.15 + vec2(5.2, 1.3) - t));
  float n = fbm(p * 0.95 + 1.7 * q + vec2(t * 0.6, 0.0));

  // Тепло собирается в правом верхнем углу и чуть-чуть в левом нижнем; с энергией растёт
  vec2 a = vec2(aspect, 1.0);
  // на узком вертикальном экране тепло компактнее, иначе оно заливает всё
  float reach = (0.6 + 0.55 * u_energy + 0.6 * u_pulse) * mix(0.55, 1.0, clamp(aspect, 0.0, 1.0));
  float h1 = smoothstep(reach, 0.0, distance(p, a) + (n - 0.5) * 0.7);
  float h2 = 0.32 * smoothstep(0.7, 0.0, distance(p, vec2(0.0, 0.0)) + (n - 0.5) * 0.6);
  float h = h1 + h2;

  vec3 black = vec3(0.027, 0.027, 0.031);
  vec3 ember = vec3(0.36, 0.05, 0.04);
  vec3 hot   = vec3(0.94, 0.19, 0.14);
  vec3 col = mix(black, ember, smoothstep(0.0, 0.65, h));
  col = mix(col, hot, smoothstep(0.55, 1.1, h) * (0.2 + 0.55 * u_energy + 0.5 * u_pulse));

  // мягкие светлые всполохи внутри тепла вместо рисунка: без линий и резких границ
  col += vec3(1.0, 0.4, 0.3) * smoothstep(0.55, 0.95, n) * h * (0.06 + 0.12 * u_energy + 0.2 * u_pulse);

  col *= 0.85 + 0.15 * sin(uv.y * 3.14159);
  col += (hash(gl_FragCoord.xy + fract(u_time * 7.0) * 97.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`

export default function AppShader() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) return // остаётся CSS-градиент

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uEnergy = gl.getUniformLocation(prog, 'u_energy')
    const uPulse = gl.getUniformLocation(prog, 'u_pulse')

    const resize = () => {
      const k = Math.min(window.devicePixelRatio || 1, 1.5) * 0.5
      canvas.width = Math.max(2, Math.round(window.innerWidth * k))
      canvas.height = Math.max(2, Math.round(window.innerHeight * k))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = 0
    let energy = target
    let flow = 8 // «время» поля: течёт быстрее, когда energy выше
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || now - last < 32) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      energy += (target - energy) * Math.min(1, dt * 1.6)
      pulse = Math.max(0, pulse - dt * 0.55)
      flow += dt * (0.03 + 0.09 * energy + 0.12 * pulse)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, flow)
      gl.uniform1f(uEnergy, energy)
      gl.uniform1f(uPulse, pulse)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (still) cancelAnimationFrame(raf) // при «уменьшить движение» один неподвижный кадр
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
      style={{ background: 'radial-gradient(70% 60% at 100% 0%, #3a0d0b, #070708 70%)' }}
    />
  )
}
