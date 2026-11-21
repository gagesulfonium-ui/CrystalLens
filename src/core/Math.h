#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace cl {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDegToRad = kPi / 180.0;
constexpr double kRadToDeg = 180.0 / kPi;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(double s) const { return {x / s, y / s, z / s}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }
    Vec3& operator*=(double s) { x *= s; y *= s; z *= s; return *this; }
    double& operator[](int i) { return (&x)[i]; }
    double operator[](int i) const { return (&x)[i]; }
};

inline Vec3 operator*(double s, const Vec3& v) { return v * s; }
inline double Dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 Cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double LengthSq(const Vec3& v) { return Dot(v, v); }
inline double Length(const Vec3& v) { return std::sqrt(Dot(v, v)); }
inline Vec3 Normalize(const Vec3& v) {
    const double len = Length(v);
    return len > 1e-15 ? v / len : Vec3{};
}
inline Vec3 Lerp(const Vec3& a, const Vec3& b, double t) { return a + (b - a) * t; }
inline double Clamp(double v, double lo, double hi) { return std::max(lo, std::min(hi, v)); }
inline float Clampf(float v, float lo, float hi) { return std::max(lo, std::min(hi, v)); }

// Wrap a fractional coordinate into [0, 1).
inline double Wrap01(double v) {
    double r = std::fmod(v, 1.0);
    if (r < 0.0) r += 1.0;
    if (r >= 1.0 - 1e-12) r = 0.0;
    return r;
}

inline Vec3 Wrap01(const Vec3& v) { return {Wrap01(v.x), Wrap01(v.y), Wrap01(v.z)}; }

// Wrap a displacement into [-0.5, 0.5).
inline double WrapHalf(double v) {
    double r = std::fmod(v + 0.5, 1.0);
    if (r < 0.0) r += 1.0;
    return r - 0.5;
}

inline Vec3 WrapHalf(const Vec3& v) { return {WrapHalf(v.x), WrapHalf(v.y), WrapHalf(v.z)}; }

inline bool NearlyEqual(double a, double b, double eps = 1e-6) { return std::abs(a - b) <= eps; }

inline uint32_t ColorFromHex(uint32_t rgb, float alpha = 1.0f) {
    const uint32_t a = static_cast<uint32_t>(Clamp(alpha, 0.0f, 1.0f) * 255.0f + 0.5f);
    return (a << 24) | (rgb & 0x00FFFFFFu);
}

} // namespace cl
