#pragma once

#include "UiDraw.h"
#include "render/Appearance.h"

#include <windows.h>
#include <gdiplus.h>

#include <cstdint>
#include <functional>
#include <memory>

namespace cl {

// Small modeless appearance editor with a real HSV colour wheel. Every edit
// is pushed through the change callback immediately so the viewport behind the
// window previews the result while the user drags.
class AppearanceWindow {
public:
    using ChangeCallback = std::function<void(const AppearanceState&)>;
    using CloseCallback = std::function<void()>;

    ~AppearanceWindow();

    bool Create(HWND owner);
    void Show(const AppearanceState& state, float dpiScale, ChangeCallback onChange, CloseCallback onClose);
    void Hide();
    bool IsVisible() const { return visible_; }

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);

    void Layout();
    void Paint();
    void BuildWheel();
    void PositionWindow();
    void ApplyFromPoint(int x, int y);
    uint32_t& ActiveColor();
    void PushChange();
    void SetState(const AppearanceState& state);
    void Close();
    int HitTest(int x, int y) const;
    float S(float value) const { return value * dpi_; }

    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    float dpi_ = 1.0f;
    int width_ = 0;
    int height_ = 0;
    AppearanceState state_{};
    double hue_[3] = {0.0, 0.0};
    double sat_[3] = {0.0, 0.0};
    double val_[3] = {0.0, 0.0};
    int active_ = 0;
    int drag_ = 0;
    int lastX_ = 0;
    int lastY_ = 0;

    Gdiplus::Rect wheelRect_{};
    Gdiplus::Rect valueRect_{};
    Gdiplus::Rect swatchRect_[3]{};
    Gdiplus::Rect widthRect_{};
    Gdiplus::Rect transparencyRect_{};
    Gdiplus::Rect edgeWidthRect_{};
    Gdiplus::Rect resetRect_{};
    Gdiplus::Rect closeRect_{};
    Gdiplus::Rect closeXRect_{};
    std::unique_ptr<Gdiplus::Bitmap> wheel_;
    int wheelPixels_ = 0;

    ChangeCallback onChange_;
    CloseCallback onClose_;
};

} // namespace cl
