#include "Popups.h"

#include "Format.h"
#include "Icons.h"
#include "Localization.h"

#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <vector>

namespace cl {
namespace {

constexpr int kMenuTimer = 0;
constexpr int kToastTimer = 1;

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

void SetRoundRegion(HWND hwnd, int width, int height, float radius) {
    if (width <= 0 || height <= 0) return;
    const int r = std::max(2, static_cast<int>(std::lround(radius)));
    HRGN region = CreateRoundRectRgn(0, 0, width + 1, height + 1, r * 2, r * 2);
    SetWindowRgn(hwnd, region, TRUE);
}

RECT WorkAreaForWindow(HWND hwnd) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    HMONITOR monitor = MonitorFromWindow(hwnd ? hwnd : GetForegroundWindow(), MONITOR_DEFAULTTONEAREST);
    if (monitor && GetMonitorInfoW(monitor, &info)) return info.rcWork;
    RECT fallback{0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
    return fallback;
}

RECT OwnerScreenRect(HWND owner) {
    RECT rect{0, 0, 1280, 800};
    if (owner) GetWindowRect(owner, &rect);
    return rect;
}

bool PointInRect(const RECT& rect, int x, int y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

void DrawCloseGlyph(Gdiplus::Graphics& g, const UiRect& box, const UiColor& color) {
    Gdiplus::Pen pen(color, 1.6f);
    pen.SetLineCap(Gdiplus::LineCapRound, Gdiplus::LineCapRound, Gdiplus::DashCapRound);
    g.DrawLine(&pen, box.X + box.Width * 0.30f, box.Y + box.Height * 0.30f,
               box.X + box.Width * 0.70f, box.Y + box.Height * 0.70f);
    g.DrawLine(&pen, box.X + box.Width * 0.70f, box.Y + box.Height * 0.30f,
               box.X + box.Width * 0.30f, box.Y + box.Height * 0.70f);
}

void DrawKeyChip(Painter& painter, const UiRect& rect, const std::wstring& text, const UiColor& accent) {
    painter.FillRoundRect(rect, rect.Height * 0.35f, UiColor(255, 23, 31, 44));
    painter.StrokeRoundRect(rect, rect.Height * 0.35f, UiColor(255, 43, 54, 73), 1.0f);
    painter.Text(text, rect, rect.Height * 0.52f, accent, UiTextAlign::Center, UiTextVAlign::Middle, true, true);
}

} // namespace

// ---------------------------------------------------------------------------
// Menu popup
// ---------------------------------------------------------------------------

bool MenuPopup::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_DROPSHADOW | CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensMenu";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW, L"CrystalLensMenu", L"", WS_POPUP, 0, 0, 200, 200, owner,
                            nullptr, instance, this);
    return hwnd_ != nullptr;
}

MenuPopup::~MenuPopup() {
    if (hwnd_) {
        Close(false);
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

void MenuPopup::Show(const std::vector<MenuEntry>& entries, POINT screenPosition, float dpiScale) {
    if (!hwnd_ || entries.empty()) return;
    if (visible_) Close(false);
    entries_ = entries;
    dpi_ = std::max(0.75f, dpiScale);
    hovered_ = -1;
    padding_ = static_cast<int>(std::lround(6.0f * dpi_));
    itemHeight_ = static_cast<int>(std::lround(33.0f * dpi_));
    separatorHeight_ = static_cast<int>(std::lround(9.0f * dpi_));

    HDC screenDC = GetDC(nullptr);
    Gdiplus::Graphics measureGraphics(screenDC);
    Painter painter(measureGraphics, dpi_);
    const float labelSize = 12.0f * dpi_;
    const float shortcutSize = 8.8f * dpi_;
    float maxLabel = 0.0f;
    float maxShortcut = 0.0f;
    for (const MenuEntry& entry : entries_) {
        if (entry.separator) continue;
        maxLabel = std::max(maxLabel, painter.MeasureText(entry.label, labelSize));
        maxShortcut = std::max(maxShortcut, painter.MeasureText(entry.shortcut, shortcutSize, false, true));
    }
    ReleaseDC(nullptr, screenDC);

    const int minWidth = static_cast<int>(std::lround(236.0f * dpi_));
    const int maxWidth = static_cast<int>(std::lround(390.0f * dpi_));
    width_ = std::clamp(static_cast<int>(std::ceil(maxLabel + maxShortcut + 78.0f * dpi_)), minWidth, maxWidth);
    Layout();

    const RECT work = WorkAreaForWindow(owner_);
    int x = screenPosition.x;
    int y = screenPosition.y;
    if (x + width_ > work.right - 8) x = work.right - width_ - 8;
    if (x < work.left + 8) x = work.left + 8;
    if (y + height_ > work.bottom - 8) y = screenPosition.y - height_ - 2;
    if (y < work.top + 8) y = work.top + 8;

    SetWindowPos(hwnd_, HWND_TOP, x, y, width_, height_, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetRoundRegion(hwnd_, width_, height_, 10.0f * dpi_);
    visible_ = true;
    closing_ = false;
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    SetFocus(hwnd_);
    SetCapture(hwnd_);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MenuPopup::Layout() {
    itemRects_.assign(entries_.size(), RECT{});
    int y = padding_;
    for (size_t i = 0; i < entries_.size(); ++i) {
        const int h = entries_[i].separator ? separatorHeight_ : itemHeight_;
        itemRects_[i] = {padding_, y, width_ - padding_, y + h};
        y += h;
    }
    height_ = y + padding_;
}

void MenuPopup::Hide() { Close(true); }

void MenuPopup::Close(bool notify) {
    if (!visible_ || closing_) return;
    closing_ = true;
    if (GetCapture() == hwnd_) ReleaseCapture();
    ShowWindow(hwnd_, SW_HIDE);
    visible_ = false;
    if (notify && owner_) {
        PostMessageW(owner_, WM_CL_MENU_CLOSED, 0, 0);
        SetFocus(owner_);
    }
    closing_ = false;
}

int MenuPopup::HitTest(int x, int y) const {
    for (size_t i = 0; i < itemRects_.size(); ++i) {
        if (entries_[i].separator) continue;
        if (PointInRect(itemRects_[i], x, y)) return static_cast<int>(i);
    }
    return -1;
}

void MenuPopup::Execute(int index) {
    if (index < 0 || index >= static_cast<int>(entries_.size())) return;
    const MenuEntry& entry = entries_[index];
    if (entry.separator || !entry.enabled || entry.command == CmdNone) return;
    const int command = entry.command;
    HWND owner = owner_;
    Close(true);
    if (owner) PostMessageW(owner, WM_COMMAND, MAKEWPARAM(command, 1), 0);
}

void MenuPopup::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        Painter painter(g, dpi_);
        const float radius = 10.0f * dpi_;
        painter.FillRoundRect(UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)), radius,
                              UiColor(255, 19, 25, 37));
        painter.StrokeRoundRect(UiRect(0.5f, 0.5f, static_cast<float>(width) - 1.0f,
                                       static_cast<float>(height) - 1.0f),
                                radius, UiColor(255, 46, 58, 78), 1.0f);
        painter.FillRoundRect(UiRect(1.0f, 1.0f, static_cast<float>(width) - 2.0f, 18.0f * dpi_), radius,
                              UiColor(255, 24, 31, 45));

        const float labelSize = 12.0f * dpi_;
        const float shortcutSize = 8.8f * dpi_;
        for (size_t i = 0; i < entries_.size(); ++i) {
            const MenuEntry& entry = entries_[i];
            const RECT& rect = itemRects_[i];
            if (entry.separator) {
                const float y = (rect.top + rect.bottom) * 0.5f;
                painter.Divider(static_cast<float>(rect.left) + 10.0f * dpi_,
                                static_cast<float>(rect.right) - 10.0f * dpi_, y,
                                UiColor(255, 37, 47, 64));
                continue;
            }
            const bool hot = hovered_ == static_cast<int>(i) && entry.enabled;
            if (hot) {
                painter.FillRoundRect(UiRect(static_cast<float>(rect.left) + 2.0f * dpi_,
                                             static_cast<float>(rect.top) + 1.0f,
                                             static_cast<float>(rect.right - rect.left) - 4.0f * dpi_,
                                             static_cast<float>(rect.bottom - rect.top) - 2.0f),
                                      7.0f * dpi_, UiColor(255, 31, 42, 61));
            }
            if (entry.checked) {
                DrawIcon(g, Icon::Check,
                         UiRect(static_cast<float>(rect.left) + 10.0f * dpi_,
                                static_cast<float>(rect.top) + (rect.bottom - rect.top) * 0.5f - 8.0f * dpi_,
                                16.0f * dpi_, 16.0f * dpi_),
                         Theme::kAccent);
            }
            const UiColor textColor = entry.enabled ? UiColor(255, 228, 235, 246) : UiColor(255, 92, 104, 123);
            const float labelLeft = static_cast<float>(rect.left) + 36.0f * dpi_;
            painter.Text(entry.label,
                         UiRect(labelLeft, static_cast<float>(rect.top),
                                static_cast<float>(rect.right) - labelLeft - 72.0f * dpi_,
                                static_cast<float>(rect.bottom - rect.top)),
                         labelSize, textColor, UiTextAlign::Left, UiTextVAlign::Middle);
            if (!entry.shortcut.empty()) {
                painter.Text(entry.shortcut,
                             UiRect(static_cast<float>(rect.left), static_cast<float>(rect.top),
                                    static_cast<float>(rect.right - rect.left) - 11.0f * dpi_,
                                    static_cast<float>(rect.bottom - rect.top)),
                             shortcutSize, entry.enabled ? UiColor(255, 112, 127, 151) : UiColor(255, 80, 92, 112),
                             UiTextAlign::Right, UiTextVAlign::Middle, false, true);
            }
        }
    });
}

LRESULT CALLBACK MenuPopup::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    MenuPopup* self = reinterpret_cast<MenuPopup*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<MenuPopup*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT MenuPopup::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_MOUSEMOVE: {
        const int hit = HitTest(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        const int normalized = (hit >= 0 && entries_[hit].enabled) ? hit : -1;
        if (normalized != hovered_) {
            hovered_ = normalized;
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return 0;
    }
    case WM_LBUTTONDOWN: {
        const int hit = HitTest(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        if (hit >= 0) Execute(hit);
        else Close(true);
        return 0;
    }
    case WM_RBUTTONDOWN:
        Close(true);
        return 0;
    case WM_KEYDOWN: {
        if (wParam == VK_ESCAPE) {
            Close(true);
            return 0;
        }
        if (wParam == VK_RETURN || wParam == VK_SPACE) {
            if (hovered_ >= 0) Execute(hovered_);
            return 0;
        }
        if (wParam == VK_UP || wParam == VK_DOWN) {
            const int direction = wParam == VK_DOWN ? 1 : -1;
            int index = hovered_;
            for (int step = 0; step < static_cast<int>(entries_.size()); ++step) {
                index += direction;
                if (index < 0) index = static_cast<int>(entries_.size()) - 1;
                if (index >= static_cast<int>(entries_.size())) index = 0;
                if (!entries_[index].separator && entries_[index].enabled) {
                    hovered_ = index;
                    InvalidateRect(hwnd_, nullptr, FALSE);
                    break;
                }
            }
            return 0;
        }
        return 0;
    }
    case WM_KILLFOCUS:
        if (visible_ && !closing_) Close(true);
        return 0;
    case WM_TIMER:
        return 0;
    case WM_DESTROY:
        if (visible_) Close(false);
        return 0;
    case WM_NCDESTROY: {
        HWND handle = hwnd_;
        hwnd_ = nullptr;
        visible_ = false;
        return DefWindowProcW(handle, message, wParam, lParam);
    }
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

bool TooltipWindow::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensTooltip";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
                            L"CrystalLensTooltip", L"", WS_POPUP, 0, 0, 100, 30, owner, nullptr, instance, this);
    return hwnd_ != nullptr;
}

TooltipWindow::~TooltipWindow() {
    if (hwnd_) {
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

void TooltipWindow::Show(const std::wstring& text, int screenX, int screenY, float dpiScale) {
    if (!hwnd_ || text.empty()) return;
    text_ = text;
    dpi_ = std::max(0.75f, dpiScale);
    HDC screenDC = GetDC(nullptr);
    Gdiplus::Graphics measureGraphics(screenDC);
    Painter painter(measureGraphics, dpi_);
    const float fontSize = 10.5f * dpi_;
    const float textWidth = painter.MeasureText(text_, fontSize);
    width_ = static_cast<int>(std::ceil(textWidth + 20.0f * dpi_));
    height_ = static_cast<int>(std::ceil(fontSize + 13.0f * dpi_));
    ReleaseDC(nullptr, screenDC);
    RECT work = WorkAreaForWindow(owner_);
    int x = screenX + static_cast<int>(std::lround(14.0f * dpi_));
    int y = screenY + static_cast<int>(std::lround(20.0f * dpi_));
    if (x + width_ > work.right - 8) x = work.right - width_ - 8;
    if (y + height_ > work.bottom - 8) y = screenY - height_ - 10;
    if (x < work.left + 8) x = work.left + 8;
    if (y < work.top + 8) y = work.top + 8;
    SetWindowPos(hwnd_, HWND_TOPMOST, x, y, width_, height_, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetRoundRegion(hwnd_, width_, height_, 6.0f * dpi_);
    visible_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void TooltipWindow::Hide() {
    if (!visible_) return;
    ShowWindow(hwnd_, SW_HIDE);
    visible_ = false;
}

void TooltipWindow::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        Painter painter(g, dpi_);
        painter.FillRoundRect(UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)), 6.0f * dpi_,
                              UiColor(255, 15, 21, 31));
        painter.StrokeRoundRect(UiRect(0.5f, 0.5f, static_cast<float>(width) - 1.0f,
                                       static_cast<float>(height) - 1.0f),
                                6.0f * dpi_, UiColor(255, 48, 61, 83), 1.0f);
        painter.Text(text_, UiRect(10.0f * dpi_, 0, static_cast<float>(width) - 20.0f * dpi_,
                                   static_cast<float>(height)),
                     10.5f * dpi_, UiColor(255, 209, 219, 233), UiTextAlign::Left, UiTextVAlign::Middle);
    });
}

LRESULT CALLBACK TooltipWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    TooltipWindow* self = reinterpret_cast<TooltipWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<TooltipWindow*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT TooltipWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_NCHITTEST:
        return HTTRANSPARENT;
    case WM_NCDESTROY: {
        HWND handle = hwnd_;
        hwnd_ = nullptr;
        visible_ = false;
        return DefWindowProcW(handle, message, wParam, lParam);
    }
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

bool ToastWindow::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensToast";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, L"CrystalLensToast", L"",
                            WS_POPUP, 0, 0, 400, 100, owner, nullptr, instance, this);
    return hwnd_ != nullptr;
}

ToastWindow::~ToastWindow() {
    if (hwnd_) {
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

void ToastWindow::Show(const std::wstring& title, const std::wstring& message, ToastKind kind, float dpiScale) {
    if (!hwnd_) return;
    title_ = title;
    message_ = message;
    kind_ = kind;
    const UINT windowDpi = GetDpiForWindow(hwnd_);
    const float windowScale = windowDpi > 0 ? static_cast<float>(windowDpi) / 96.0f : 0.75f;
    dpi_ = std::max(0.75f, std::max(dpiScale, windowScale));
    RECT ownerRect = OwnerScreenRect(owner_);
    const int ownerWidth = ownerRect.right - ownerRect.left;
    const int minWidth = static_cast<int>(std::lround(340.0f * dpi_));
    const int maxWidth = std::max(minWidth, std::min(static_cast<int>(std::lround(620.0f * dpi_)),
                                                     ownerWidth - 80));

    Gdiplus::Bitmap measureBitmap(2, 2, PixelFormat32bppPARGB);
    Gdiplus::Graphics measureGraphics(&measureBitmap);
    Painter painter(measureGraphics, dpi_);
    const float titleSize = 12.0f * dpi_;
    const float messageSize = 10.5f * dpi_;
    const float titleWidth = painter.MeasureText(title_, titleSize, true);
    const float messageWidth = painter.MeasureText(message_, messageSize);
    int messageHeight = static_cast<int>(std::ceil(painter.MeasureTextHeight(
        message_, messageSize, static_cast<float>(maxWidth) - 74.0f * dpi_)));
    if (message.empty()) messageHeight = 0;
    else messageHeight = std::max(messageHeight, static_cast<int>(std::ceil(messageSize * 1.5f)));
    const int padding = static_cast<int>(std::lround(16.0f * dpi_));
    width_ = std::clamp(static_cast<int>(std::ceil(std::max(titleWidth, std::min(messageWidth, 500.0f * dpi_)) +
                                                     84.0f * dpi_)),
                        minWidth, maxWidth);
    const int titleHeight = static_cast<int>(std::ceil(titleSize + 8.0f * dpi_));
    height_ = padding * 2 + titleHeight +
              (messageHeight > 0 ? messageHeight + static_cast<int>(10.0f * dpi_) : 0);
    height_ = std::max(height_, static_cast<int>(std::lround(message.empty() ? 76.0f : 100.0f) * dpi_));
    SetWindowPos(hwnd_, HWND_TOPMOST, 0, 0, width_, height_, SWP_NOMOVE | SWP_NOACTIVATE);
    Reposition();

    SetWindowPos(hwnd_, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    SetRoundRegion(hwnd_, width_, height_, 11.0f * dpi_);
    SetTimer(hwnd_, kToastTimer, 4600, nullptr);
    visible_ = true;
    ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
    SetWindowPos(hwnd_, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void ToastWindow::Reposition() {
    RECT ownerRect = OwnerScreenRect(owner_);
    RECT work = WorkAreaForWindow(owner_);
    int x = ownerRect.left + ((ownerRect.right - ownerRect.left) - width_) / 2;
    int y = ownerRect.bottom - height_ - static_cast<int>(std::lround(64.0f * dpi_));
    x = std::clamp(x, static_cast<int>(work.left) + 10, static_cast<int>(work.right) - width_ - 10);
    y = std::clamp(y, static_cast<int>(work.top) + 10, static_cast<int>(work.bottom) - height_ - 10);
    SetWindowPos(hwnd_, HWND_TOPMOST, x, y, width_, height_, SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

void ToastWindow::Hide() {
    if (!visible_) return;
    KillTimer(hwnd_, kToastTimer);
    ShowWindow(hwnd_, SW_HIDE);
    visible_ = false;
}

void ToastWindow::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        Painter painter(g, dpi_);
        const float radius = 11.0f * dpi_;
        painter.FillRoundRect(UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)), radius,
                              UiColor(255, 16, 22, 33));
        painter.StrokeRoundRect(UiRect(0.5f, 0.5f, static_cast<float>(width) - 1.0f,
                                       static_cast<float>(height) - 1.0f),
                                radius, UiColor(255, 45, 57, 77), 1.0f);
        painter.FillRoundRect(UiRect(0, 0, 4.0f * dpi_, static_cast<float>(height)), 2.0f * dpi_,
                              kind_ == ToastKind::Error ? Theme::kRed
                              : kind_ == ToastKind::Success ? Theme::kGreen
                                                            : Theme::kAccent);
        const float iconX = 16.0f * dpi_;
        const float iconCenterY = 16.0f * dpi_ + 11.0f * dpi_;
        const UiColor tint = kind_ == ToastKind::Error ? Theme::kRed
                             : kind_ == ToastKind::Success ? Theme::kGreen
                                                           : Theme::kAccent;
        painter.FillRoundRect(UiRect(iconX, iconCenterY - 11.0f * dpi_, 22.0f * dpi_, 22.0f * dpi_),
                              11.0f * dpi_, UiColor(255, tint.GetR(), tint.GetG(), tint.GetB()));
        if (kind_ == ToastKind::Error) {
            painter.Text(L"!", UiRect(iconX, iconCenterY - 12.0f * dpi_, 22.0f * dpi_, 22.0f * dpi_),
                         14.0f * dpi_, UiColor(255, 255, 255, 255), UiTextAlign::Center,
                         UiTextVAlign::Middle, true);
        } else {
            DrawIcon(g, Icon::Check,
                     UiRect(iconX + 5.0f * dpi_, iconCenterY - 6.0f * dpi_, 12.0f * dpi_, 12.0f * dpi_),
                     UiColor(255, 255, 255, 255));
        }
        const float textX = 52.0f * dpi_;
        const float textWidth = static_cast<float>(width) - textX - 16.0f * dpi_;
        const float titleSize = 12.0f * dpi_;
        const float titleLine = titleSize + 5.0f * dpi_;
        painter.Text(title_, UiRect(textX, 15.0f * dpi_, textWidth, titleLine), titleSize,
                     UiColor(255, 236, 241, 249), UiTextAlign::Left, UiTextVAlign::Top, true);
        if (!message_.empty()) {
            painter.Text(message_, UiRect(textX, 15.0f * dpi_ + titleLine + 3.0f * dpi_, textWidth,
                                          static_cast<float>(height) - 15.0f * dpi_ - titleLine),
                         10.5f * dpi_, UiColor(255, 154, 167, 187), UiTextAlign::Left, UiTextVAlign::Top,
                         false, false, true, true);
        }
    });
}

LRESULT CALLBACK ToastWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    ToastWindow* self = reinterpret_cast<ToastWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<ToastWindow*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT ToastWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_TIMER:
        if (wParam == kToastTimer) Hide();
        return 0;
    case WM_LBUTTONDOWN:
        Hide();
        return 0;
    case WM_NCHITTEST:
        return HTCLIENT;
    case WM_NCDESTROY: {
        HWND handle = hwnd_;
        hwnd_ = nullptr;
        visible_ = false;
        return DefWindowProcW(handle, message, wParam, lParam);
    }
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Modal-style form with native edit fields
// ---------------------------------------------------------------------------

namespace {
constexpr UINT kFormAccepted = WM_APP + 41;
}

bool FormWindow::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensForm";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW, L"CrystalLensForm", L"", WS_POPUP, 0, 0, 620, 500, owner,
                            nullptr, instance, this);
    return hwnd_ != nullptr;
}

FormWindow::~FormWindow() {
    if (hwnd_) {
        Hide();
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

void FormWindow::Show(const std::wstring& title, const std::wstring& subtitle,
                      const std::vector<FormField>& fields, const std::wstring& okText,
                      const std::wstring& cancelText, AcceptCallback onAccept, float dpiScale) {
    if (!hwnd_ || visible_ || fields.empty()) return;
    title_ = title;
    subtitle_ = subtitle;
    okText_ = okText;
    cancelText_ = cancelText;
    fields_ = fields;
    accept_ = std::move(onAccept);
    error_.clear();
    activeField_ = -1;
    hoverOk_ = hoverCancel_ = hoverClose_ = false;
    dpi_ = std::max(0.75f, dpiScale);
    width_ = static_cast<int>(std::lround(620.0f * dpi_));
    height_ = static_cast<int>(std::lround((208.0f + 54.0f * static_cast<float>(fields_.size())) * dpi_));
    const RECT work = WorkAreaForWindow(owner_);
    const int availableW = std::max(320, static_cast<int>(work.right - work.left) - 40);
    const int availableH = std::max(320, static_cast<int>(work.bottom - work.top) - 40);
    if (width_ > availableW || height_ > availableH) {
        const float fit = std::min(static_cast<float>(availableW) / static_cast<float>(width_),
                                   static_cast<float>(availableH) / static_cast<float>(height_));
        dpi_ = std::max(0.75f, dpi_ * fit);
        width_ = static_cast<int>(std::lround(620.0f * dpi_));
        height_ = static_cast<int>(std::lround((208.0f + 54.0f * static_cast<float>(fields_.size())) * dpi_));
    }
    const RECT ownerRect = OwnerScreenRect(owner_);
    int x = ownerRect.left + (static_cast<int>(ownerRect.right - ownerRect.left) - width_) / 2;
    int y = ownerRect.top + (static_cast<int>(ownerRect.bottom - ownerRect.top) - height_) / 2;
    x = std::clamp(x, static_cast<int>(work.left) + 10, static_cast<int>(work.right) - width_ - 10);
    y = std::clamp(y, static_cast<int>(work.top) + 10, static_cast<int>(work.bottom) - height_ - 10);
    SetWindowTextW(hwnd_, title_.c_str());
    SetWindowPos(hwnd_, HWND_TOP, x, y, width_, height_, SWP_NOACTIVATE);
    SetRoundRegion(hwnd_, width_, height_, 16.0f * dpi_);
    Layout();
    CreateEditors();
    visible_ = true;
    if (owner_) EnableWindow(owner_, FALSE);
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    SetFocus(hwnd_);
    FocusField(0, true);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void FormWindow::Hide() {
    if (!visible_) return;
    visible_ = false;
    DestroyEditors();
    ShowWindow(hwnd_, SW_HIDE);
    accept_ = nullptr;
    fields_.clear();
    error_.clear();
    if (owner_ && IsWindow(owner_)) {
        EnableWindow(owner_, TRUE);
        SetForegroundWindow(owner_);
        SetFocus(owner_);
    }
}

void FormWindow::Layout() {
    const auto S = [&](float dip) { return static_cast<int>(std::lround(dip * dpi_)); };
    const int width = width_;
    const int startY = S(106.0f);
    fieldBoxes_.clear();
    fieldBoxes_.reserve(fields_.size());
    for (size_t i = 0; i < fields_.size(); ++i) {
        const int y = startY + static_cast<int>(i) * S(54.0f) + S(7.0f);
        fieldBoxes_.push_back(RECT{S(180.0f), y, width - S(30.0f), y + S(38.0f)});
    }
    closeRect_ = RECT{width - S(64.0f), S(18.0f), width - S(20.0f), S(62.0f)};
    const int buttonY = startY + static_cast<int>(fields_.size()) * S(54.0f) + S(8.0f) + S(38.0f);
    cancelRect_ = RECT{width - S(30.0f) - S(108.0f), buttonY, width - S(30.0f), buttonY + S(34.0f)};
    okRect_ = RECT{cancelRect_.left - S(10.0f) - S(108.0f), buttonY, cancelRect_.left - S(10.0f),
                   buttonY + S(34.0f)};
}

void FormWindow::CreateEditors() {
    HINSTANCE instance = GetModuleHandleW(nullptr);
    const auto S = [&](float dip) { return static_cast<int>(std::lround(dip * dpi_)); };
    font_ = CreateFontW(-std::lround(12.5f * dpi_), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                        DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
    editBrush_ = CreateSolidBrush(RGB(12, 17, 26));
    edits_.clear();
    edits_.reserve(fields_.size());
    for (size_t i = 0; i < fields_.size(); ++i) {
        const RECT& box = fieldBoxes_[i];
        HWND edit = CreateWindowExW(0, L"EDIT", fields_[i].value.c_str(),
                                    WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL | WS_TABSTOP, box.left + S(8.0f),
                                    box.top + S(4.0f), (box.right - box.left) - S(16.0f),
                                    (box.bottom - box.top) - S(8.0f), hwnd_,
                                    reinterpret_cast<HMENU>(static_cast<INT_PTR>(i + 1)), instance, nullptr);
        if (!edit) continue;
        SendMessageW(edit, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
        SendMessageW(edit, EM_SETLIMITTEXT, 512, 0);
        if (!oldEditProc_) {
            oldEditProc_ = reinterpret_cast<WNDPROC>(
                SetWindowLongPtrW(edit, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(EditSubclassProc)));
        } else {
            SetWindowLongPtrW(edit, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(EditSubclassProc));
        }
        edits_.push_back(edit);
    }
}

void FormWindow::DestroyEditors() {
    for (HWND edit : edits_) {
        if (edit && IsWindow(edit)) DestroyWindow(edit);
    }
    edits_.clear();
    if (font_) {
        DeleteObject(font_);
        font_ = nullptr;
    }
    if (editBrush_) {
        DeleteObject(editBrush_);
        editBrush_ = nullptr;
    }
    activeField_ = -1;
}

void FormWindow::FocusField(int index, bool selectAll) {
    if (edits_.empty()) return;
    const int count = static_cast<int>(edits_.size());
    if (index < 0) index = count - 1;
    if (index >= count) index = 0;
    activeField_ = index;
    SetFocus(edits_[static_cast<size_t>(index)]);
    if (selectAll) SendMessageW(edits_[static_cast<size_t>(index)], EM_SETSEL, 0, -1);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

std::vector<std::wstring> FormWindow::ReadValues() const {
    std::vector<std::wstring> values;
    values.reserve(edits_.size());
    for (HWND edit : edits_) {
        const int length = edit ? GetWindowTextLengthW(edit) : 0;
        std::vector<wchar_t> buffer(static_cast<size_t>(length) + 1, L'\0');
        if (length > 0) GetWindowTextW(edit, buffer.data(), length + 1);
        values.emplace_back(buffer.data(), static_cast<size_t>(length));
    }
    return values;
}

void FormWindow::Submit() {
    if (!accept_) {
        Hide();
        return;
    }
    const std::wstring error = accept_(ReadValues());
    if (!error.empty()) {
        SetError(error);
        return;
    }
    PostMessageW(hwnd_, kFormAccepted, 0, 0);
}

void FormWindow::RequestCancel() { PostMessageW(hwnd_, WM_CLOSE, 0, 0); }

void FormWindow::SetError(const std::wstring& text) {
    error_ = text;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void FormWindow::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        Painter painter(g, dpi_);
        const auto S = [&](float dip) { return static_cast<float>(std::lround(dip * dpi_)); };
        Gdiplus::GraphicsPath outer;
        AddRoundedRectPath(outer, UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)),
                           16.0f * dpi_);
        Gdiplus::LinearGradientBrush background(
            UiRect(0, 0, static_cast<float>(width), static_cast<float>(height)),
            UiColor(255, 15, 20, 30), UiColor(255, 9, 13, 20), Gdiplus::LinearGradientModeVertical);
        g.FillPath(&background, &outer);
        Gdiplus::Pen border(UiColor(255, 48, 60, 82), 1.0f);
        g.DrawPath(&border, &outer);
        painter.GlowEllipse(UiRect(-100.0f * dpi_, -120.0f * dpi_, 420.0f * dpi_, 360.0f * dpi_),
                            UiColor(19, 64, 122, 255), UiColor(0, 64, 122, 255));

        painter.Text(title_, UiRect(static_cast<float>(S(30.0f)), static_cast<float>(S(24.0f)),
                                    static_cast<float>(width - S(100.0f)), static_cast<float>(S(28.0f))),
                     S(18.0f), Theme::kText, UiTextAlign::Left, UiTextVAlign::Top, true);
        painter.Text(subtitle_, UiRect(static_cast<float>(S(30.0f)), static_cast<float>(S(56.0f)),
                                       static_cast<float>(width - S(60.0f)), static_cast<float>(S(30.0f))),
                     S(9.4f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Top, false, false, true,
                     true);
        painter.Divider(static_cast<float>(S(30.0f)), static_cast<float>(width - S(30.0f)),
                        static_cast<float>(S(88.0f)), UiColor(255, 40, 51, 69));

        if (hoverClose_) {
            painter.FillRoundRect(UiRect(static_cast<float>(closeRect_.left), static_cast<float>(closeRect_.top),
                                         static_cast<float>(closeRect_.right - closeRect_.left),
                                         static_cast<float>(closeRect_.bottom - closeRect_.top)),
                                  S(10.0f), UiColor(255, 31, 41, 58));
        }
        DrawCloseGlyph(g,
                       UiRect(static_cast<float>(closeRect_.left + S(12.0f)),
                              static_cast<float>(closeRect_.top + S(12.0f)), static_cast<float>(S(20.0f)),
                              static_cast<float>(S(20.0f))),
                       UiColor(255, 172, 184, 202));

        for (size_t i = 0; i < fields_.size(); ++i) {
            const RECT& box = fieldBoxes_[i];
            const int centerY = (box.top + box.bottom) / 2;
            painter.Text(fields_[i].label,
                         UiRect(static_cast<float>(S(30.0f)), static_cast<float>(centerY - S(10.0f)),
                                static_cast<float>(S(140.0f)), static_cast<float>(S(20.0f))),
                         S(10.2f), Theme::kTextSecondary, UiTextAlign::Left, UiTextVAlign::Middle);
            if (!fields_[i].hint.empty()) {
                painter.Text(fields_[i].hint,
                             UiRect(static_cast<float>(S(30.0f)), static_cast<float>(centerY + S(8.0f)),
                                    static_cast<float>(S(140.0f)), static_cast<float>(S(14.0f))),
                             S(8.2f), Theme::kTextFaint, UiTextAlign::Left, UiTextVAlign::Middle);
            }
            painter.FillRoundRect(UiRect(static_cast<float>(box.left), static_cast<float>(box.top),
                                         static_cast<float>(box.right - box.left),
                                         static_cast<float>(box.bottom - box.top)),
                                  S(8.0f), UiColor(255, 12, 17, 26));
            const bool active = static_cast<int>(i) == activeField_;
            painter.StrokeRoundRect(UiRect(static_cast<float>(box.left), static_cast<float>(box.top),
                                           static_cast<float>(box.right - box.left),
                                           static_cast<float>(box.bottom - box.top)),
                                    S(8.0f), active ? Theme::kAccent : UiColor(255, 38, 49, 67),
                                    active ? 1.6f : 1.0f);
        }

        const float errorY = S(106.0f) + static_cast<float>(fields_.size()) * S(54.0f) + S(8.0f);
        if (!error_.empty()) {
            painter.Text(error_,
                         UiRect(static_cast<float>(S(30.0f)), static_cast<float>(errorY),
                                static_cast<float>(width - S(60.0f)), static_cast<float>(S(30.0f))),
                         S(9.4f), Theme::kRed, UiTextAlign::Left, UiTextVAlign::Top, false, false, true,
                         true);
        }
        painter.Divider(static_cast<float>(S(30.0f)), static_cast<float>(width - S(30.0f)),
                        static_cast<float>(okRect_.top - S(14.0f)), UiColor(255, 36, 46, 62));

        auto drawButton = [&](const RECT& rect, const std::wstring& text, bool primary, bool hovered) {
            UiColor fill = primary ? (hovered ? Theme::kAccentLight : Theme::kAccent)
                                   : (hovered ? UiColor(255, 30, 39, 55) : UiColor(255, 22, 28, 40));
            painter.FillRoundRect(UiRect(static_cast<float>(rect.left), static_cast<float>(rect.top),
                                         static_cast<float>(rect.right - rect.left),
                                         static_cast<float>(rect.bottom - rect.top)),
                                  S(8.0f), fill);
            painter.StrokeRoundRect(UiRect(static_cast<float>(rect.left), static_cast<float>(rect.top),
                                           static_cast<float>(rect.right - rect.left),
                                           static_cast<float>(rect.bottom - rect.top)),
                                    S(8.0f), primary ? UiColor(80, 255, 255, 255) : UiColor(255, 43, 54, 73),
                                    1.0f);
            painter.Text(text,
                         UiRect(static_cast<float>(rect.left), static_cast<float>(rect.top),
                                static_cast<float>(rect.right - rect.left),
                                static_cast<float>(rect.bottom - rect.top)),
                         S(10.0f), primary ? UiColor(255, 255, 255, 255) : Theme::kTextSecondary,
                         UiTextAlign::Center, UiTextVAlign::Middle, true);
        };
        drawButton(okRect_, okText_, true, hoverOk_);
        drawButton(cancelRect_, cancelText_, false, hoverCancel_);
    });
}

LRESULT CALLBACK FormWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    FormWindow* self = reinterpret_cast<FormWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<FormWindow*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT CALLBACK FormWindow::EditSubclassProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    FormWindow* self =
        reinterpret_cast<FormWindow*>(GetWindowLongPtrW(GetParent(hwnd), GWLP_USERDATA));
    if (self) return self->HandleEdit(hwnd, message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT FormWindow::HandleEdit(HWND edit, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_KEYDOWN) {
        const bool ctrl = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
        if (ctrl && (wParam == 'A' || wParam == 'a')) {
            SendMessageW(edit, EM_SETSEL, 0, -1);
            return 0;
        }
        if (wParam == VK_TAB) {
            int index = 0;
            for (size_t i = 0; i < edits_.size(); ++i) {
                if (edits_[i] == edit) {
                    index = static_cast<int>(i);
                    break;
                }
            }
            const bool shift = (GetKeyState(VK_SHIFT) & 0x8000) != 0;
            FocusField(index + (shift ? -1 : 1), true);
            return 0;
        }
        if (wParam == VK_RETURN) {
            Submit();
            return 0;
        }
        if (wParam == VK_ESCAPE) {
            RequestCancel();
            return 0;
        }
    } else if (message == WM_CHAR) {
        if (wParam == VK_TAB || wParam == VK_RETURN || wParam == VK_ESCAPE) return 0;
    } else if (message == WM_GETDLGCODE) {
        return DLGC_WANTALLKEYS;
    }
    if (oldEditProc_) return CallWindowProcW(oldEditProc_, edit, message, wParam, lParam);
    return DefWindowProcW(edit, message, wParam, lParam);
}

LRESULT FormWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_CTLCOLOREDIT: {
        HDC dc = reinterpret_cast<HDC>(wParam);
        SetTextColor(dc, RGB(234, 240, 248));
        SetBkColor(dc, RGB(12, 17, 26));
        return reinterpret_cast<LRESULT>(editBrush_);
    }
    case WM_COMMAND: {
        const int id = LOWORD(wParam);
        const int code = HIWORD(wParam);
        if (id >= 1 && id <= static_cast<int>(fields_.size())) {
            if (code == EN_SETFOCUS) {
                activeField_ = id - 1;
                InvalidateRect(hwnd_, nullptr, FALSE);
            } else if (code == EN_KILLFOCUS) {
                if (activeField_ == id - 1) activeField_ = -1;
                InvalidateRect(hwnd_, nullptr, FALSE);
            } else if (code == EN_CHANGE && !error_.empty()) {
                error_.clear();
                InvalidateRect(hwnd_, nullptr, FALSE);
            }
        }
        return 0;
    }
    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) {
            RequestCancel();
            return 0;
        }
        if (wParam == VK_RETURN) {
            Submit();
            return 0;
        }
        if (wParam == VK_TAB) {
            const bool shift = (GetKeyState(VK_SHIFT) & 0x8000) != 0;
            FocusField(activeField_ + (shift ? -1 : 1), true);
            return 0;
        }
        return 0;
    case WM_LBUTTONDOWN: {
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        if (PointInRect(closeRect_, x, y)) {
            RequestCancel();
            return 0;
        }
        if (PointInRect(okRect_, x, y)) {
            Submit();
            return 0;
        }
        if (PointInRect(cancelRect_, x, y)) {
            RequestCancel();
            return 0;
        }
        for (size_t i = 0; i < fieldBoxes_.size(); ++i) {
            if (PointInRect(fieldBoxes_[i], x, y)) {
                FocusField(static_cast<int>(i), false);
                return 0;
            }
        }
        return 0;
    }
    case WM_MOUSEMOVE: {
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        const bool ok = PointInRect(okRect_, x, y);
        const bool cancel = PointInRect(cancelRect_, x, y);
        const bool close = PointInRect(closeRect_, x, y);
        if (ok != hoverOk_ || cancel != hoverCancel_ || close != hoverClose_) {
            hoverOk_ = ok;
            hoverCancel_ = cancel;
            hoverClose_ = close;
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return 0;
    }
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT) {
            POINT pt{};
            GetCursorPos(&pt);
            ScreenToClient(hwnd_, &pt);
            bool interactive = PointInRect(closeRect_, pt.x, pt.y) || PointInRect(okRect_, pt.x, pt.y) ||
                               PointInRect(cancelRect_, pt.x, pt.y);
            for (const RECT& box : fieldBoxes_) {
                interactive = interactive || PointInRect(box, pt.x, pt.y);
            }
            SetCursor(LoadCursorW(nullptr, interactive ? IDC_HAND : IDC_ARROW));
            return TRUE;
        }
        break;
    case WM_NCHITTEST: {
        LRESULT hit = DefWindowProcW(hwnd_, message, wParam, lParam);
        if (hit == HTCLIENT) {
            POINT pt{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            ScreenToClient(hwnd_, &pt);
            if (pt.y < static_cast<int>(std::lround(88.0f * dpi_)) && !PointInRect(closeRect_, pt.x, pt.y)) {
                return HTCAPTION;
            }
        }
        return hit;
    }
    case kFormAccepted:
        Hide();
        return 0;
    case WM_CLOSE:
        Hide();
        return 0;
    case WM_NCDESTROY:
        hwnd_ = nullptr;
        visible_ = false;
        return DefWindowProcW(hwnd_, message, wParam, lParam);
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

// ---------------------------------------------------------------------------
// Help / About
// ---------------------------------------------------------------------------

bool HelpWindow::Create(HWND owner) {
    owner_ = owner;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_DROPSHADOW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = L"CrystalLensHelp";
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
    hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW, L"CrystalLensHelp", L"", WS_POPUP, 0, 0, 760, 600, owner,
                            nullptr, instance, this);
    return hwnd_ != nullptr;
}

HelpWindow::~HelpWindow() {
    if (hwnd_) {
        if (visible_) Hide();
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

void HelpWindow::Show(float dpiScale) {
    if (!hwnd_) return;
    dpi_ = std::max(0.75f, dpiScale);
    RECT work = WorkAreaForWindow(owner_);
    const int baseWidth = static_cast<int>(std::lround(760.0f * dpi_));
    const int baseHeight = static_cast<int>(std::lround(600.0f * dpi_));
    const int availableW = std::max(300, static_cast<int>(work.right - work.left) - 30);
    const int availableH = std::max(300, static_cast<int>(work.bottom - work.top) - 30);
    const float scale = std::min({1.0f, static_cast<float>(availableW) / baseWidth,
                                  static_cast<float>(availableH) / baseHeight});
    const int actualW = std::max(1, static_cast<int>(std::lround(baseWidth * scale)));
    const int actualH = std::max(1, static_cast<int>(std::lround(baseHeight * scale)));
    RECT ownerRect = OwnerScreenRect(owner_);
    const int x = ownerRect.left + ((ownerRect.right - ownerRect.left) - actualW) / 2;
    const int y = ownerRect.top + ((ownerRect.bottom - ownerRect.top) - actualH) / 2;
    width_ = actualW;
    height_ = actualH;
    SetWindowPos(hwnd_, HWND_TOP, x, y, actualW, actualH, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetRoundRegion(hwnd_, actualW, actualH, 15.0f * dpi_ * scale);
    if (owner_) EnableWindow(owner_, FALSE);
    visible_ = true;
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    SetFocus(hwnd_);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void HelpWindow::Hide() {
    if (!visible_) return;
    ShowWindow(hwnd_, SW_HIDE);
    visible_ = false;
    if (owner_) {
        EnableWindow(owner_, TRUE);
        SetForegroundWindow(owner_);
        SetFocus(owner_);
    }
}

void HelpWindow::Reposition() {}

void HelpWindow::Paint() {
    PaintBuffered(hwnd_, [&](Gdiplus::Graphics& g, int width, int height) {
        const float baseW = 760.0f * dpi_;
        const float baseH = 600.0f * dpi_;
        const float scale = std::min(static_cast<float>(width) / baseW, static_cast<float>(height) / baseH);
        g.ScaleTransform(scale, scale);
        const float W = baseW;
        const float H = baseH;
        Painter painter(g, dpi_);

        Gdiplus::GraphicsPath outer;
        AddRoundedRectPath(outer, UiRect(0, 0, W, H), 15.0f * dpi_);
        Gdiplus::LinearGradientBrush background(UiRect(0, 0, W, H), UiColor(255, 14, 19, 28),
                                                UiColor(255, 9, 13, 20), Gdiplus::LinearGradientModeVertical);
        g.FillPath(&background, &outer);
        Gdiplus::Pen border(UiColor(255, 48, 60, 82), 1.0f);
        g.DrawPath(&border, &outer);

        painter.GlowEllipse(UiRect(-120.0f * dpi_, -150.0f * dpi_, 460.0f * dpi_, 430.0f * dpi_),
                            UiColor(21, 64, 122, 255), UiColor(0, 64, 122, 255));
        painter.GlowEllipse(UiRect(W - 330.0f * dpi_, H - 330.0f * dpi_, 380.0f * dpi_, 380.0f * dpi_),
                            UiColor(14, 30, 118, 95), UiColor(0, 30, 118, 95));

        const float pad = 32.0f * dpi_;
        DrawLogo(g, UiRect(pad, 28.0f * dpi_, 46.0f * dpi_, 46.0f * dpi_), true);
        painter.Text(T(Str::AppName), UiRect(pad + 58.0f * dpi_, 30.0f * dpi_, 300.0f * dpi_, 27.0f * dpi_),
                     21.0f * dpi_, UiColor(255, 238, 243, 250), UiTextAlign::Left, UiTextVAlign::Top, true);
        painter.Text(Fmt(T(Str::AboutVersionFmt), L"1.4.0"), UiRect(pad + 58.0f * dpi_, 58.0f * dpi_,
                                                                 360.0f * dpi_, 18.0f * dpi_),
                     9.5f * dpi_, UiColor(255, 128, 143, 167), UiTextAlign::Left, UiTextVAlign::Top);

        closeRect_.left = static_cast<LONG>(std::lround((W - 64.0f * dpi_) * scale));
        closeRect_.top = static_cast<LONG>(std::lround(18.0f * dpi_ * scale));
        closeRect_.right = static_cast<LONG>(std::lround((W - 20.0f * dpi_) * scale));
        closeRect_.bottom = static_cast<LONG>(std::lround(62.0f * dpi_ * scale));
        if (hoverClose_) {
            painter.FillRoundRect(UiRect(W - 64.0f * dpi_, 18.0f * dpi_, 44.0f * dpi_, 44.0f * dpi_),
                                  10.0f * dpi_, UiColor(255, 31, 41, 58));
        }
        DrawCloseGlyph(g, UiRect(W - 52.0f * dpi_, 30.0f * dpi_, 20.0f * dpi_, 20.0f * dpi_),
                       UiColor(255, 172, 184, 202));

        painter.Divider(pad, W - pad, 92.0f * dpi_, UiColor(255, 40, 51, 69));

        const float leftX = pad;
        const float leftW = 288.0f * dpi_;
        const float rightX = 350.0f * dpi_;
        const float rightW = W - rightX - pad;
        painter.Text(T(Str::AppTagline), UiRect(leftX, 108.0f * dpi_, leftW, 24.0f * dpi_), 12.0f * dpi_,
                     UiColor(255, 83, 211, 175), UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(T(Str::AboutDescription), UiRect(leftX, 140.0f * dpi_, leftW, 100.0f * dpi_), 10.5f * dpi_,
                     UiColor(255, 146, 159, 180), UiTextAlign::Left, UiTextVAlign::Top, false, false, true, false);

        const Str features[] = {Str::AboutFeature1, Str::AboutFeature2, Str::AboutFeature3, Str::AboutFeature4};
        float featureY = 254.0f * dpi_;
        for (Str feature : features) {
            painter.FillRoundRect(UiRect(leftX, featureY + 2.0f * dpi_, 16.0f * dpi_, 16.0f * dpi_),
                                  8.0f * dpi_, UiColor(255, 27, 43, 62));
            DrawIcon(g, Icon::Check, UiRect(leftX + 3.0f * dpi_, featureY + 5.0f * dpi_, 10.0f * dpi_,
                                            10.0f * dpi_),
                     Theme::kTeal);
            painter.Text(T(feature), UiRect(leftX + 26.0f * dpi_, featureY, leftW - 26.0f * dpi_, 22.0f * dpi_),
                         9.8f * dpi_, UiColor(255, 188, 199, 216), UiTextAlign::Left, UiTextVAlign::Middle);
            featureY += 27.0f * dpi_;
        }

        painter.Text(T(Str::AboutShortcuts), UiRect(rightX, 108.0f * dpi_, rightW, 24.0f * dpi_), 12.0f * dpi_,
                     UiColor(255, 234, 240, 249), UiTextAlign::Left, UiTextVAlign::Middle, true);
        painter.Divider(rightX, rightX + rightW, 136.0f * dpi_, UiColor(255, 38, 49, 66));

        struct Shortcut {
            const wchar_t* key;
            Str description;
        };
        const Shortcut shortcuts[] = {
            {L"Ctrl+O", Str::ShortcutOpen},        {L"Ctrl+R", Str::ShortcutReload},
            {L"Ctrl+S", Str::ShortcutSave},        {L"Ctrl+Shift+S", Str::ShortcutScreenshot},
            {L"Ctrl+Z", Str::ShortcutUndo},        {L"Ctrl+E", Str::ShortcutEdit},
            {L"F", Str::ShortcutFit},              {L"Home", Str::ShortcutReset},
            {L"D", Str::ShortcutDistance},         {L"A", Str::ShortcutAngle},
            {L"Esc", Str::ShortcutCancel},         {L"LMB", Str::ShortcutOrbit},
            {L"Wheel", Str::ShortcutZoom},         {L"MMB/RMB", Str::ShortcutPan},
        };
        float rowY = 146.0f * dpi_;
        const float rowH = 26.0f * dpi_;
        for (const Shortcut& shortcut : shortcuts) {
            const float chipWidth = std::max(68.0f * dpi_, painter.MeasureText(shortcut.key, 8.8f * dpi_,
                                                                                false, true) +
                                                                    18.0f * dpi_);
            DrawKeyChip(painter,
                        UiRect(rightX, rowY + 3.0f * dpi_, chipWidth, 21.0f * dpi_),
                        shortcut.key, UiColor(255, 156, 180, 218));
            painter.Text(T(shortcut.description),
                         UiRect(rightX + 132.0f * dpi_, rowY, rightW - 132.0f * dpi_, rowH), 10.0f * dpi_,
                         UiColor(255, 181, 193, 210), UiTextAlign::Left, UiTextVAlign::Middle);
            rowY += rowH;
        }

        painter.Divider(pad, W - pad, H - 48.0f * dpi_, UiColor(255, 36, 46, 62));
        painter.Text(T(Str::AboutFootnote), UiRect(pad, H - 40.0f * dpi_, W - pad * 2.0f, 18.0f * dpi_),
                     9.0f * dpi_, UiColor(255, 103, 116, 137), UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(Fmt(T(Str::AboutBuildFmt), Utf8ToWide(__DATE__).c_str()),
                     UiRect(pad, H - 40.0f * dpi_, W - pad * 2.0f, 18.0f * dpi_), 9.0f * dpi_,
                     UiColor(255, 82, 94, 113), UiTextAlign::Right, UiTextVAlign::Middle);
    });
}

LRESULT CALLBACK HelpWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    HelpWindow* self = reinterpret_cast<HelpWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<HelpWindow*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT HelpWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_PAINT:
        Paint();
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE || wParam == VK_F1) {
            Hide();
            return 0;
        }
        return 0;
    case WM_LBUTTONDOWN: {
        POINT pt{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
        if (PtInRect(&closeRect_, pt)) Hide();
        return 0;
    }
    case WM_MOUSEMOVE: {
        const bool hover = PtInRect(&closeRect_, POINT{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)}) != FALSE;
        if (hover != hoverClose_) {
            hoverClose_ = hover;
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return 0;
    }
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT) {
            POINT pt{};
            GetCursorPos(&pt);
            ScreenToClient(hwnd_, &pt);
            SetCursor(LoadCursorW(nullptr, PtInRect(&closeRect_, pt) ? IDC_HAND : IDC_ARROW));
            return TRUE;
        }
        break;
    case WM_CLOSE:
        Hide();
        return 0;
    case WM_DESTROY:
        if (visible_) {
            visible_ = false;
            if (owner_) EnableWindow(owner_, TRUE);
        }
        return 0;
    case WM_NCDESTROY: {
        HWND handle = hwnd_;
        hwnd_ = nullptr;
        visible_ = false;
        return DefWindowProcW(handle, message, wParam, lParam);
    }
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

} // namespace cl

