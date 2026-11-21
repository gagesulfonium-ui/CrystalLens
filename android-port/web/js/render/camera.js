/**
 * CrystalLens Android - orbit camera (port of reference src/render/Camera.cpp).
 *
 * Classic script, attaches CL.Camera. All angles are radians internally; UI
 * passes degrees only when constructing defaults. World is right-handed z-up;
 * screen coordinates are pixels with y pointing down.
 *
 * Matrices are Float32Array, column-major (WebGL / OpenGL convention).
 */
(function (root) {
  'use strict';
  var CL = root.CL = root.CL || {};

  var DEG2RAD = Math.PI / 180;
  var RAD2DEG = 180 / Math.PI;
  var PITCH_LIMIT = 85 * DEG2RAD;
  var WORLD_UP = [0, 0, 1];
  var WORLD_UP_FALLBACK = [0, 1, 0];
  var WORLD_UP_PARALLEL_EPS = 0.999;

  // Defaults (render-constants.json -> camera.defaults).
  var DEFAULT_YAW = 35 * DEG2RAD;
  var DEFAULT_PITCH = 24 * DEG2RAD;
  var DEFAULT_FOVY = 38 * DEG2RAD;
  var DEFAULT_DISTANCE = 20;
  var DEFAULT_SCENE_RADIUS = 10;

  // Interaction constants (render.md §11.5).
  var ORBIT_RAD_PER_PX = 0.0072;
  var ZOOM_EXPONENT = 0.16;
  var ZOOM_MIN_FACTOR = 0.035;
  var ZOOM_MAX_FACTOR = 40;
  var ZOOM_MAX_PAD = 100;

  // ---- tiny vector helpers (local so camera.js stays dependency-free) ------
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function length(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function normalize(a) {
    var l = length(a);
    if (l < 1e-12) return [0, 0, 0];
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, fallback) { return (typeof v === 'number' && isFinite(v)) ? v : fallback; }

  function Camera(opts) {
    opts = opts || {};
    var t = opts.target;
    this.target = (t && t.length >= 3) ? [Number(t[0]) || 0, Number(t[1]) || 0, Number(t[2]) || 0] : [0, 0, 0];
    this.distance = num(opts.distance, DEFAULT_DISTANCE);
    this.yaw = (typeof opts.yaw === 'number') ? opts.yaw
      : (typeof opts.yawDeg === 'number') ? opts.yawDeg * DEG2RAD : DEFAULT_YAW;
    this.pitch = (typeof opts.pitch === 'number') ? opts.pitch
      : (typeof opts.pitchDeg === 'number') ? opts.pitchDeg * DEG2RAD : DEFAULT_PITCH;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovY = (typeof opts.fovY === 'number') ? opts.fovY
      : (typeof opts.fovYDeg === 'number') ? opts.fovYDeg * DEG2RAD : DEFAULT_FOVY;
    this.orthographic = !!opts.orthographic;
    // C++ keeps this private; exposing it lets the renderer derive a stable
    // minimum picking radius without an extra model field.
    this.sceneRadius = Math.max(0.5, num(opts.sceneRadius, DEFAULT_SCENE_RADIUS));

    this._eye = [0, 0, 0];
    this._forward = [0, 0, -1];
    this._right = [1, 0, 0];
    this._up = [0, 1, 0];
    this._dirty = true;
  }

  // --------------------------------------------------------------- basis ----
  Camera.prototype._update = function () {
    if (!this._dirty) return;
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var dist = this.distance;
    var eye = [
      this.target[0] + cp * cy * dist,
      this.target[1] + cp * sy * dist,
      this.target[2] + sp * dist
    ];
    var f = normalize([this.target[0] - eye[0], this.target[1] - eye[1], this.target[2] - eye[2]]);
    var worldUp = WORLD_UP;
    if (Math.abs(dot(f, WORLD_UP)) > WORLD_UP_PARALLEL_EPS) worldUp = WORLD_UP_FALLBACK;
    var r = normalize(cross(f, worldUp));
    var u = normalize(cross(r, f));
    this._eye = eye;
    this._forward = f;
    this._right = r;
    this._up = u;
    this._dirty = false;
  };

  Camera.prototype._touch = function () { this._dirty = true; };

  Camera.prototype.eye = function () { this._update(); return [this._eye[0], this._eye[1], this._eye[2]]; };
  Camera.prototype.forward = function () { this._update(); return [this._forward[0], this._forward[1], this._forward[2]]; };
  Camera.prototype.right = function () { this._update(); return [this._right[0], this._right[1], this._right[2]]; };
  Camera.prototype.up = function () { this._update(); return [this._up[0], this._up[1], this._up[2]]; };

  // ------------------------------------------------------------- planes ----
  Camera.prototype.nearPlane = function () {
    return Math.max(0.02, this.distance - this.sceneRadius * 2.2);
  };
  Camera.prototype.farPlane = function () {
    var near = this.nearPlane();
    return Math.max(near + 2.0, this.distance + this.sceneRadius * 5.0 + 10.0);
  };

  // --------------------------------------------------------------- scene ----
  Camera.prototype.setScene = function (center, radius) {
    var c = center && center.length >= 3 ? center : [0, 0, 0];
    this.target = [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0];
    this.sceneRadius = Math.max(0.5, Number(radius) || 0);
    this._touch();
    return this;
  };

  // Sphere fit (render.md §11.4 B).
  Camera.prototype.fit = function (aspect, margin) {
    if (typeof margin !== 'number' || !isFinite(margin)) margin = 1.12;
    aspect = (typeof aspect === 'number' && aspect > 0.05) ? aspect : 1.0;
    var vhalf = this.fovY * 0.5;
    var hhalf = Math.atan(Math.tan(vhalf) * aspect);
    var vertical = this.sceneRadius / Math.max(1e-4, Math.sin(vhalf));
    var horizontal = this.sceneRadius / Math.max(1e-4, Math.sin(hhalf));
    var d = Math.max(vertical, horizontal) * Math.max(1.0, margin);
    var lo = this.sceneRadius * 0.06 + 0.05;
    var hi = this.sceneRadius * 30.0 + 50.0;
    this.distance = clamp(d, lo, hi);
    this._touch();
    return this;
  };

  // Point-set fit (render.md §11.4 C). Points: array of [x,y,z].
  Camera.prototype.fitPoints = function (points, aspect, margin) {
    if (!points || points.length === 0) { this.fit(aspect, margin); return this; }
    if (typeof margin !== 'number' || !isFinite(margin)) margin = 1.16;
    aspect = (typeof aspect === 'number' && aspect > 0.05) ? aspect : 1.0;
    this._update();
    var f = this._forward, r = this._right, u = this._up, t = this.target;
    var tanHalf = Math.tan(this.fovY * 0.5);
    var required = 0;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p) continue;
      var qx = p[0] - t[0], qy = p[1] - t[1], qz = p[2] - t[2];
      var x = Math.abs(qx * r[0] + qy * r[1] + qz * r[2]);
      var y = Math.abs(qx * u[0] + qy * u[1] + qz * u[2]);
      var z = qx * f[0] + qy * f[1] + qz * f[2];
      var needY = y * margin / tanHalf;
      var needX = x * margin / (tanHalf * aspect);
      if (this.orthographic) {
        if (needY > required) required = needY;
        if (needX > required) required = needX;
      } else {
        needY -= z;
        needX -= z;
        if (needY > required) required = needY;
        if (needX > required) required = needX;
      }
    }
    var lo = this.sceneRadius * 0.05 + 0.05;
    var hi = this.sceneRadius * 30.0 + 50.0;
    this.distance = clamp(required, lo, hi);
    this._touch();
    return this;
  };

  // FitScenePoints (render.md §11.4 D): recenters on the point bbox.
  Camera.prototype.fitScenePoints = function (points, aspect, margin) {
    if (!points || points.length === 0) { this.fit(aspect, margin); return this; }
    if (typeof margin !== 'number' || !isFinite(margin)) margin = 1.18;
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    var i, p;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      if (!p) continue;
      if (p[0] < lo[0]) lo[0] = p[0];
      if (p[1] < lo[1]) lo[1] = p[1];
      if (p[2] < lo[2]) lo[2] = p[2];
      if (p[0] > hi[0]) hi[0] = p[0];
      if (p[1] > hi[1]) hi[1] = p[1];
      if (p[2] > hi[2]) hi[2] = p[2];
    }
    if (!isFinite(lo[0])) { this.fit(aspect, margin); return this; }
    var center = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
    var maxD2 = 0;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      if (!p) continue;
      var dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxD2) maxD2 = d2;
    }
    this.setScene(center, Math.sqrt(maxD2));
    return this.fitPoints(points, aspect, margin);
  };

  Camera.prototype.reset = function (center, radius, aspect) {
    this.setScene(center, radius);
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.orthographic = false;
    this._touch();
    return this.fit(aspect, 1.12);
  };

  // ----------------------------------------------------------- controls ----
  Camera.prototype.orbit = function (dxPx, dyPx) {
    this.yaw -= (Number(dxPx) || 0) * ORBIT_RAD_PER_PX;
    this.pitch += (Number(dyPx) || 0) * ORBIT_RAD_PER_PX;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this._touch();
    return this;
  };

  Camera.prototype.pan = function (dxPx, dyPx, width, height) {
    width = Number(width) || 0;
    height = Number(height) || 0;
    if (width <= 0 || height <= 0) return this;
    this._update();
    var wpp = 2 * this.distance * Math.tan(this.fovY * 0.5) / height;
    var dx = (Number(dxPx) || 0) * wpp, dy = (Number(dyPx) || 0) * wpp;
    var r = this._right, u = this._up;
    this.target = [
      this.target[0] - r[0] * dx + u[0] * dy,
      this.target[1] - r[1] * dx + u[1] * dy,
      this.target[2] - r[2] * dx + u[2] * dy
    ];
    this._touch();
    return this;
  };

  Camera.prototype.zoom = function (wheelSteps) {
    var steps = Number(wheelSteps) || 0;
    this.distance *= Math.exp(-steps * ZOOM_EXPONENT);
    var lo = Math.max(0.05, this.sceneRadius * ZOOM_MIN_FACTOR);
    var hi = this.sceneRadius * ZOOM_MAX_FACTOR + ZOOM_MAX_PAD;
    this.distance = clamp(this.distance, lo, hi);
    this._touch();
    return this;
  };

  // ----------------------------------------------------------- matrices ----
  // Column-major; matches C++ Camera::ViewMatrix() element for element.
  Camera.prototype.viewMatrix = function () {
    this._update();
    var r = this._right, u = this._up, f = this._forward, e = this._eye;
    var m = new Float32Array(16);
    m[0] = r[0]; m[1] = u[0]; m[2] = -f[0]; m[3] = 0;
    m[4] = r[1]; m[5] = u[1]; m[6] = -f[1]; m[7] = 0;
    m[8] = r[2]; m[9] = u[2]; m[10] = -f[2]; m[11] = 0;
    m[12] = -dot(r, e);
    m[13] = -dot(u, e);
    m[14] = dot(f, e);
    m[15] = 1;
    return m;
  };

  Camera.prototype.projectionMatrix = function (width, height) {
    width = Number(width) || 0;
    height = Number(height) || 0;
    var aspect = (width > 0 && height > 0) ? width / height : 1;
    var near = this.nearPlane(), far = this.farPlane();
    var m = new Float32Array(16);
    if (this.orthographic) {
      var halfH = this.distance * Math.tan(this.fovY * 0.5);
      var halfW = halfH * aspect;
      if (halfW < 1e-9) halfW = 1e-9;
      if (halfH < 1e-9) halfH = 1e-9;
      m[0] = 1 / halfW;
      m[5] = 1 / halfH;
      m[10] = -2 / (far - near);
      m[14] = -(far + near) / (far - near);
      m[15] = 1;
      return m;
    }
    var fscale = 1 / Math.tan(this.fovY * 0.5);
    var nf = 1 / (near - far);
    m[0] = fscale / aspect;
    m[5] = fscale;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  };

  // -------------------------------------------------- screen <-> world -----
  Camera.prototype.screenRay = function (x, y, width, height) {
    width = Number(width) || 0;
    height = Number(height) || 0;
    if (width <= 0 || height <= 0) {
      var e0 = this.eye();
      return { origin: e0, direction: this.forward(), dir: this.forward() };
    }
    this._update();
    var f = this._forward, r = this._right, u = this._up;
    var aspect = width / height;
    var ndcX = 2 * x / width - 1;
    var ndcY = 1 - 2 * y / height;
    var tanHalf = Math.tan(this.fovY * 0.5);
    var origin, direction;
    if (this.orthographic) {
      var halfH = this.distance * tanHalf, halfW = halfH * aspect;
      origin = [
        this._eye[0] + r[0] * (ndcX * halfW) + u[0] * (ndcY * halfH),
        this._eye[1] + r[1] * (ndcX * halfW) + u[1] * (ndcY * halfH),
        this._eye[2] + r[2] * (ndcX * halfW) + u[2] * (ndcY * halfH)
      ];
      direction = [f[0], f[1], f[2]];
    } else {
      origin = [this._eye[0], this._eye[1], this._eye[2]];
      direction = normalize([
        f[0] + r[0] * (ndcX * tanHalf * aspect) + u[0] * (ndcY * tanHalf),
        f[1] + r[1] * (ndcX * tanHalf * aspect) + u[1] * (ndcY * tanHalf),
        f[2] + r[2] * (ndcX * tanHalf * aspect) + u[2] * (ndcY * tanHalf)
      ]);
    }
    return { origin: origin, direction: direction, dir: direction };
  };

  Camera.prototype.worldToScreen = function (p, width, height) {
    width = Number(width) || 0;
    height = Number(height) || 0;
    var out = { x: 0, y: 0, depth: 0, visible: false };
    if (!p || width <= 0 || height <= 0) return out;
    this._update();
    var f = this._forward, r = this._right, u = this._up;
    var vx = p[0] - this._eye[0], vy = p[1] - this._eye[1], vz = p[2] - this._eye[2];
    var xc = vx * r[0] + vy * r[1] + vz * r[2];
    var yc = vx * u[0] + vy * u[1] + vz * u[2];
    var zc = vx * f[0] + vy * f[1] + vz * f[2];
    if (zc <= 0) return out;
    var aspect = width / height;
    var tanHalf = Math.tan(this.fovY * 0.5);
    var near = this.nearPlane(), far = this.farPlane();
    var ndcX, ndcY, ndcZ;
    if (this.orthographic) {
      var halfH = this.distance * tanHalf, halfW = halfH * aspect;
      ndcX = xc / halfW;
      ndcY = yc / halfH;
      ndcZ = 2 * (zc - near) / (far - near) - 1;
    } else {
      ndcX = xc / (zc * tanHalf * aspect);
      ndcY = yc / (zc * tanHalf);
      ndcZ = ((-zc) * (far + near) / (near - far) + 2 * far * near / (near - far)) / zc;
    }
    out.x = (ndcX * 0.5 + 0.5) * width;
    out.y = (1 - (ndcY * 0.5 + 0.5)) * height;
    out.depth = ndcZ;
    out.visible = (zc > near * 0.5) && (ndcZ >= -1.25) && (ndcZ <= 1.25);
    return out;
  };

  // ------------------------------------------------------------- extras ----
  Camera.prototype.setAspectFit = function (width, height, margin) {
    return this.fit(height > 0 ? width / height : 1, margin);
  };

  Camera.DEG2RAD = DEG2RAD;
  Camera.RAD2DEG = RAD2DEG;
  Camera.PITCH_LIMIT = PITCH_LIMIT;
  Camera.ORBIT_RAD_PER_PX = ORBIT_RAD_PER_PX;
  Camera.DEFAULTS = {
    yawDeg: 35, pitchDeg: 24, fovYDeg: 38,
    distance: DEFAULT_DISTANCE, sceneRadius: DEFAULT_SCENE_RADIUS
  };

  CL.Camera = Camera;
})(typeof globalThis !== 'undefined' ? globalThis : this);
