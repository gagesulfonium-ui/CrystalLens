#include "AppearanceWindow.h"

#include "Localization.h"

#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <string>

namespace cl {
using namespace Theme;
namespace {

constexpr int kHitTransparency = 9;
constexpr int kHitEdgeWidth = 10;
constexpr int kHitOutlineColor = 11;
constexpr float layoutHeight = 568.f;
constexpr int kHitNone = 0;
constexpr int kHitWheel = 1;
constexpr int kHitValue = 2;
constexpr int kHitSwatch0 = 3;
constexpr int kHitSwatch1 = 4;
constexpr int kHitWidth = 5;
constexpr int kHitReset = 6;
constexpr int kHitClose = 7;
constexpr int kHitCloseX = 8;

double Clamp01(double value) { return std::clamp(value, 0.0, 1.0); }

uint32_t PackRgb(double r, double g, double b) {
    const auto byte = [](double v) { return static_cast<uint32_t>(std::lround(Clamp01(v) * 255.0)); };
    return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

void RgbToHsv(uint32_t rgb, double& hue, double& sat, double& val) {
    const double r = ((rgb >> 16) & 0xFF) / 255.0;
    const double g = ((rgb >> 8) & 0xFF) / 255.0;
    const double b = (rgb & 0xFF) / 255.0;
    const double mx = std::max({r, g, b});
    const double mn = std::min({r, g, b});
    const double delta = mx - mn;
    val = mx;
    sat = mx <= 0.0 ? 0.0 : delta / mx;
    if (delta <= 1e-9) {
        hue = 0.0;
        return;
    }
    if (mx == r) {
        hue = 60.0 * std::fmod((g - b) / delta, 6.0);
    } else if (mx == g) {
        hue = 60.0 * ((b - r) / delta + 2.0);
    } else {
        hue = 60.0 * ((r - g) / delta + 4.0);
    }
    if (hue < 0.0) hue += 360.0;
}

void HsvToRgb(double hue, double sat, double val, double& r, double& g, double& b) {
    hue = std::fmod(hue, 360.0);
    if (hue < 0.0) hue += 360.0;
    sat = Clamp01(sat);
    val = Clamp01(val);
    const double c = val * sat;
    const double h = hue / 60.0;
    const double x = c * (1.0 - std::abs(std::fmod(h, 2.0) - 1.0));
    double r1 = 0.0, g1 = 0.0, b1 = 0.0;
    if (h < 1.0) {
        r1 = c; g1 = x;
    } else if (h < 2.0) {
        r1 = x; g1 = c;
    } else if (h < 3.0) {
        g1 = c; b1 = x;
    } else if (h < 4.0) {
        g1 = x; b1 = c;
    } else if (h < 5.0) {
        r1 = x; b1 = c;
    } else {
        r1 = c; b1 = x;
    }
    const double m = val - c;
    r = r1 + m; g = g1 + m; b = b1 + m;
}

uint32_t HsvColor(double hue, double sat, double val) {
    double r = 0, g = 0, b = 0;
    HsvToRgb(hue, sat, val, r, g, b);
    return PackRgb(r, g, b);
}

void SetRoundRegion(HWND hwnd, int width, int height, float radius) {
    if (width <= 0 || height <= 0) return;
    const int r = std::max(2, static_cast<int>(std::lround(radius)));
    HRGN region = CreateRoundRectRgn(0, 0, width + 1, height + 1, r * 2, r * 2);
    SetWindowRgn(hwnd, region, TRUE);
}

bool Contains(const Gdiplus::Rect& rect, int x, int y) {
    return x >= rect.X && x < rect.X + rect.Width && y >= rect.Y && y < rect.Y + rect.Height;
}

UiRect Ui(const Gdiplus::Rect& rect) {
    return UiRect(static_cast<float>(rect.X), static_cast<float>(rect.Y), static_cast<float>(rect.Width),
                  static_cast<float>(rect.Height));
}

std::wstring HexText(uint32_t color) {
    wchar_t buffer[16]{};
    swprintf_s(buffer, L"#%06X", static_cast<unsigned>(color & 0xFFFFFFu));
    return buffer;
}

template <typename Fn>
void PaintBuffered(HWND hwnd, Fn&& draw) {
    PAINTSTRUCT ps{};
    HDC dc = BeginPaint(hwnd, &ps);
    RECT rc{};
    GetClientRect(hwnd, &rc);
    const int width = rc.right - rc.left;
    const int height = rc.bottom - rc.top;
    if (width > 0 && height > 0) {
        Gdiplus::Bitmap buffer(width, height, PixelFormat32bppPARGB);
        Gdiplus::Graphics graphics(&buffer);
        graphics.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        graphics.SetCompositingQuality(Gdiplus::CompositingQualityHighQuality);
        graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
        draw(graphics, width, height);
        Gdiplus::Graphics screen(dc);
        screen.SetCompositingMode(Gdiplus::CompositingModeSourceOver);
        screen.DrawImage(&buffer, 0, 0);
    }
    EndPaint(hwnd, &ps);
}

} // namespace

AppearanceWindow::~AppearanceWindow() {
    if (hwnd_) DestroyWindow(hwnd_);
}

bool AppearanceWindow::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensAppearance";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW, wc.lpszClassName, L"", WS_POPUP, 0, 0, 100, 100, owner_,
                            nullptr, instance, this);
    return hwnd_ != nullptr;
}

uint32_t& AppearanceWindow::ActiveColor() {
    if (active_ == 0) return state_.cellColor;
    if (active_ == 1) return state_.backgroundColor;
    return state_.polyEdgeColor;
}

void AppearanceWindow::SetState(const AppearanceState& state) {
    state_ = state;
    state_.cellLineWidth = std::clamp(state_.cellLineWidth, 0.5f, 4.0f);
    RgbToHsv(state_.cellColor, hue_[0], sat_[0], val_[0]);
    RgbToHsv(state_.backgroundColor, hue_[1], sat_[1], val_[1]);
    RgbToHsv(state_.polyEdgeColor, hue_[2], sat_[2], val_[2]);
}

void AppearanceWindow::Show(const AppearanceState& state, float dpiScale, ChangeCallback onChange,
                            CloseCallback onClose) {
    onChange_ = std::move(onChange);
    onClose_ = std::move(onClose);
    dpi_ = std::max(1.0f, dpiScale);
    MONITORINFO monitor{sizeof(MONITORINFO)};
    if (GetMonitorInfoW(MonitorFromWindow(owner_, MONITOR_DEFAULTTONEAREST), &monitor)) {
        const float available = static_cast<float>(monitor.rcWork.bottom - monitor.rcWork.top - 20);
        dpi_ = std::min(dpi_, available / layoutHeight);
    }
    SetState(state);
    active_ = 0;
    drag_ = 0;
    Layout();
    BuildWheel();
    SetRoundRegion(hwnd_, width_, height_, S(14.0f));
    PositionWindow();
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    visible_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void AppearanceWindow::Hide() {
    if (!visible_) return;
    visible_ = false;
    ShowWindow(hwnd_, SW_HIDE);
}

void AppearanceWindow::Close() {
    if (!visible_) return;
    Hide();
    if (onClose_) onClose_();
}

void AppearanceWindow::PositionWindow() {
    RECT ownerRect{0, 0, 1280, 800};
    if (owner_) GetWindowRect(owner_, &ownerRect);
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    HMONITOR monitor = MonitorFromWindow(owner_, MONITOR_DEFAULTTONEAREST);
    RECT work{0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
    if (monitor && GetMonitorInfoW(monitor, &info)) work = info.rcWork;
    int x = ownerRect.right - width_ - static_cast<int>(S(28.0f));
    int y = ownerRect.top + static_cast<int>(S(96.0f));
    const int minX = static_cast<int>(work.left) + 8;
    const int maxX = std::max(minX, static_cast<int>(work.right) - width_ - 8);
    const int minY = static_cast<int>(work.top) + 8;
    const int maxY = std::max(minY, static_cast<int>(work.bottom) - height_ - 8);
    x = std::clamp(x, minX, maxX);
    y = std::clamp(y, minY, maxY);
    SetWindowPos(hwnd_, HWND_TOP, x, y, width_, height_, SWP_NOACTIVATE);
}

void AppearanceWindow::Layout() {
    const int margin = static_cast<int>(S(22.0f));
    width_ = static_cast<int>(S(438.0f));
    height_ = static_cast<int>(S(layoutHeight));
    wheelRect_ = Gdiplus::Rect(margin, static_cast<int>(S(104.0f)), static_cast<int>(S(208.0f)),
                               static_cast<int>(S(208.0f)));
    const int valueX = wheelRect_.X + wheelRect_.Width + static_cast<int>(S(14.0f));
    valueRect_ = Gdiplus::Rect(valueX, wheelRect_.Y, static_cast<int>(S(18.0f)), wheelRect_.Height);
    const int colX = valueX + valueRect_.Width + static_cast<int>(S(14.0f));
    const int colW = width_ - margin - colX;
    swatchRect_[0] = Gdiplus::Rect(colX, wheelRect_.Y, colW, static_cast<int>(S(46.0f)));
    swatchRect_[1] = Gdiplus::Rect(colX, wheelRect_.Y + static_cast<int>(S(66.0f)), colW,
                                   static_cast<int>(S(46.0f)));
    swatchRect_[2] = swatchRect_[1];
    swatchRect_[2].Y += static_cast<int>(S(66.0f));
    widthRect_ = Gdiplus::Rect(margin, static_cast<int>(S(367.0f)), width_ - margin * 2,
                               static_cast<int>(S(8.0f)));
    transparencyRect_ = edgeWidthRect_ = widthRect_;
    transparencyRect_.Y += static_cast<int>(S(48.0f));
    edgeWidthRect_.Y += static_cast<int>(S(96.0f));
    resetRect_ = Gdiplus::Rect(margin, height_ - static_cast<int>(S(66.0f)), static_cast<int>(S(142.0f)),
                               static_cast<int>(S(42.0f)));
    closeRect_ = Gdiplus::Rect(width_ - margin - static_cast<int>(S(142.0f)),
                               height_ - static_cast<int>(S(66.0f)), static_cast<int>(S(142.0f)),
                               static_cast<int>(S(42.0f)));
    closeXRect_ = Gdiplus::Rect(width_ - margin - static_cast<int>(S(22.0f)), static_cast<int>(S(18.0f)),
                                static_cast<int>(S(22.0f)), static_cast<int>(S(22.0f)));
}

void AppearanceWindow::BuildWheel() {
    const int pixels = wheelRect_.Width;
    if (pixels <= 0) return;
    if (wheel_ && wheelPixels_ == pixels) return;
    wheel_ = std::make_unique<Gdiplus::Bitmap>(pixels, pixels, PixelFormat32bppPARGB);
    Gdiplus::Rect rect(0, 0, pixels, pixels);
    Gdiplus::BitmapData data{};
    if (wheel_->LockBits(&rect, Gdiplus::ImageLockModeWrite, PixelFormat32bppPARGB, &data) !=
        Gdiplus::Ok) {
        wheel_.reset();
        return;
    }
    const double center = pixels * 0.5;
    const double radius = std::max(1.0, center - 0.5);
    for (int y = 0; y < pixels; ++y) {
        auto* row = reinterpret_cast<uint8_t*>(static_cast<uint8_t*>(data.Scan0) + y * data.Stride);
        for (int x = 0; x < pixels; ++x) {
            const double dx = (x + 0.5) - center;
            const double dy = (y + 0.5) - center;
            const double distance = std::sqrt(dx * dx + dy * dy);
            uint8_t* pixel = row + x * 4;
            if (distance > radius) {
                pixel[0] = pixel[1] = pixel[2] = pixel[3] = 0;
                continue;
            }
            double hue = std::atan2(dy, dx) * 180.0 / 3.14159265358979323846;
            if (hue < 0.0) hue += 360.0;
            double r = 0, g = 0, b = 0;
            HsvToRgb(hue, Clamp01(distance / radius), 1.0, r, g, b);
            pixel[0] = static_cast<uint8_t>(std::lround(Clamp01(b) * 255.0));
            pixel[1] = static_cast<uint8_t>(std::lround(Clamp01(g) * 255.0));
            pixel[2] = static_cast<uint8_t>(std::lround(Clamp01(r) * 255.0));
            pixel[3] = 255;
        }
    }
    wheel_->UnlockBits(&data);
    wheelPixels_ = pixels;
}

int AppearanceWindow::HitTest(int x, int y) const {
    if (Contains(closeXRect_, x, y) || Contains(closeRect_, x, y)) return kHitCloseX;
    if (Contains(resetRect_, x, y)) return kHitReset;
    if (Contains(wheelRect_, x, y)) return kHitWheel;
    if (Contains(valueRect_, x, y)) return kHitValue;
    if (Contains(swatchRect_[0], x, y)) return kHitSwatch0;
    if (Contains(swatchRect_[1], x, y)) return kHitSwatch1;
    if (Contains(swatchRect_[2], x, y)) return kHitOutlineColor;
    auto onTrack = [&](const Gdiplus::Rect& rect) {
        return x >= rect.X - S(7.f) && x <= rect.GetRight() + S(7.f) &&
               y >= rect.Y - S(10.f) && y <= rect.GetBottom() + S(10.f);
    };
    if (onTrack(widthRect_)) return kHitWidth;
    if (onTrack(transparencyRect_)) return kHitTransparency;
    if (onTrack(edgeWidthRect_)) return kHitEdgeWidth;
    return kHitNone;
}

void AppearanceWindow::ApplyFromPoint(int x, int y) {
    if (drag_ == kHitWheel) {
        const double cx = wheelRect_.X + wheelRect_.Width * 0.5;
        const double cy = wheelRect_.Y + wheelRect_.Height * 0.5;
        const double radius = std::max(1.0, wheelRect_.Width * 0.5);
        const double dx = x - cx;
        const double dy = y - cy;
        const double distance = std::sqrt(dx * dx + dy * dy);
        double hue = std::atan2(dy, dx) * 180.0 / 3.14159265358979323846;
        if (hue < 0.0) hue += 360.0;
        hue_[active_] = hue;
        sat_[active_] = Clamp01(distance / radius);
        if (val_[active_] < 0.08) val_[active_] = 0.42;
    } else if (drag_ == kHitValue) {
        const double t = 1.0 - static_cast<double>(y - valueRect_.Y) / std::max(1, valueRect_.Height);
        val_[active_] = Clamp01(t);
    } else {
        const double t = Clamp01(static_cast<double>(x - widthRect_.X) / std::max(1, widthRect_.Width));
        switch (drag_) {
        case kHitWidth: state_.cellLineWidth = static_cast<float>(0.5 + 3.5*t); break;
        case kHitTransparency: state_.polyTransparency = static_cast<int>(std::lround(100*t)); break;
        case kHitEdgeWidth: state_.polyEdgeWidth = static_cast<float>(std::lround(40*t)) / 10.f; break;
        default: return;
        }
    }
    if (drag_ == kHitWheel || drag_ == kHitValue) ActiveColor() = HsvColor(hue_[active_], sat_[active_], val_[active_]);
    PushChange();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void AppearanceWindow::PushChange() {
    if (onChange_) onChange_(state_);
}

void AppearanceWindow::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        Painter painter(g, dpi_);
        Gdiplus::GraphicsPath outer;
        AddRoundedRectPath(outer, UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)),
                           S(14.0f));
        Gdiplus::LinearGradientBrush backgroundBrush(
            Gdiplus::Rect(0, 0, width, height), UiColor(255, 14, 20, 30), UiColor(255, 8, 12, 19),
            Gdiplus::LinearGradientModeVertical);
        g.FillPath(&backgroundBrush, &outer);
        Gdiplus::Pen border(UiColor(255, 46, 60, 82), S(1.0f));
        g.DrawPath(&border, &outer);

        painter.Text(T(Str::AppearanceTitle), UiRect(S(22.0f), S(16.0f), S(340.0f), S(24.0f)), S(17.0f),
                     kText, UiTextAlign::Left, UiTextVAlign::Middle, true);
        painter.Text(T(Str::AppearanceSubtitle), UiRect(S(24.0f), S(44.0f), S(360.0f), S(20.0f)),
                     S(9.5f), kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(L"×", Ui(closeXRect_), S(18.0f), kTextMuted, UiTextAlign::Center,
                     UiTextVAlign::Middle);

        if (wheel_) {
            g.DrawImage(wheel_.get(), wheelRect_);
        }
        Gdiplus::Pen wheelRing(UiColor(255, 54, 69, 93), S(1.2f));
        g.DrawEllipse(&wheelRing, wheelRect_.X, wheelRect_.Y, wheelRect_.Width - 1, wheelRect_.Height - 1);

        const double cx = wheelRect_.X + wheelRect_.Width * 0.5;
        const double cy = wheelRect_.Y + wheelRect_.Height * 0.5;
        const double radius = wheelRect_.Width * 0.5;
        const double markerR = Clamp01(sat_[active_]) * (radius - S(7.0f));
        const double markerX = cx + std::cos(hue_[active_] * 3.14159265358979323846 / 180.0) * markerR;
        const double markerY = cy + std::sin(hue_[active_] * 3.14159265358979323846 / 180.0) * markerR;
        const float markerSize = S(5.0f);
        const UiColor markerColor = Hex(HsvColor(hue_[active_], sat_[active_], val_[active_]));
        Gdiplus::SolidBrush markerBrush(markerColor);
        g.FillEllipse(&markerBrush, static_cast<float>(markerX - markerSize),
                      static_cast<float>(markerY - markerSize), markerSize * 2.0f, markerSize * 2.0f);
        Gdiplus::Pen markerPen(UiColor(255, 255, 255, 255), S(1.4f));
        g.DrawEllipse(&markerPen, static_cast<float>(markerX - markerSize - S(1.0f)),
                      static_cast<float>(markerY - markerSize - S(1.0f)), markerSize * 2.0f + S(2.0f),
                      markerSize * 2.0f + S(2.0f));

        // Brightness slider.
        double fullR = 0, fullG = 0, fullB = 0;
        HsvToRgb(hue_[active_], sat_[active_], 1.0, fullR, fullG, fullB);
        const UiColor fullColor = UiColor(255, static_cast<BYTE>(fullR * 255.0),
                                          static_cast<BYTE>(fullG * 255.0),
                                          static_cast<BYTE>(fullB * 255.0));
        Gdiplus::LinearGradientBrush valueBrush(
            Gdiplus::Rect(valueRect_.X, valueRect_.Y, valueRect_.Width, valueRect_.Height), fullColor,
            UiColor(255, 0, 0, 0), Gdiplus::LinearGradientModeVertical);
        Gdiplus::GraphicsPath valuePath;
        AddRoundedRectPath(valuePath, Ui(valueRect_), S(7.0f));
        g.FillPath(&valueBrush, &valuePath);
        Gdiplus::Pen valueBorder(UiColor(255, 55, 70, 94), S(1.0f));
        g.DrawPath(&valueBorder, &valuePath);
        const float valueY = valueRect_.Y + (1.0f - static_cast<float>(val_[active_])) * valueRect_.Height;
        painter.Line(static_cast<float>(valueRect_.X - S(3.0f)), valueY,
                     static_cast<float>(valueRect_.X + valueRect_.Width + S(3.0f)), valueY,
                     UiColor(255, 255, 255, 255), S(2.0f));

        painter.Text(T(Str::AppearanceBrightness), UiRect(S(24.0f), S(322.0f), S(250.0f), S(18.0f)),
                     S(9.0f), kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(HexText(ActiveColor()),
                     UiRect(valueRect_.X - S(8.0f), S(322.0f), S(120.0f), S(18.0f)), S(9.0f),
                     kTextSecondary, UiTextAlign::Left, UiTextVAlign::Middle, false, true);

        // Target swatches.
        const UiColor cellColor = Hex(state_.cellColor);
        const UiColor backgroundColor = Hex(state_.backgroundColor);
        auto drawSwatch = [&](int index, const Gdiplus::Rect& rect, UiColor color,
                              const std::wstring& label) {
            Gdiplus::GraphicsPath path;
            AddRoundedRectPath(path, Ui(rect), S(9.0f));
            Gdiplus::SolidBrush brush(color);
            g.FillPath(&brush, &path);
            const bool active = active_ == index;
            Gdiplus::Pen pen(active ? kAccentLight : UiColor(255, 58, 74, 98),
                             active ? S(2.0f) : S(1.0f));
            g.DrawPath(&pen, &path);
            const UiColor textColor = active ? kAccentLight : kTextMuted;
            painter.Text(label, UiRect(static_cast<float>(rect.X), static_cast<float>(rect.Y + rect.Height + 2),
                                       static_cast<float>(rect.Width), S(16.0f)),
                         S(8.5f), textColor, UiTextAlign::Left, UiTextVAlign::Middle);
        };
        drawSwatch(0, swatchRect_[0], cellColor, T(Str::CellColorLabel));
        drawSwatch(1, swatchRect_[1], backgroundColor, T(Str::BackgroundColorLabel));

        drawSwatch(2, swatchRect_[2], Hex(state_.polyEdgeColor), T(Str::PolyEdgeColor));

        auto slider = [&](const Gdiplus::Rect& rect, Str label, const wchar_t* value, float t) {
            const float labelY = rect.Y - S(22.f);
            painter.Text(T(label), UiRect(S(24.f), labelY, S(280.f), S(18.f)), S(9.5f),
                         kTextSecondary, UiTextAlign::Left, UiTextVAlign::Middle);
            painter.Text(value, UiRect(S(310.f), labelY, S(104.f), S(18.f)), S(9.5f),
                         kTextSecondary, UiTextAlign::Right, UiTextVAlign::Middle, false, true);
            painter.FillRoundRect(Ui(rect), S(4.f), UiColor(255, 24, 32, 47));
            const float filled = rect.Width * t;
            if (filled > 0)
                painter.FillRoundRect(UiRect(float(rect.X), float(rect.Y), filled, float(rect.Height)), S(4.f), kAccent);
            Gdiplus::SolidBrush handle(UiColor(255, 242, 247, 255));
            const float x = rect.X + filled, y = rect.Y + rect.Height*0.5f;
            g.FillEllipse(&handle, x-S(6.f), y-S(6.f), S(12.f), S(12.f));
        };
        wchar_t value[32]{};
        swprintf_s(value, L"%.2f", state_.cellLineWidth);
        slider(widthRect_, Str::CellWidthLabel, value, (state_.cellLineWidth-0.5f)/3.5f);
        swprintf_s(value, L"%d%%", state_.polyTransparency);
        slider(transparencyRect_, Str::PolyTransparency, value, state_.polyTransparency/100.f);
        swprintf_s(value, L"%.1f px", state_.polyEdgeWidth);
        slider(edgeWidthRect_, Str::PolyEdgeWidth, value, state_.polyEdgeWidth/4.f);

        // Buttons.
        auto button = [&](const Gdiplus::Rect& rect, const std::wstring& text, bool primary) {
            Gdiplus::GraphicsPath path;
            AddRoundedRectPath(path, Ui(rect), S(9.0f));
            painter.FillRoundRect(Ui(rect), S(9.0f),
                                  primary ? kAccent : UiColor(255, 24, 31, 45));
            const UiColor buttonBorder = primary ? kAccentLight : UiColor(255, 54, 68, 91);
            Gdiplus::Pen pen(buttonBorder, S(1.0f));
            g.DrawPath(&pen, &path);
            painter.Text(text, Ui(rect), S(10.5f), primary ? UiColor(255, 255, 255, 255) : kTextSecondary,
                         UiTextAlign::Center, UiTextVAlign::Middle, true);
        };
        button(resetRect_, T(Str::AppearanceReset), false);
        button(closeRect_, T(Str::DialogOK), true);
    });
}

LRESULT CALLBACK AppearanceWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    AppearanceWindow* self = reinterpret_cast<AppearanceWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<AppearanceWindow*>(create->lpCreateParams);
        self->hwnd_ = hwnd;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
    }
    if (!self) return DefWindowProcW(hwnd, message, wParam, lParam);
    return self->WndProc(message, wParam, lParam);
}

LRESULT AppearanceWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_LBUTTONDOWN: {
        SetFocus(hwnd_);
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        const int hit = HitTest(x, y);
        if (hit == kHitClose || hit == kHitCloseX) {
            Close();
            return 0;
        }
        if (hit == kHitReset) {
            SetState(AppearanceState{});
            PushChange();
            InvalidateRect(hwnd_, nullptr, FALSE);
            return 0;
        }
        if (hit == kHitSwatch0 || hit == kHitSwatch1 || hit == kHitOutlineColor) {
            active_ = hit == kHitOutlineColor ? 2 : hit - kHitSwatch0;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return 0;
        }
        if (hit != kHitNone) {
            drag_ = hit;
            lastX_ = x;
            lastY_ = y;
            SetCapture(hwnd_);
            ApplyFromPoint(x, y);
        }
        return 0;
    }
    case WM_MOUSEMOVE:
        if (drag_ != kHitNone) {
            const int x = GET_X_LPARAM(lParam);
            const int y = GET_Y_LPARAM(lParam);
            lastX_ = x;
            lastY_ = y;
            ApplyFromPoint(x, y);
        }
        return 0;
    case WM_LBUTTONUP:
        if (drag_ != kHitNone) {
            drag_ = kHitNone;
            if (GetCapture() == hwnd_) ReleaseCapture();
        }
        return 0;
    case WM_MOUSEWHEEL: {
        const int delta = GET_WHEEL_DELTA_WPARAM(wParam);
        val_[active_] = Clamp01(val_[active_] + (delta > 0 ? 0.05 : -0.05));
        ActiveColor() = HsvColor(hue_[active_], sat_[active_], val_[active_]);
        PushChange();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    }
    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) {
            Close();
            return 0;
        }
        break;
    case WM_CLOSE:
        Close();
        return 0;
    case WM_DESTROY:
        hwnd_ = nullptr;
        return 0;
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

} // namespace cl
