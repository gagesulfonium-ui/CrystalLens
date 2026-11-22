#include "Camera.h"

#include <algorithm>
#include <cmath>

namespace cl {

namespace {
// Rodrigues' formula for rotating a world-space vector about a unit axis.
Vec3 RotateVector(const Vec3& v, const Vec3& axis, double c, double s) {
    return v * c + Cross(axis, v) * s + axis * (Dot(axis, v) * (1.0 - c));
}
} // namespace

Camera::Camera() { ResetOrientation(); }

void Camera::ResetOrientation() {
    constexpr double yaw = 35.0 * kDegToRad;
    constexpr double pitch = 24.0 * kDegToRad;
    right_ = {-std::sin(yaw), std::cos(yaw), 0.0};
    up_ = {-std::cos(yaw) * std::sin(pitch), -std::sin(yaw) * std::sin(pitch), std::cos(pitch)};
}

void Camera::SetScene(const Vec3& center, double radius) {
    sceneCenter_ = target = center;
    sceneRadius_ = std::max(0.5, radius);
}

Vec3 Camera::Eye() const {
    return target - Forward() * distance;
}

void Camera::Basis(Vec3& forward, Vec3& right, Vec3& up) const {
    forward = Forward();
    right = right_;
    up = up_;
}

Vec3 Camera::Forward() const { return Cross(up_, right_); }
Vec3 Camera::Right() const { return right_; }
Vec3 Camera::Up() const { return up_; }

double Camera::NearPlane() const {
    return std::max(0.02, distance - sceneRadius_ * 2.2);
}

double Camera::FarPlane() const {
    return std::max(NearPlane() + 2.0, distance + sceneRadius_ * 5.0 + 10.0);
}

void Camera::Fit(double aspect, double margin) {
    if (aspect <= 0.05) aspect = 1.0;
    const double vhalf = fovY * 0.5;
    const double hhalf = std::atan(std::tan(vhalf) * aspect);
    const double vertical = sceneRadius_ / std::max(1e-4, std::sin(vhalf));
    const double horizontal = sceneRadius_ / std::max(1e-4, std::sin(hhalf));
    distance = std::max(vertical, horizontal) * std::max(1.0, margin);
    distance = Clamp(distance, sceneRadius_ * 0.06 + 0.05, sceneRadius_ * 30.0 + 50.0);
}

void Camera::FitPoints(const std::vector<Vec3>& worldPoints, double aspect, double margin) {
    if (worldPoints.empty()) {
        Fit(aspect, margin);
        return;
    }
    if (aspect <= 0.05) aspect = 1.0;
    const double tanHalf = std::tan(fovY * 0.5);
    Vec3 f, r, u;
    Basis(f, r, u);
    double required = 0.0;
    for (const Vec3& world : worldPoints) {
        const Vec3 q = world - target;
        const double x = std::abs(Dot(q, r));
        const double y = std::abs(Dot(q, u));
        const double z = Dot(q, f);
        if (orthographic) {
            required = std::max(required, y * margin / tanHalf);
            required = std::max(required, x * margin / (tanHalf * aspect));
        } else {
            required = std::max(required, y * margin / tanHalf - z);
            required = std::max(required, x * margin / (tanHalf * aspect) - z);
        }
    }
    distance = Clamp(required, sceneRadius_ * 0.05 + 0.05, sceneRadius_ * 30.0 + 50.0);
}

void Camera::FitScenePoints(const std::vector<Vec3>& points, double aspect, double margin) {
    if (points.empty()) { Fit(aspect, margin); return; }
    Vec3 lo = points.front(), hi = lo;
    for (const Vec3& p : points) {
        for (int axis = 0; axis < 3; ++axis) {
            lo[axis] = std::min(lo[axis], p[axis]);
            hi[axis] = std::max(hi[axis], p[axis]);
        }
    }
    const Vec3 center = (lo + hi) * 0.5;
    double radiusSq = 0.0;
    for (const auto& p : points) radiusSq = std::max(radiusSq, LengthSq(p - center));
    SetScene(center, std::sqrt(radiusSq));
    FitPoints(points, aspect, margin);
}

void Camera::Reset(const Vec3& center, double radius, double aspect) {
    SetScene(center, radius);
    ResetOrientation();
    Fit(aspect);
}

void Camera::OrbitBy(double horizontalRadians, double verticalRadians) {
    OrbitFrom(*this, horizontalRadians, verticalRadians);
}

void Camera::OrbitFromDrag(const Camera& start, double dx, double dy, int width, int height) {
    const int span = std::min(width, height);
    if (span <= 0) return;
    const double visibleHalfHeight = start.distance * std::tan(start.fovY * 0.5);
    const double sensitivity = Clamp(visibleHalfHeight / start.sceneRadius_, 0.18, 1.0);
    const double radiansPerPixel = sensitivity * kPi / span;
    OrbitFrom(start, dx * radiansPerPixel, dy * radiansPerPixel);
}

void Camera::OrbitFrom(const Camera& start, double horizontal, double vertical) {
    const double angle = std::hypot(horizontal, vertical);
    if (angle == 0.0) {
        right_ = start.right_;
        up_ = start.up_;
        target = start.target;
        return;
    }
    // Rotate the camera opposite the gesture so the near face follows the pointer.
    const Vec3 axis = (start.up_ * -horizontal - start.right_ * vertical) / angle;
    const double c = std::cos(angle), s = std::sin(angle);
    const Vec3 right = Normalize(RotateVector(start.right_, axis, c, s));
    const Vec3 up = RotateVector(start.up_, axis, c, s);
    // Preserve the screen offset of the scene center even after a pan.
    target = sceneCenter_ + RotateVector(start.target - sceneCenter_, axis, c, s);
    right_ = right;
    up_ = Normalize(up - right * Dot(right, up));
}

void Camera::Pan(double dxPixels, double dyPixels, int width, int height) {
    if (height <= 0) return;
    const double worldPerPixel = 2.0 * distance * std::tan(fovY * 0.5) / static_cast<double>(height);
    Vec3 f, r, u;
    Basis(f, r, u);
    target += r * (-dxPixels * worldPerPixel);
    target += u * (dyPixels * worldPerPixel);
}

void Camera::Zoom(double wheelSteps) {
    if (wheelSteps == 0.0) return;
    distance *= std::exp(-wheelSteps * 0.16);
    distance = Clamp(distance, std::max(0.05, sceneRadius_ * 0.035), sceneRadius_ * 40.0 + 100.0);
}

void Camera::ZoomAt(double steps, double x, double y, int width, int height) {
    if (width <= 0 || height <= 0) return;
    const double oldDistance = distance;
    Zoom(steps);
    // Keep the point under the cursor on the target plane at the same pixel.
    const double scale = (oldDistance - distance) * 2 * std::tan(fovY * 0.5) / height;
    target += (Right() * (x - width * 0.5) + Up() * (height * 0.5 - y)) * scale;
}

Ray Camera::ScreenRay(double x, double y, int width, int height) const {
    if (width <= 0 || height <= 0) return {Eye(), Forward()};
    Vec3 f, r, u;
    Basis(f, r, u);
    const double aspect = static_cast<double>(width) / static_cast<double>(height);
    const double ndcX = 2.0 * x / static_cast<double>(width) - 1.0;
    const double ndcY = 1.0 - 2.0 * y / static_cast<double>(height);
    const double tanHalf = std::tan(fovY * 0.5);
    if (orthographic) {
        const double halfH = distance * tanHalf;
        const double halfW = halfH * aspect;
        Ray ray;
        ray.origin = Eye() + r * (ndcX * halfW) + u * (ndcY * halfH);
        ray.direction = f;
        return ray;
    }
    Ray ray;
    ray.origin = Eye();
    ray.direction = Normalize(f + r * (ndcX * tanHalf * aspect) + u * (ndcY * tanHalf));
    return ray;
}

ScreenPoint Camera::WorldToScreen(const Vec3& point, int width, int height) const {
    ScreenPoint out;
    if (width <= 0 || height <= 0) return out;
    Vec3 f, r, u;
    Basis(f, r, u);
    const Vec3 v = point - Eye();
    const double xc = Dot(v, r);
    const double yc = Dot(v, u);
    const double zc = Dot(v, f);
    if (zc <= 0.0) return out;
    const double aspect = static_cast<double>(width) / static_cast<double>(height);
    const double tanHalf = std::tan(fovY * 0.5);
    double ndcX = 0.0, ndcY = 0.0, ndcZ = 0.0;
    if (orthographic) {
        const double halfH = distance * tanHalf;
        const double halfW = halfH * aspect;
        ndcX = xc / halfW;
        ndcY = yc / halfH;
        ndcZ = 2.0 * (zc - NearPlane()) / (FarPlane() - NearPlane()) - 1.0;
    } else {
        ndcX = xc / (zc * tanHalf * aspect);
        ndcY = yc / (zc * tanHalf);
        const double n = NearPlane();
        const double fa = FarPlane();
        ndcZ = ((-zc) * (fa + n) / (n - fa) + 2.0 * fa * n / (n - fa)) / zc;
    }
    out.x = (ndcX * 0.5 + 0.5) * width;
    out.y = (1.0 - (ndcY * 0.5 + 0.5)) * height;
    out.depth = ndcZ;
    out.visible = zc > NearPlane() * 0.5 && ndcZ >= -1.25 && ndcZ <= 1.25;
    return out;
}

Mat4 Camera::ViewMatrix() const {
    Vec3 f, r, u;
    Basis(f, r, u);
    const Vec3 eye = Eye();
    Mat4 out;
    out.m[0] = static_cast<float>(r.x);
    out.m[1] = static_cast<float>(u.x);
    out.m[2] = static_cast<float>(-f.x);
    out.m[3] = 0.0f;
    out.m[4] = static_cast<float>(r.y);
    out.m[5] = static_cast<float>(u.y);
    out.m[6] = static_cast<float>(-f.y);
    out.m[7] = 0.0f;
    out.m[8] = static_cast<float>(r.z);
    out.m[9] = static_cast<float>(u.z);
    out.m[10] = static_cast<float>(-f.z);
    out.m[11] = 0.0f;
    out.m[12] = static_cast<float>(-Dot(r, eye));
    out.m[13] = static_cast<float>(-Dot(u, eye));
    out.m[14] = static_cast<float>(Dot(f, eye));
    out.m[15] = 1.0f;
    return out;
}

Mat4 Camera::ProjectionMatrix(int width, int height) const {
    Mat4 out;
    for (float& value : out.m) value = 0.0f;
    const double aspect = height > 0 ? static_cast<double>(width) / static_cast<double>(height) : 1.0;
    const double n = NearPlane();
    const double f = FarPlane();
    if (orthographic) {
        const double halfH = distance * std::tan(fovY * 0.5);
        const double halfW = halfH * aspect;
        out.m[0] = static_cast<float>(1.0 / halfW);
        out.m[5] = static_cast<float>(1.0 / halfH);
        out.m[10] = static_cast<float>(-2.0 / (f - n));
        out.m[14] = static_cast<float>(-(f + n) / (f - n));
        out.m[15] = 1.0f;
    } else {
        const double fscale = 1.0 / std::tan(fovY * 0.5);
        out.m[0] = static_cast<float>(fscale / aspect);
        out.m[5] = static_cast<float>(fscale);
        out.m[10] = static_cast<float>((f + n) / (n - f));
        out.m[11] = -1.0f;
        out.m[14] = static_cast<float>(2.0 * f * n / (n - f));
    }
    return out;
}

} // namespace cl
