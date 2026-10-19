import { useEffect, useRef } from 'react'

// Фон страницы: градиент от чёрного (слева) к красному (справа), красного мало.
// Границу красного колышет шум, сверху лёгкое зерно. Рисуется фрагментным шейдером.
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_scroll; // 0..1, прокрутка страницы: сдвигает границу красного

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
  vec2 p = vec2(uv.x * u_res.x / u_res.y, uv.y);
  float t = u_time * 0.045;

  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, t)), fbm(p * 1.3 + vec2(5.2, 1.3) - t));
  float n = fbm(p * 1.1 + 1.7 * q + vec2(t * 0.7, 0.0));

  // g растёт слева направо; шум делает границу живой
  float g = uv.x + (n - 0.5) * 0.6 + (u_scroll - 0.5) * 0.16;

  vec3 black = vec3(0.028, 0.028, 0.032);
  vec3 ember = vec3(0.34, 0.05, 0.045);
  vec3 hot   = vec3(0.94, 0.19, 0.14);

  vec3 col = mix(black, ember, smoothstep(0.38, 0.82, g));
  col = mix(col, hot, pow(smoothstep(0.62, 1.05, g), 1.5));

  // тонкие светлые прожилки только в красной зоне
  float veins = smoothstep(0.58, 0.9, fbm(p * 3.2 + q * 2.2 + t + u_scroll * 1.5)) * smoothstep(0.7, 1.0, g);
  col += vec3(1.0, 0.42, 0.32) * veins * 0.22;

  // мягкое затемнение к верху и низу
  col *= 0.82 + 0.18 * sin(uv.y * 3.14159);

  col += (hash(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) * 0.05;
  gl_FragColor = vec4(col, 1.0);
}`

export default function ShaderBackground() {
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
    const uScroll = gl.getUniformLocation(prog, 'u_scroll')

    const resize = () => {
      const k = Math.min(window.devicePixelRatio || 1, 1.5) * 0.7
      canvas.width = Math.max(2, Math.round(window.innerWidth * k))
      canvas.height = Math.max(2, Math.round(window.innerHeight * k))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t0 = performance.now()
    let raf = 0
    let scroll = 0 // сглаженная прокрутка
    const draw = (now: number) => {
      const target = window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      scroll += (target - scroll) * (still ? 1 : 0.06)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uScroll, scroll)
      gl.uniform1f(uTime, still ? 8 : (now - t0) / 1000 + 8)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!still) raf = requestAnimationFrame(draw)
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
      className="fixed inset-0 -z-10 h-full w-full"
      style={{ background: 'linear-gradient(to left, #c9231a 0%, #3a0d0b 35%, #070708 65%)' }}
    />
  )
}
