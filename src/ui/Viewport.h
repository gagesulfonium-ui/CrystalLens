#pragma once

#include "core/Crystal.h"
#include "render/Camera.h"
#include "render/GL.h"
#include "render/Overlay.h"
#include "render/Renderer.h"
#include "ui/Commands.h"

#include <memory>
#include <string>
#include <vector>

namespace cl {

enum class MeasureMode { None = 0, Distance = 1, Angle = 2 };

class ViewportHost {
public:
    virtual ~ViewportHost() = default;
    virtual void OnViewportSelectionChanged(int atomIndex) = 0;
    virtual void OnViewportMeasurementsChanged() = 0;
    virtual void OnViewportHoverChanged(int atomIndex) = 0;
    virtual void OnViewportModeChanged(MeasureMode mode) = 0;
    virtual void OnViewportCommand(int commandId) = 0;
};

class Viewport {
public:
    explicit Viewport(ViewportHost* host);
    ~Viewport();

    Viewport(const Viewport&) = delete;
    Viewport& operator=(const Viewport&) = delete;

    bool Create(HWND parent, int controlId, float dpiScale);
    void Destroy();
    HWND Hwnd() const { return hwnd_; }

    void SetDpi(float dpiScale);
    void SetStructure(std::shared_ptr<const Structure> structure);
    void RefreshStructure(bool preserveCamera, int selectIndex = -1);
    void SelectAtom(int index);
    const Structure* GetStructure() const { return structure_.get(); }

    void SetOptions(const RenderOptions& options);
    void SetAppearance(const AppearanceState& state);
    const RenderOptions& Options() const { return options_; }
    void SetOrthographic(bool orthographic);
    bool Orthographic() const { return camera_.orthographic; }
    void ToggleProjection();

    void SetMeasureMode(MeasureMode mode);
    MeasureMode Mode() const { return mode_; }
    void CancelMeasure();
    void ClearMeasurements();
    void RemoveMeasurement(int index);
    const std::vector<Measurement>& Measurements() const { return measurements_; }
    int PendingCount() const { return static_cast<int>(pendingPicks_.size()); }
    int RequiredPicks() const { return mode_ == MeasureMode::Angle ? 3 : 2; }
    int SelectedAtom() const { return selectedAtom_; }
    int HoveredAtom() const { return hoveredAtom_; }

    void ResetView();
    void FitView();
    void FitToStructure();
    void InvalidateView();
    bool CaptureScreenshot(const std::wstring& path, std::wstring* error);
    std::wstring RendererDescription() const;
    std::wstring RendererError() const { return Utf8ToWide(rendererError_); }
    bool RendererReady() const { return rendererReady_; }

private:
    enum class DragMode { None, Orbit, Pan };

    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);

    bool InitializeGraphics();
    void ShutdownGraphics();
    void UpdateWindowRegion();
    void RenderFrame(bool swapBuffers);
    void DrawHud();
    void DrawEmptyState();
    void DrawStructureHud();
    void DrawElementLegend();
    void UpdateOrbitAnimation();
    void BeginOrbitAnimation();
    void StopOrbitAnimation();
    void DrawAxisGizmo();
    void DrawMeasurementLabels();
    void DrawAtomLabels();
    void DrawFallback(HDC dc);
    void UpdateHover(int x, int y);
    void UpdateHighlight();
    void UpdateAnnotations();
    void NotifySelection();
    void NotifyMeasurements();
    void SetModeInternal(MeasureMode mode, bool notify);
    int PickAtom(int x, int y) const;
    void HandleLeftClick(int x, int y);
    void SetCursorForState();
    void Flash(const std::wstring& text);
    std::wstring Ellipsize(const std::wstring& text, float pixelSize, bool bold, float maxWidth);
    float Aspect() const;
    Vec3 AtomWorldPosition(int index) const;
    Vec3 MeasurementLabelPosition(const Measurement& measurement) const;

    ViewportHost* host_ = nullptr;
    HWND hwnd_ = nullptr;
    GLContext gl_;
    Renderer renderer_;
    Overlay overlay_;
    Camera camera_;
    float dpiScale_ = 1.0f;
    int width_ = 0;
    int height_ = 0;

    std::shared_ptr<const Structure> structure_;
    RenderOptions options_;
    MeasureMode mode_ = MeasureMode::None;
    std::vector<int> pendingPicks_;
    std::vector<Measurement> measurements_;
    int selectedAtom_ = -1;
    int hoveredAtom_ = -1;

    bool mouseDown_ = false;
    bool movedDuringDrag_ = false;
    DragMode dragMode_ = DragMode::None;
    int dragButton_ = 0;
    int dragStartX_ = 0;
    int dragStartY_ = 0;
    int lastMouseX_ = 0;
    int lastMouseY_ = 0;
    bool trackingMouseLeave_ = false;
    bool emptyButtonHovered_ = false;
    RECT emptyButtonRect_{};
    bool emptyButtonRectValid_ = false;
    bool pendingFit_ = true;
    bool userAdjustedCamera_ = false;
    bool orbitAnimating_ = false;
    double orbitTargetYaw_ = 0.0;
    double orbitTargetPitch_ = 0.0;
    double orbitVelocityYaw_ = 0.0;
    double orbitVelocityPitch_ = 0.0;
    unsigned long long orbitLastTickMs_ = 0;
    unsigned long long orbitLastInputMs_ = 0;

    bool rendererReady_ = false;
    std::string rendererError_;
    bool glFailed_ = false;
    bool destroyed_ = false;

    std::wstring flashText_;
    ULONGLONG flashUntil_ = 0;

    LARGE_INTEGER perfFrequency_{};
    LARGE_INTEGER lastFrameCounter_{};
    double fps_ = 0.0;
    int framesSinceSample_ = 0;
    ULONGLONG lastFpsSample_ = 0;
};

} // namespace cl
