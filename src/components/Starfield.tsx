import { memo, useEffect, useRef } from 'react';

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float travel;

float grain(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grain(i), grain(i + vec2(1, 0)), f.x),
             mix(grain(i + vec2(0, 1)), grain(i + vec2(1, 1)), f.x), f.y);
}

float clouds(vec2 p) {
  mat2 rotation = mat2(0.8, 0.6, -0.6, 0.8);
  float value = 0.54 * noise(p);
  p = rotation * p * 2.13 + 7.0;
  value += 0.27 * noise(p);
  p = rotation * p * 2.07 + 4.0;
  value += 0.13 * noise(p);
  value += 0.06 * noise(rotation * p * 2.23);
  return value;
}

void main() {
  vec2 screen = gl_FragCoord.xy / resolution;
  vec2 center = vec2(0.61 + 0.035 * sin(time * 0.14), 0.51 + 0.044 * cos(time * 0.17));
  vec2 p = (screen - center) * vec2(resolution.x / resolution.y, 1.0);
  float radius = length(p);
  float theta = atan(p.y, p.x);
  float depth = log(radius + 0.145);
  float spin = theta + depth * 1.28 + time * 0.075;
  float axial = depth * 1.3 - travel * 0.33;
  vec2 stream = vec2(cos(spin), sin(spin)) * (radius * 2.1 + 0.25);
  stream += vec2(axial * 1.3, axial * 0.46);
  float turbulence = clouds(stream * 2.1 + vec2(1.5, -3.8));
  float vapor = clouds(stream * 2.9 + vec2(turbulence * 1.62, -turbulence * 1.38));
  float wisps = clouds(stream * 7.9 + vapor * 2.2);
  float lane = pow(0.5 + 0.5 * sin(2.0 * spin + vapor * 4.0 - travel * 0.5), 1.7);
  float envelope = exp(-radius * 1.34) * (0.32 + 0.68 * lane);
  float fog = smoothstep(0.27, 0.79, vapor + 0.15 * wisps) * envelope;
  float thread = smoothstep(0.52, 0.78, wisps * 0.66 + vapor * 0.44) * envelope;
  vec3 dark = vec3(0.012, 0.025, 0.058);
  vec3 blue = vec3(0.070, 0.34, 0.67);
  vec3 violet = vec3(0.42, 0.20, 0.61);
  vec3 hue = mix(blue, violet, smoothstep(0.15, 0.80, turbulence));
  float innerGlow = exp(-radius * 6.5) * (0.42 + 0.58 * turbulence);
  vec3 color = dark + hue * fog * 1.38 + vec3(0.36, 0.57, 0.85) * thread * 0.53;
  color += vec3(0.10, 0.23, 0.46) * innerGlow;
  color += vec3(0.36, 0.54, 0.70) * exp(-radius * 22.0) * 0.62;
  color *= 1.0 - 0.36 * smoothstep(0.37, 1.50, radius);
  color += (grain(gl_FragCoord.xy) - 0.5) * 0.021;
  gl_FragColor = vec4(color, 1.0);
}
`;

function createNebula(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return;

  function compile(type: number, source: string) {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return shader;
    gl!.deleteShader(shader);
    return null;
  }

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const geometry = gl.createBuffer();
  if (!vertex || !fragment || !program || !geometry) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    if (geometry) gl.deleteBuffer(geometry);
    return;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteBuffer(geometry);
    return;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, 'resolution');
  const time = gl.getUniformLocation(program, 'time');
  const travel = gl.getUniformLocation(program, 'travel');
  return {
    lost: () => gl.isContextLost(),
    resize() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    },
    draw(seconds: number, distance: number) {
      gl.uniform1f(time, seconds);
      gl.uniform1f(travel, distance);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteBuffer(geometry); gl.deleteProgram(program); },
  };
}

function Starfield({ moving }: { moving: boolean }) {
  const nebulaCanvas = useRef<HTMLCanvasElement>(null);
  const starsCanvas = useRef<HTMLCanvasElement>(null);
  const update = useRef<((moving: boolean) => void) | null>(null);

  useEffect(() => {
    const nebulaElement = nebulaCanvas.current;
    const stars = starsCanvas.current;
    const context = stars?.getContext('2d');
    if (!nebulaElement || !stars || !context) return;
    const layer = createNebula(nebulaElement);
    let seed = 13049;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const particles = Array.from({ length: 170 }, () => ({
      x: (random() - 0.5) * 3.4, y: (random() - 0.5) * 1.9,
      z: 0.32 + random() * 2.6, tint: random(), light: 0.18 + random() * 0.77,
    }));
    let width = 1, height = 1, time = 0, frame = 0;
    let running = false, previous = 0;

    function draw(delta: number) {
      time += delta;
      const speed = 0.19;
      const distance = time * speed;
      const fogReady = layer && !layer.lost();
      if (fogReady) layer.draw(time, distance);
      const cx = width * (0.61 + 0.035 * Math.sin(time * 0.14));
      const cy = height * (0.49 - 0.044 * Math.cos(time * 0.17));
      const zoom = height * 0.69;
      context!.clearRect(0, 0, width, height);
      if (!fogReady) {
        context!.fillStyle = '#050b1b';
        context!.fillRect(0, 0, width, height);
        for (let index = 0; index < 9; index++) {
          const phase = index * 2.39 + time * 0.115;
          const depth = (index / 9 + distance * 0.095) % 1;
          const radius = height * (0.14 + depth * 0.56);
          const x = cx + Math.cos(phase) * radius;
          const y = cy + Math.sin(phase) * radius * 0.6;
          const cloud = context!.createRadialGradient(x, y, 0, x, y, radius);
          const fade = 0.29 * Math.sin(Math.PI * depth);
          cloud.addColorStop(0, index % 2 ? `rgba(74,84,180,${fade})` : `rgba(41,103,178,${fade})`);
          cloud.addColorStop(1, 'rgba(20,35,80,0)');
          context!.fillStyle = cloud;
          context!.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
        }
      }
      for (const star of particles) {
        star.z -= speed * delta * (0.57 + star.tint * 0.68);
        if (star.z < 0.31) star.z += 2.65;
        const x = cx + star.x * zoom / star.z;
        const y = cy + star.y * zoom / star.z;
        if (x < -12 || y < -12 || x > width + 12 || y > height + 12) continue;
        const shade = star.tint > 0.86 ? '211,190,254' : star.tint > 0.35 ? '158,209,255' : '236,246,255';
        const fade = Math.min(0.87, star.light * (1.05 / star.z) * (0.80 + 0.20 * Math.sin(time * 2 + star.tint * 55)));
        const dot = Math.min(2.5, 0.45 + star.light * 0.62 / star.z);
        context!.fillStyle = `rgba(${shade},${fade})`;
        context!.beginPath();
        context!.arc(x, y, dot, 0, Math.PI * 2);
        context!.fill();
      }
    }

    function tick(now: number) {
      frame = 0;
      if (!running) return;
      const elapsed = now - previous;
      if (elapsed >= 30) {
        previous = now;
        draw(Math.min(elapsed / 1000, 0.075));
      }
      frame = requestAnimationFrame(tick);
    }

    function resize() {
      width = Math.max(1, stars!.clientWidth);
      height = Math.max(1, stars!.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      stars!.width = Math.round(width * pixelRatio);
      stars!.height = Math.round(height * pixelRatio);
      context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const fogScale = Math.min(0.83, 700 / width, 330 / height);
      nebulaElement!.width = Math.max(1, Math.round(width * fogScale));
      nebulaElement!.height = Math.max(1, Math.round(height * fogScale));
      layer?.resize();
      draw(0);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(stars);
    resize();
    update.current = nextRunning => {
      running = nextRunning;
      if (!running) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    return () => {
      update.current = null;
      observer.disconnect();
      cancelAnimationFrame(frame);
      layer?.dispose();
    };
  }, []);

  useEffect(() => { update.current?.(moving); }, [moving]);
  return <div className="starfield" aria-hidden="true"><canvas ref={nebulaCanvas} /><canvas ref={starsCanvas} /></div>;
}

export default memo(Starfield);
