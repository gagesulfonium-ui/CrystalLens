#pragma once

#include "core/Math.h"

#include <vector>

namespace cl {

struct Mat4 {
    float m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
    static Mat4 Identity() { return Mat4{}; }
};

struct Ray {
    Vec3 origin;
    Vec3 direction;
};

struct ScreenPoint {
    double x = 0.0;
    double y = 0.0;
    double depth = 0.0;
    bool visible = false;
};

class Camera {
public:
    Vec3 target{0, 0, 0};
    double distance = 20.0;
    double yaw = 35.0 * kDegToRad;
    double pitch = 24.0 * kDegToRad;
    double fovY = 38.0 * kDegToRad;
    bool orthographic = false;

    void SetScene(const Vec3& center, double radius);
    void Fit(double aspect, double margin = 1.12);
    void FitPoints(const std::vector<Vec3>& worldPoints, double aspect, double margin = 1.16);
    void FitScenePoints(const std::vector<Vec3>& points, double aspect, double margin);
    void Reset(const Vec3& center, double radius, double aspect);
    void Orbit(double dxPixels, double dyPixels);
    void Pan(double dxPixels, double dyPixels, int width, int height);
    void Zoom(double wheelSteps);
    void SetProjection(bool ortho) { orthographic = ortho; }

    Ray ScreenRay(double x, double y, int width, int height) const;
    ScreenPoint WorldToScreen(const Vec3& point, int width, int height) const;

    Vec3 Eye() const;
    Vec3 Forward() const;
    Vec3 Right() const;
    Vec3 Up() const;
    Mat4 ViewMatrix() const;
    Mat4 ProjectionMatrix(int width, int height) const;
    double NearPlane() const;
    double FarPlane() const;
    double SceneRadius() const { return sceneRadius_; }

private:
    double sceneRadius_ = 10.0;
    void Basis(Vec3& forward, Vec3& right, Vec3& up) const;
};

} // namespace cl
