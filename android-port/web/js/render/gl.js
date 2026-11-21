/**
 * CrystalLens Android - WebGL2 low level helpers.
 *
 * Classic script, attaches CL.GL. Contains:
 *   - context creation / capability probing
 *   - GLSL ES 3.00 ports of the reference OpenGL 3.3 shaders
 *     (reference/src/render/Renderer.cpp, see docs/spec/render.md §10)
 *   - a cached-uniform ShaderProgram wrapper
 *   - static instance templates (billboard quad, 6-sided cylinder strip)
 *
 * No dependencies beyond the raw WebGL2 API.
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  // ------------------------------------------------------------- context ---
  // Options matter for headless screenshots: preserveDrawingBuffer keeps the
  // frame readable by canvas.toDataURL after the render loop goes idle.
  function createContext(canvas, attrs) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    var opts = {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false
    };
    if (attrs) {
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) opts[k] = attrs[k];
    }
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', opts);
    } catch (e) {
      gl = null;
    }
    if (!gl) return null;
    return gl;
  }

  function contextInfo(gl) {
    var info = {
      version: '', renderer: '', vendor: '', glsl: '',
      samples: 1, maxTextureSize: 0,
      hasFloatDepth: true
    };
    if (!gl) return info;
    try {
      info.version = gl.getParameter(gl.VERSION) || '';
      info.renderer = gl.getParameter(gl.RENDERER) || '';
      info.vendor = gl.getParameter(gl.VENDOR) || '';
      info.glsl = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || '';
      var samples = gl.getParameter(gl.SAMPLES);
      info.samples = (typeof samples === 'number' && samples > 0) ? samples : 1;
      info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    } catch (e) { /* ignore */ }
    return info;
  }

  // --------------------------------------------------------- GLSL ES3 -------
  // Ports of reference/src/render/Renderer.cpp shaders. Only the GLSL dialect
  // changed (#version 300 es, precision qualifier, in/out); the math is kept
  // element for element so the visual result matches the Windows original.
  var shaders = {};

  shaders.atomVS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location = 0) in vec2 aCorner;',
    'layout(location = 1) in vec3 aCenter;',
    'layout(location = 2) in float aRadius;',
    'layout(location = 3) in vec3 aColor;',
    'layout(location = 4) in float aFlags;',
    'layout(location = 5) in float aIndex;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform int uHovered;',
    'uniform int uSelected0;',
    'uniform int uSelected1;',
    'uniform int uSelected2;',
    'out vec3 vCenterView;',
    'out vec2 vLocal;',
    'out vec3 vColor;',
    'out float vFlags;',
    'out float vRadius;',
    'void main() {',
    '  vec3 centerView = (uView * vec4(aCenter, 1.0)).xyz;',
    '  vec3 pos = centerView + vec3(aCorner.x * aRadius, aCorner.y * aRadius, 0.0);',
    '  gl_Position = uProj * vec4(pos, 1.0);',
    '  vCenterView = centerView;',
    '  vLocal = aCorner;',
    '  vColor = aColor;',
    '  vRadius = aRadius;',
    '  int flags = int(aFlags + 0.5);',
    '  int index = int(aIndex);',
    '  if (index >= 0) {',
    '    if (index == uHovered) flags |= 2;',
    '    if (index == uSelected0 || index == uSelected1 || index == uSelected2) flags |= 1;',
    '  }',
    '  vFlags = float(flags);',
    '}'
  ].join('\n');

  shaders.atomFS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vCenterView;',
    'in vec2 vLocal;',
    'in vec3 vColor;',
    'in float vFlags;',
    'in float vRadius;',
    'uniform mat4 uProj;',
    'out vec4 FragColor;',
    'void main() {',
    '  float r2 = dot(vLocal, vLocal);',
    '  if (r2 > 1.0) discard;',
    '  float z = sqrt(max(0.0, 1.0 - r2));',
    '  vec3 n = normalize(vec3(vLocal, z));',
    '  vec3 viewPos = vCenterView + vec3(vLocal, z) * vRadius;',
    '  vec4 clip = uProj * vec4(viewPos, 1.0);',
    '  if (clip.w <= 0.0) discard;',
    '  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3 key = normalize(vec3(-0.42, 0.50, 0.76));',
    '  vec3 fill = normalize(vec3(0.55, -0.18, 0.58));',
    '  float diffuse = max(dot(n, key), 0.0);',
    '  float fillLight = max(dot(n, fill), 0.0);',
    '  vec3 keyHalf = normalize(key + vec3(0.0, 0.0, 1.0));',
    '  vec3 fillHalf = normalize(fill + vec3(0.0, 0.0, 1.0));',
    '  float specular = pow(max(dot(n, keyHalf), 0.0), 64.0);',
    '  float softSpecular = pow(max(dot(n, fillHalf), 0.0), 16.0);',
    '  vec3 base = vColor;',
    '  vec3 color = base * (0.24 + 0.80 * diffuse) + base * 0.16 * fillLight;',
    '  color += vec3(1.0, 0.96, 0.88) * specular * 0.30;',
    '  color += base * softSpecular * 0.07;',
    '  float rim = pow(1.0 - z, 3.0);',
    '  color += base * rim * 0.12 + vec3(0.10, 0.18, 0.26) * rim * 0.07;',
    '  int flags = int(vFlags + 0.5);',
    '  if ((flags & 1) != 0) {',
    '    float ring = smoothstep(0.38, 0.92, 1.0 - z);',
    '    color = mix(color, vec3(1.0, 0.80, 0.30), ring * 0.90);',
    '    color += vec3(0.22, 0.15, 0.03) * rim;',
    '  } else if ((flags & 2) != 0) {',
    '    color = mix(color, vec3(0.62, 0.86, 1.0), rim * 0.55);',
    '    color *= 1.08;',
    '  }',
    '  float alpha = smoothstep(0.0, 0.075, 1.0 - r2);',
    '  if ((flags & 4) != 0) {',
    '    color = mix(color, vec3(0.085, 0.115, 0.155), 0.22);',
    '    alpha *= 0.36;',
    '  }',
    '  FragColor = vec4(color, alpha);',
    '}'
  ].join('\n');

  // Instanced tube: 14 vertices per instance (7 rings x 2 ends) drawn as a
  // TRIANGLE_STRIP. Replaces the OpenGL 3.3 geometry shader (render.md §14.1).
  shaders.lineVS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location = 0) in vec3 aCorner;',   // (cos(angle), sin(angle), end)
    'layout(location = 1) in vec3 aP0;',
    'layout(location = 2) in vec3 aP1;',
    'layout(location = 3) in float aRadius;',
    'layout(location = 4) in vec3 aC0;',
    'layout(location = 5) in vec3 aC1;',
    'layout(location = 6) in float aFlags;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'out vec3 vNormal;',
    'out vec3 vC0;',
    'out vec3 vC1;',
    'out float vT;',
    'out float vFlags;',
    'void main() {',
    '  vec3 segment = aP1 - aP0;',
    '  float segmentLength = length(segment);',
    '  vec3 axis = segmentLength > 1e-7 ? segment / segmentLength : vec3(0.0, 0.0, 1.0);',
    '  vec3 reference = abs(axis.z) < 0.85 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);',
    '  vec3 side = normalize(cross(axis, reference));',
    '  vec3 up = normalize(cross(side, axis));',
    '  vec3 normal = side * aCorner.x + up * aCorner.y;',
    '  vec3 world = mix(aP0, aP1, aCorner.z) + normal * aRadius;',
    '  if (segmentLength < 1e-7 || aRadius <= 0.0) {',
    '    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
    '  } else {',
    '    gl_Position = uProj * uView * vec4(world, 1.0);',
    '  }',
    '  vNormal = mat3(uView) * normal;',
    '  vC0 = aC0;',
    '  vC1 = aC1;',
    '  vT = aCorner.z;',
    '  vFlags = aFlags;',
    '}'
  ].join('\n');

  shaders.lineFS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNormal;',
    'in vec3 vC0;',
    'in vec3 vC1;',
    'in float vT;',
    'in float vFlags;',
    'uniform float uOverlayAlpha;',
    'out vec4 FragColor;',
    'void main() {',
    '  int flags = int(vFlags + 0.5);',
    '  if (uOverlayAlpha < 1.0 && (flags & 4) != 0) discard;',
    '  if ((flags & 1) != 0) {',
    '    if (fract(vT * 15.0) > 0.58) discard;',
    '  }',
    '  vec3 normal = normalize(vNormal);',
    '  vec3 key = normalize(vec3(-0.42, 0.50, 0.76));',
    '  vec3 fill = normalize(vec3(0.55, -0.18, 0.58));',
    '  vec3 base = mix(vC0, vC1, clamp(vT, 0.0, 1.0));',
    '  float diffuse = max(dot(normal, key), 0.0);',
    '  float fillLight = max(dot(normal, fill), 0.0);',
    '  vec3 color = base * (0.28 + 0.80 * diffuse) + base * 0.16 * fillLight;',
    '  vec3 halfDir = normalize(key + vec3(0.0, 0.0, 1.0));',
    '  float specular = pow(max(dot(normal, halfDir), 0.0), 48.0);',
    '  color += vec3(1.0, 0.97, 0.92) * specular * 0.22;',
    '  float rim = pow(1.0 - max(normal.z, 0.0), 3.0);',
    '  color += base * rim * 0.09;',
    '  if ((flags & 2) != 0) {',
    '    color = mix(base, color, 0.30);',
    '    if ((flags & 4) != 0) color *= 0.57;',
    '  }',
    '  FragColor = vec4(color, uOverlayAlpha);',
    '}'
  ].join('\n');

  shaders.backgroundVS = [
    '#version 300 es',
    'precision highp float;',
    'out vec2 vUV;',
    'void main() {',
    '  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);',
    '  gl_Position = vec4(p, 0.0, 1.0);',
    '  vUV = p * 0.5 + 0.5;',
    '}'
  ].join('\n');

  shaders.backgroundFS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUV;',
    'uniform vec2 uResolution;',
    'uniform vec3 uBackgroundColor;',
    'out vec4 FragColor;',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / uResolution;',
    '  float aspect = uResolution.x / max(1.0, uResolution.y);',
    '  vec3 base = uBackgroundColor;',
    '  vec3 color = base * (0.55 + 0.55 * pow(clamp(uv.y, 0.0, 1.0), 0.82));',
    '  vec2 glow = (uv - vec2(0.60, 0.50)) * vec2(aspect, 1.0);',
    '  color += base * 0.45 * exp(-dot(glow, glow) * 3.5);',
    '  float vignette = length((uv - 0.5) * vec2(aspect, 1.0));',
    '  color *= 1.0 - 0.22 * smoothstep(0.35, 1.05, vignette);',
    '  FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  // NOTE (WebGL2 difference): GLSL ES 3.00 has no `noperspective` qualifier, so
  // the original "noperspective barycentric + dFdx/dFdy" edge trick cannot be
  // ported literally. Instead every vertex carries its triangle's three world
  // positions + a per-triangle "outlined edge" mask; the vertex shader projects
  // them to pixel space and the fragment shader computes exact per-pixel
  // distances to the three screen-space edges. Same visual result (analytic,
  // constant pixel width), only a slightly larger vertex layout.
  shaders.polyVS = [
    '#version 300 es',
    'precision highp float;',
    'layout(location = 0) in vec3 aPosition;',
    'layout(location = 1) in vec3 aNormal;',
    'layout(location = 2) in vec3 aColor;',
    'layout(location = 3) in vec3 aEdgeMask;',   // 1 = edge opposite vertex i is outlined
    'layout(location = 4) in vec3 aTriA;',
    'layout(location = 5) in vec3 aTriB;',
    'layout(location = 6) in vec3 aTriC;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform vec2 uResolution;',
    'out vec3 vNormal;',
    'out vec3 vColor;',
    'flat out vec3 vEdgeMask;',
    'flat out vec3 vT0;',
    'flat out vec3 vT1;',
    'flat out vec3 vT2;',
    'vec3 toScreen(vec3 world) {',
    '  vec4 clip = uProj * (uView * vec4(world, 1.0));',
    '  float w = max(clip.w, 1e-6);',
    '  vec2 ndc = clip.xy / w;',
    '  return vec3((ndc * 0.5 + 0.5) * uResolution, clip.w);',
    '}',
    'void main() {',
    '  vec3 viewPos = (uView * vec4(aPosition, 1.0)).xyz;',
    '  gl_Position = uProj * vec4(viewPos, 1.0);',
    '  vNormal = mat3(uView) * aNormal;',
    '  vColor = aColor;',
    '  vEdgeMask = aEdgeMask;',
    '  vT0 = toScreen(aTriA);',
    '  vT1 = toScreen(aTriB);',
    '  vT2 = toScreen(aTriC);',
    '}'
  ].join('\n');

  shaders.polyFS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vNormal;',
    'in vec3 vColor;',
    'flat in vec3 vEdgeMask;',
    'flat in vec3 vT0;',
    'flat in vec3 vT1;',
    'flat in vec3 vT2;',
    'uniform float uAlpha;',
    'uniform float uEdgeWidth;',
    'uniform vec3 uEdgeColor;',
    'out vec4 FragColor;',
    'void main() {',
    '  vec3 normal = normalize(vNormal);',
    '  if (!gl_FrontFacing) normal = -normal;',
    '  vec3 key = normalize(vec3(-0.42, 0.50, 0.76));',
    '  vec3 fill = normalize(vec3(0.55, -0.18, 0.58));',
    '  float diffuse = max(dot(normal, key), 0.0);',
    '  float fillLight = max(dot(normal, fill), 0.0);',
    '  vec3 color = vColor * (0.34 + 0.66 * diffuse) + vColor * 0.18 * fillLight;',
    '  float edge = 0.0;',
    '  if (uEdgeWidth > 0.0 && vT0.z > 0.0 && vT1.z > 0.0 && vT2.z > 0.0) {',
    '    vec2 p = gl_FragCoord.xy;',
    '    float det = (vT1.y - vT2.y) * (vT0.x - vT2.x) + (vT2.x - vT1.x) * (vT0.y - vT2.y);',
    '    if (abs(det) > 1e-6) {',
    '      float b0 = ((vT1.y - vT2.y) * (p.x - vT2.x) + (vT2.x - vT1.x) * (p.y - vT2.y)) / det;',
    '      float b1 = ((vT2.y - vT0.y) * (p.x - vT2.x) + (vT0.x - vT2.x) * (p.y - vT2.y)) / det;',
    '      float b2 = 1.0 - b0 - b1;',
    '      float area2 = abs(det);',
    '      float l0 = max(length(vT1.xy - vT2.xy), 1e-4);',
    '      float l1 = max(length(vT2.xy - vT0.xy), 1e-4);',
    '      float l2 = max(length(vT0.xy - vT1.xy), 1e-4);',
    '      float d0 = vEdgeMask.x > 0.5 ? area2 * b0 / l0 : 1e9;',
    '      float d1 = vEdgeMask.y > 0.5 ? area2 * b1 / l1 : 1e9;',
    '      float d2 = vEdgeMask.z > 0.5 ? area2 * b2 / l2 : 1e9;',
    '      float pixels = min(d0, min(d1, d2));',
    '      edge = clamp(0.5 * uEdgeWidth + 0.5 - pixels, 0.0, 1.0);',
    '    }',
    '  }',
    '  float alpha = edge + (1.0 - edge) * uAlpha;',
    '  if (alpha <= 0.0) discard;',
    '  FragColor = vec4(mix(color * uAlpha, uEdgeColor, edge) / alpha, alpha);',
    '}'
  ].join('\n');

  // --------------------------------------------------------- ShaderProgram --
  function Program(gl, name, vsSource, fsSource) {
    this.gl = gl;
    this.name = name;
    this.program = gl.createProgram();
    this._uniforms = Object.create(null);
    var vs = compileShader(gl, gl.VERTEX_SHADER, vsSource, name + '.vert');
    var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource, name + '.frag');
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      gl.deleteProgram(this.program);
      this.program = null;
      return;
    }
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(this.program) || '';
      gl.deleteProgram(this.program);
      this.program = null;
      throw new Error('[' + name + '] link failed: ' + log);
    }
  }

  function compileShader(gl, type, source, label) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader) || '';
      gl.deleteShader(shader);
      throw new Error('[' + label + '] compile failed: ' + log);
    }
    return shader;
  }

  Program.prototype.ok = function () { return !!this.program; };
  Program.prototype.use = function () { if (this.program) this.gl.useProgram(this.program); return this; };
  Program.prototype.u = function (name) {
    var key = '$' + name;
    if (this._uniforms[key] !== undefined) return this._uniforms[key];
    var loc = this.program ? this.gl.getUniformLocation(this.program, name) : null;
    this._uniforms[key] = loc;
    return loc;
  };
  Program.prototype.set1f = function (name, v) {
    var loc = this.u(name); if (loc) this.gl.uniform1f(loc, v);
  };
  Program.prototype.set1i = function (name, v) {
    var loc = this.u(name); if (loc) this.gl.uniform1i(loc, v);
  };
  Program.prototype.set2f = function (name, x, y) {
    var loc = this.u(name); if (loc) this.gl.uniform2f(loc, x, y);
  };
  Program.prototype.set3f = function (name, x, y, z) {
    var loc = this.u(name); if (loc) this.gl.uniform3f(loc, x, y, z);
  };
  Program.prototype.set3fv = function (name, arr) {
    var loc = this.u(name); if (loc) this.gl.uniform3f(loc, arr[0], arr[1], arr[2]);
  };
  Program.prototype.setMat4 = function (name, m) {
    var loc = this.u(name); if (loc) this.gl.uniformMatrix4fv(loc, false, m);
  };
  Program.prototype.dispose = function () {
    if (this.program) { this.gl.deleteProgram(this.program); this.program = null; }
  };

  // -------------------------------------------------------- static meshes ---
  // Billboard quad (TRIANGLES, 6 vertices, location 0).
  function quadTemplate() {
    return new Float32Array([
      -1, -1, 1, -1, -1, 1,
      1, -1, 1, 1, -1, 1
    ]);
  }

  // 6-sided open tube: 7 rings x 2 ends = 14 vertices for a TRIANGLE_STRIP.
  // Each vertex is (cos(angle), sin(angle), end).
  function cylinderTemplate() {
    var out = new Float32Array(14 * 3);
    var k = 0;
    for (var i = 0; i <= 6; i++) {
      var a = 2 * Math.PI * i / 6;
      var c = Math.cos(a), s = Math.sin(a);
      for (var end = 0; end < 2; end++) {
        out[k++] = c; out[k++] = s; out[k++] = end;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ utilities ---
  function hexToRgb(u32) {
    var v = u32 >>> 0;
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
  }

  function rgbToHex(rgb) {
    var r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
    var g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
    var b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
    return (r << 16) | (g << 8) | b;
  }

  function colorToRgb(color) {
    // Accepts u32, '#rrggbb', or [r,g,b].
    if (typeof color === 'number') return hexToRgb(color);
    if (typeof color === 'string') {
      var s = color.trim();
      if (s.charAt(0) === '#') s = s.slice(1);
      if (s.length === 6) return hexToRgb(parseInt(s, 16));
      if (s.length === 3) {
        var r = parseInt(s.charAt(0) + s.charAt(0), 16);
        var g = parseInt(s.charAt(1) + s.charAt(1), 16);
        var b = parseInt(s.charAt(2) + s.charAt(2), 16);
        return [r / 255, g / 255, b / 255];
      }
    }
    if (color && color.length >= 3) return [color[0], color[1], color[2]];
    return [0.6, 0.64, 0.7];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CL.GL = {
    createContext: createContext,
    contextInfo: contextInfo,
    shaders: shaders,
    Program: Program,
    quadTemplate: quadTemplate,
    cylinderTemplate: cylinderTemplate,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    colorToRgb: colorToRgb,
    clamp: clamp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
