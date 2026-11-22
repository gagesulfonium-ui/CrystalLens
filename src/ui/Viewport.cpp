#include "Viewport.h"

#include "Commands.h"
#include "Format.h"
#include "Localization.h"
#include "core/PeriodicTable.h"
#include "render/Picking.h"

#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <shellapi.h>
#include <windowsx.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cwchar>
#include <limits>
#include <vector>

namespace cl {
namespace {

constexpr int kViewportTimer = 1;
const wchar_t* kViewportClass = L"CrystalLensViewport";

const Color kHudText = Color::Hex(0xEAF0F8);
const Color kHudDim = Color::Hex(0x9DABBF);
const Color kHudFaint = Color::Hex(0x718097);
const Color kHudAccent = Color::Hex(0x6392FF);
const Color kHudAccentLight = Color::Hex(0x8DB0FF);
const Color kHudTeal = Color::Hex(0x35D3AF);
const Color kHudGold = Color::Hex(0xFFC95B);
const Color kHudCyan = Color::Hex(0x5BCCFF);
const Color kHudRed = Color::Hex(0xFF6B7A);
const Color kHudPanel = Color::Hex(0x0B111B, 0.80f);
const Color kHudPanelSoft = Color::Hex(0x0A0F18, 0.58f);
const Color kHudBorder = Color::Hex(0x2A3549, 0.85f);

bool PointInRect(const RECT& rect, int x, int y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

bool RectOverlaps(const RECT& a, const RECT& b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

std::wstring ColorToText(const Element& element) {
    std::string symbol = element.symbol;
    std::wstring out;
    out.reserve(symbol.size());
    for (char c : symbol) out.push_back(static_cast<wchar_t>(c));
    return out;
}

Color LabelColorForElement(uint32_t color) {
    const float r = ((color >> 16) & 0xFF) / 255.0f;
    const float g = ((color >> 8) & 0xFF) / 255.0f;
    const float b = (color & 0xFF) / 255.0f;
    return Color(0.38f + 0.62f * r, 0.38f + 0.62f * g, 0.38f + 0.62f * b, 0.96f);
}

int GetPngEncoderClsid(CLSID* clsid) {
    UINT num = 0;
    UINT size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0) return -1;
    std::vector<BYTE> buffer(size);
    auto* codecs = reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
    Gdiplus::GetImageEncoders(num, size, codecs);
    for (UINT i = 0; i < num; ++i) {
        if (wcscmp(codecs[i].MimeType, L"image/png") == 0) {
            *clsid = codecs[i].Clsid;
            return static_cast<int>(i);
        }
    }
    return -1;
}

} // namespace

Viewport::Viewport(ViewportHost* host) : host_(host) {
    QueryPerformanceFrequency(&perfFrequency_);
}

Viewport::~Viewport() { Destroy(); }

bool Viewport::Create(HWND parent, int controlId, float dpiScale) {
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_OWNDC | CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpszClassName = kViewportClass;
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;

    dpiScale_ = std::max(0.5f, dpiScale);
    hwnd_ = CreateWindowExW(0, kViewportClass, L"", WS_CHILD | WS_CLIPSIBLINGS | WS_TABSTOP, 0, 0,
                            100, 100, parent, reinterpret_cast<HMENU>(static_cast<INT_PTR>(controlId)),
                            wc.hInstance, this);
    if (!hwnd_) return false;
    InitializeGraphics();
    DragAcceptFiles(hwnd_, TRUE);
    if (rendererReady_) SetTimer(hwnd_, kViewportTimer, 16, nullptr);
    ShowWindow(hwnd_, SW_SHOWNA);
    return true;
}

void Viewport::Destroy() {
    if (destroyed_) return;
    destroyed_ = true;
    if (hwnd_) {
        KillTimer(hwnd_, kViewportTimer);
        DragAcceptFiles(hwnd_, FALSE);
        ShutdownGraphics();
        DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
    host_ = nullptr;
}

bool Viewport::InitializeGraphics() {
    std::string error;
    if (!CreateGLContext(hwnd_, gl_, &error, 4)) {
        glFailed_ = true;
        rendererError_ = error.empty() ? "OpenGL 3.3 is unavailable" : error;
        return false;
    }
    if (!renderer_.Initialize(&gl_, &error)) {
        glFailed_ = true;
        rendererReady_ = false;
        rendererError_ = error.empty() ? "Renderer initialization failed" : error;
        return false;
    }
    if (!overlay_.Initialize(&gl_, &error)) {
        glFailed_ = true;
        rendererReady_ = false;
        rendererError_ = error.empty() ? "Overlay initialization failed" : error;
        return false;
    }
    rendererReady_ = true;
    glFailed_ = false;
    lastFpsSample_ = GetTickCount64();
    framesSinceSample_ = 0;
    QueryPerformanceFrequency(&perfFrequency_);
    QueryPerformanceCounter(&lastFrameCounter_);
    return true;
}

void Viewport::ShutdownGraphics() {
    if (gl_.hglrc && gl_.hdc) wglMakeCurrent(gl_.hdc, gl_.hglrc);
    overlay_.Shutdown();
    renderer_.Shutdown();
    DestroyGLContext(gl_);
    rendererReady_ = false;
}

void Viewport::SetDpi(float dpiScale) {
    dpiScale_ = std::max(0.5f, dpiScale);
    if (hwnd_) {
        UpdateWindowRegion();
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
}

void Viewport::UpdateWindowRegion() {
    if (!hwnd_) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    const int width = rc.right - rc.left;
    const int height = rc.bottom - rc.top;
    if (width <= 0 || height <= 0) return;
    const int radius = static_cast<int>(std::lround(11.0f * dpiScale_));
    HRGN region = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
    SetWindowRgn(hwnd_, region, TRUE);
}

float Viewport::Aspect() const {
    return height_ > 0 ? static_cast<float>(width_) / static_cast<float>(height_) : 1.6f;
}

Vec3 Viewport::AtomWorldPosition(int index) const {
    if (!structure_ || index < 0 || index >= static_cast<int>(structure_->atoms.size())) return {};
    const Atom& atom = structure_->atoms[static_cast<size_t>(index)];
    return atom.cart - structure_->center;
}

void Viewport::SetStructure(std::shared_ptr<const Structure> structure) {
    EndDrag();
    const MeasureMode previousMode = mode_;
    mode_ = MeasureMode::None;
    pendingPicks_.clear();
    measurements_.clear();
    selectedAtom_ = -1;
    hoveredAtom_ = -1;
    emptyButtonRectValid_ = false;
    emptyButtonHovered_ = false;
    structure_ = std::move(structure);
    if (rendererReady_) {
        renderer_.SetStructure(structure_.get());
        renderer_.SetOptions(options_);
        renderer_.SetHighlight({}, -1);
        renderer_.SetAnnotations({}, {});
    }
    userAdjustedCamera_ = false;
    if (structure_) {
        // The renderer draws every atom/cell/bond in structure-centered space,
        // so the camera must look at the origin, not at the absolute cell center.
        camera_.Reset(Vec3{}, structure_->boundRadius, Aspect());
        FitToStructure();
        pendingFit_ = true;
    } else {
        pendingFit_ = true;
    }
    if (host_) {
        host_->OnViewportSelectionChanged(-1);
        host_->OnViewportMeasurementsChanged();
        if (previousMode != MeasureMode::None) host_->OnViewportModeChanged(mode_);
        host_->OnViewportHoverChanged(-1);
    }
    InvalidateView();
}

void Viewport::RefreshStructure(bool preserveCamera, int selectIndex) {
    if (!structure_) return;
    EndDrag();
    const MeasureMode previousMode = mode_;
    mode_ = MeasureMode::None;
    pendingPicks_.clear();
    measurements_.clear();
    selectedAtom_ = -1;
    hoveredAtom_ = -1;
    if (preserveCamera) {
        // Rendered geometry is always centered on the origin, so a panned or
        // orbited camera remains valid after an edit.
        userAdjustedCamera_ = true;
    }
    if (rendererReady_) {
        renderer_.SetStructure(structure_.get());
        renderer_.SetOptions(options_);
        renderer_.SetAnnotations({}, {});
    }
    if (!preserveCamera) {
        camera_.Reset(Vec3{}, structure_->boundRadius, Aspect());
        FitToStructure();
        pendingFit_ = true;
        userAdjustedCamera_ = false;
    }
    if (selectIndex >= 0 && selectIndex < static_cast<int>(structure_->atoms.size())) {
        selectedAtom_ = selectIndex;
    }
    UpdateHighlight();
    if (host_) {
        host_->OnViewportSelectionChanged(selectedAtom_);
        host_->OnViewportMeasurementsChanged();
        if (previousMode != MeasureMode::None) host_->OnViewportModeChanged(mode_);
        host_->OnViewportHoverChanged(-1);
    }
    InvalidateView();
}

void Viewport::SelectAtom(int index) {
    if (!structure_ || index < 0 || index >= static_cast<int>(structure_->atoms.size())) {
        selectedAtom_ = -1;
    } else {
        selectedAtom_ = index;
    }
    UpdateHighlight();
    NotifySelection();
    InvalidateView();
}

void Viewport::SetOptions(const RenderOptions& options) {
    const bool boundaryChanged = options_.showImages != options.showImages ||
                                 options_.exteriorPercent != options.exteriorPercent ||
                                 options_.style != options.style ||
                                 options_.supercellX != options.supercellX ||
                                 options_.supercellY != options.supercellY ||
                                 options_.supercellZ != options.supercellZ;
    options_ = options;
    if (rendererReady_) {
        renderer_.SetOptions(options_);
        renderer_.SetAnnotations(measurements_, pendingPicks_);
        UpdateHighlight();
        if (boundaryChanged && structure_) {
            FitToStructure();
            pendingFit_ = false;
        }
    }
    InvalidateView();
}

void Viewport::SetAppearance(const AppearanceState& state) {
    static_cast<AppearanceState&>(options_) = state;
    if (rendererReady_) renderer_.SetAppearance(state);
    InvalidateView();
}

void Viewport::SetOrthographic(bool orthographic) {
    camera_.SetProjection(orthographic);
    InvalidateView();
}

void Viewport::ToggleProjection() { SetOrthographic(!camera_.orthographic); }

void Viewport::SetModeInternal(MeasureMode mode, bool notify) {
    if (mode_ == mode) return;
    mode_ = mode;
    pendingPicks_.clear();
    UpdateAnnotations();
    UpdateHighlight();
    if (host_) {
        if (notify) host_->OnViewportModeChanged(mode_);
        host_->OnViewportMeasurementsChanged();
    }
    InvalidateView();
}

void Viewport::SetMeasureMode(MeasureMode mode) { SetModeInternal(mode, true); }

void Viewport::CancelMeasure() { SetModeInternal(MeasureMode::None, true); }

void Viewport::ClearMeasurements() {
    if (measurements_.empty() && pendingPicks_.empty()) return;
    measurements_.clear();
    pendingPicks_.clear();
    UpdateAnnotations();
    UpdateHighlight();
    NotifyMeasurements();
    InvalidateView();
}

void Viewport::RemoveMeasurement(int index) {
    if (index < 0 || index >= static_cast<int>(measurements_.size())) return;
    measurements_.erase(measurements_.begin() + index);
    UpdateAnnotations();
    NotifyMeasurements();
    InvalidateView();
}

void Viewport::UpdateLeftDrag(int x, int y) {
    const int dx = x - dragStartX_, dy = y - dragStartY_;
    if (!movedDuringDrag_ && std::hypot(dx, dy) <= 3.0 * dpiScale_) return;
    movedDuringDrag_ = true;
    userAdjustedCamera_ = true;
    if (dragMode_ == DragMode::Zoom) {
        camera_ = dragCamera_;
        camera_.ZoomAt(-12.0 * dy / std::max(1, height_), dragStartX_, dragStartY_, width_, height_);
    } else {
        const double scale = fineRotation_ ? 0.25 : 1.0;
        camera_.OrbitFromDrag(dragCamera_, dx * scale, dy * scale, width_, height_);
    }
    InvalidateView();
}

void Viewport::EndDrag() {
    if (dragMode_ == DragMode::None) return;
    dragMode_ = DragMode::None;
    dragButton_ = 0;
    if (GetCapture() == hwnd_) ReleaseCapture();
    SetCursorForState();
}

void Viewport::FitToStructure() {
    if (!structure_) return;
    EndDrag();
    std::vector<Vec3> points;
    if (rendererReady_) renderer_.GetVisiblePoints(points);
    if (points.empty()) {
        if (structure_->cell.valid) {
            for (const Vec3& corner : structure_->cell.Corners()) points.push_back(corner - structure_->center);
        }
        for (const Atom& atom : structure_->atoms) points.push_back(atom.cart - structure_->center);
    }
    camera_.FitScenePoints(points, Aspect(), 1.18);
    pendingFit_ = false;
}

void Viewport::ResetView() {
    if (!structure_) return;
    EndDrag();
    userAdjustedCamera_ = false;
    camera_.Reset(Vec3{}, structure_->boundRadius, Aspect());
    FitToStructure();
    InvalidateView();
}

void Viewport::FitView() {
    if (!structure_) return;
    userAdjustedCamera_ = false;
    FitToStructure();
    InvalidateView();
}

void Viewport::InvalidateView() {
    if (hwnd_) InvalidateRect(hwnd_, nullptr, FALSE);
}

void Viewport::NotifySelection() {
    if (host_) host_->OnViewportSelectionChanged(selectedAtom_);
}

void Viewport::NotifyMeasurements() {
    if (host_) host_->OnViewportMeasurementsChanged();
}

void Viewport::UpdateHighlight() {
    std::vector<int> selected;
    if (!pendingPicks_.empty()) {
        selected = pendingPicks_;
    } else if (selectedAtom_ >= 0) {
        selected.push_back(selectedAtom_);
    }
    if (rendererReady_) renderer_.SetHighlight(selected, hoveredAtom_);
}

void Viewport::UpdateAnnotations() {
    if (rendererReady_) renderer_.SetAnnotations(measurements_, pendingPicks_);
}

int Viewport::PickAtom(int x, int y) const {
    if (!structure_ || width_ <= 0 || height_ <= 0) return -1;
    return cl::PickAtom(*structure_, camera_, width_, height_, x, y, renderer_.SiteRadii());
}

void Viewport::HandleLeftClick(int x, int y) {
    if (!structure_) return;
    const int atom = PickAtom(x, y);
    if (atom < 0) {
        if (mode_ == MeasureMode::None && selectedAtom_ >= 0) {
            selectedAtom_ = -1;
            UpdateHighlight();
            NotifySelection();
            InvalidateView();
        }
        return;
    }
    selectedAtom_ = atom;
    NotifySelection();
    if (mode_ == MeasureMode::None) {
        UpdateHighlight();
        InvalidateView();
        return;
    }
    if (std::find(pendingPicks_.begin(), pendingPicks_.end(), atom) != pendingPicks_.end()) {
        return;
    }
    pendingPicks_.push_back(atom);
    UpdateHighlight();
    UpdateAnnotations();
    InvalidateView();

    const int required = RequiredPicks();
    if (static_cast<int>(pendingPicks_.size()) >= required) {
        Measurement measurement;
        bool valid = false;
        if (mode_ == MeasureMode::Distance && pendingPicks_.size() >= 2) {
            measurement = MakeDistanceMeasurement(*structure_, pendingPicks_[0], pendingPicks_[1]);
            valid = measurement.value > 0.0;
        } else if (mode_ == MeasureMode::Angle && pendingPicks_.size() >= 3) {
            double degrees = 0.0;
            if (MeasureAngle(*structure_, pendingPicks_[0], pendingPicks_[1], pendingPicks_[2], degrees)) {
                measurement = MakeAngleMeasurement(*structure_, pendingPicks_[0], pendingPicks_[1], pendingPicks_[2]);
                valid = true;
            }
        }
        if (valid) {
            measurements_.push_back(measurement);
            Flash(L"✓  " + MeasurementExpression(*structure_, measurement) + L"    " +
                  MeasurementValueText(measurement));
        }
        pendingPicks_.clear();
        UpdateHighlight();
        UpdateAnnotations();
        NotifyMeasurements();
        InvalidateView();
    }
}

void Viewport::Flash(const std::wstring& text) {
    flashText_ = text;
    flashUntil_ = GetTickCount64() + 2400;
}

void Viewport::SetCursorForState() {
    if (!hwnd_) return;
    LPCWSTR id = IDC_ARROW;
    if (dragMode_ != DragMode::None) {
        id = IDC_SIZEALL;
    } else if (mode_ != MeasureMode::None && structure_) {
        id = IDC_CROSS;
    } else if (!structure_ && emptyButtonHovered_) {
        id = IDC_HAND;
    } else if (structure_ && hoveredAtom_ >= 0) {
        id = IDC_HAND;
    }
    SetCursor(LoadCursorW(nullptr, id));
}

void Viewport::UpdateHover(int x, int y) {
    if (!hwnd_) return;
    if (!structure_) {
        const bool hover = emptyButtonRectValid_ && PointInRect(emptyButtonRect_, x, y);
        if (hover != emptyButtonHovered_) {
            emptyButtonHovered_ = hover;
            InvalidateView();
        }
        SetCursorForState();
        return;
    }
    const int atom = PickAtom(x, y);
    if (atom != hoveredAtom_) {
        hoveredAtom_ = atom;
        UpdateHighlight();
        if (host_) host_->OnViewportHoverChanged(atom);
        InvalidateView();
    }
    SetCursorForState();
}

void Viewport::RenderFrame(bool swapBuffers) {
    if (!rendererReady_ || !gl_.valid || width_ <= 0 || height_ <= 0) return;
    if (pendingFit_ && structure_ && !userAdjustedCamera_) FitToStructure();
    if (!wglMakeCurrent(gl_.hdc, gl_.hglrc)) return;
    glViewport(0, 0, width_, height_);
    renderer_.Draw(camera_, width_, height_);
    overlay_.Begin(width_, height_, dpiScale_);
    DrawHud();
    overlay_.End();
    if (swapBuffers) SwapBuffers(gl_.hdc);

    const ULONGLONG now = GetTickCount64();
    ++framesSinceSample_;
    if (lastFpsSample_ == 0) lastFpsSample_ = now;
    if (now - lastFpsSample_ >= 500) {
        const double elapsed = static_cast<double>(now - lastFpsSample_) / 1000.0;
        fps_ = static_cast<double>(framesSinceSample_) / std::max(0.001, elapsed);
        framesSinceSample_ = 0;
        lastFpsSample_ = now;
    }
    QueryPerformanceCounter(&lastFrameCounter_);
}

void Viewport::DrawHud() {
    if (!structure_) {
        DrawEmptyState();
    } else {
        DrawStructureHud();
    }
}

std::wstring Viewport::Ellipsize(const std::wstring& text, float pixelSize, bool bold, float maxWidth) {
    if (text.empty() || overlay_.MeasureText(text, pixelSize, bold) <= maxWidth) return text;
    const std::wstring suffix = L"…";
    size_t count = text.size();
    while (count > 0) {
        --count;
        std::wstring candidate = text.substr(0, count) + suffix;
        if (overlay_.MeasureText(candidate, pixelSize, bold) <= maxWidth) return candidate;
    }
    return suffix;
}

void Viewport::DrawEmptyState() {
    const float w = static_cast<float>(width_);
    const float h = static_cast<float>(height_);
    const auto S = [&](float value) { return value * dpiScale_; };

    const float cx = w * 0.5f;
    const float cy = h * 0.5f - S(22.0f);
    const float radius = std::clamp(std::min(w, h) * 0.075f, S(38.0f), S(58.0f));

    for (int i = 5; i >= 1; --i) {
        const float rr = radius * (1.4f + i * 0.34f);
        overlay_.Circle(cx, cy - radius * 0.35f, rr, Color::Hex(0x355CFF, 0.012f * static_cast<float>(6 - i)));
    }

    const float angles[6] = {-90.0f, -30.0f, 30.0f, 90.0f, 150.0f, 210.0f};
    float px[6]{};
    float py[6]{};
    for (int i = 0; i < 6; ++i) {
        const float rad = angles[i] * 3.14159265f / 180.0f;
        px[i] = cx + std::cos(rad) * radius;
        py[i] = cy - radius * 0.35f + std::sin(rad) * radius * 0.95f;
    }
    for (int i = 0; i < 6; ++i) {
        const int j = (i + 1) % 6;
        overlay_.Line(px[i], py[i], px[j], py[j], S(1.8f),
                      i % 2 == 0 ? Color::Hex(0x6F9BFF, 0.85f) : Color::Hex(0x35D3AF, 0.70f));
        if (i % 2 == 0) overlay_.Line(px[i], py[i], cx, cy - radius * 0.35f, S(1.0f), Color::Hex(0x7FA8FF, 0.20f));
    }
    overlay_.Line(px[0], py[0], cx, cy - radius * 0.35f, S(1.2f), Color::Hex(0xD9E4FF, 0.52f));
    overlay_.Line(cx, cy - radius * 0.35f, px[3], py[3], S(1.2f), Color::Hex(0x77A9FF, 0.35f));
    for (int i = 0; i < 6; ++i) {
        overlay_.Circle(px[i], py[i], S(2.4f), i % 2 == 0 ? Color::Hex(0x8DB0FF, 0.95f) : Color::Hex(0x35D3AF, 0.9f), 24);
    }
    overlay_.Ring(cx, cy - radius * 0.35f, radius * 0.24f, S(1.0f), Color::Hex(0x91B4FF, 0.35f), 32);

    std::wstring title = T(Str::EmptyTitle);
    float titleSize = S(21.0f);
    const float maxTitleWidth = w - S(80.0f);
    if (overlay_.MeasureText(title, titleSize, true) > maxTitleWidth) titleSize = S(17.0f);
    if (overlay_.MeasureText(title, titleSize, true) > maxTitleWidth) {
        title = Ellipsize(title, titleSize, true, maxTitleWidth);
    }
    const float titleY = cy + radius * 0.65f + S(54.0f);
    overlay_.Text(title, cx, titleY, titleSize, kHudText, TextAlign::Center, TextVAlign::Middle, true);

    overlay_.Text(T(Str::EmptySubtitle), cx, titleY + S(33.0f), S(12.0f), kHudDim, TextAlign::Center,
                  TextVAlign::Middle);

    const std::wstring buttonText = T(Str::Library);
    const float buttonWidth = std::max(S(198.0f), overlay_.MeasureText(buttonText, S(12.5f), true) + S(58.0f));
    const float buttonHeight = S(44.0f);
    const float buttonX = cx - buttonWidth * 0.5f;
    const float buttonY = titleY + S(66.0f);
    emptyButtonRect_.left = static_cast<LONG>(std::lround(buttonX));
    emptyButtonRect_.top = static_cast<LONG>(std::lround(buttonY));
    emptyButtonRect_.right = static_cast<LONG>(std::lround(buttonX + buttonWidth));
    emptyButtonRect_.bottom = static_cast<LONG>(std::lround(buttonY + buttonHeight));
    emptyButtonRectValid_ = true;

    POINT cursor{};
    GetCursorPos(&cursor);
    ScreenToClient(hwnd_, &cursor);
    emptyButtonHovered_ = PointInRect(emptyButtonRect_, cursor.x, cursor.y);
    const Color buttonFill = emptyButtonHovered_ ? Color::Hex(0x7CA3FF, 0.98f) : Color::Hex(0x5B8CFF, 0.94f);
    overlay_.FillRoundedRect(buttonX, buttonY, buttonWidth, buttonHeight, S(12.0f), buttonFill);
    overlay_.FillRoundedRect(buttonX, buttonY, buttonWidth, buttonHeight * 0.48f, S(12.0f),
                             Color::Hex(0xFFFFFF, 0.06f));
    overlay_.Line(buttonX + S(18), buttonY + buttonHeight, buttonX + buttonWidth - S(18),
                  buttonY + buttonHeight, S(1.0f), Color::Hex(0x9CB8FF, 0.35f));
    overlay_.Text(buttonText, cx, buttonY + buttonHeight * 0.5f, S(12.5f), Color::Hex(0xFFFFFF, 0.98f),
                  TextAlign::Center, TextVAlign::Middle, true);

    overlay_.Text(T(Str::SupportedFormats), cx, buttonY + buttonHeight + S(27.0f), S(9.5f), kHudFaint,
                  TextAlign::Center, TextVAlign::Middle);
    overlay_.Text(T(Str::EmptyFootnote), cx, h - S(20.0f), S(9.5f), Color::Hex(0x596981, 0.9f),
                  TextAlign::Center, TextVAlign::Middle);
}

void Viewport::DrawElementLegend() {
    if (!structure_ || structure_->atoms.empty()) return;
    const float w = static_cast<float>(width_);
    const auto S = [&](float value) { return value * dpiScale_; };
    if (w < S(560.0f)) return;
    const auto& radii = renderer_.SiteRadii();
    std::vector<int> elements;
    for (size_t i = 0; i < radii.size(); ++i) {
        if (radii[i] <= 0) continue;
        const Atom& atom = structure_->atoms[i];
        if (std::find(elements.begin(), elements.end(), atom.atomicNumber) == elements.end()) {
            elements.push_back(atom.atomicNumber);
        }
        if (elements.size() >= 8) break;
    }
    std::sort(elements.begin(), elements.end(), [](int a, int b) {
        return std::string(ElementByZ(a).symbol) < std::string(ElementByZ(b).symbol);
    });
    if (elements.empty()) return;

    const float rowH = S(20.0f);
    const float panelW = S(50.0f);
    const float panelX = w - S(18.0f) - panelW;
    const float panelY = S(54.0f);
    for (size_t i = 0; i < elements.size(); ++i) {
        const Element& element = ElementByZ(elements[i]);
        const Color color = Color::Hex(options_.elementStyles[element.z].Color(element), 0.90f);
        const float cy = panelY + rowH * static_cast<float>(i) + rowH * 0.5f;
        overlay_.Circle(panelX + S(6.0f), cy, S(4.2f), color, 20);
        overlay_.Text(Utf8ToWide(element.symbol), panelX + panelW, cy, S(9.2f), kHudDim, TextAlign::Right,
                      TextVAlign::Middle);
    }
}

void Viewport::DrawStructureHud() {
    const float w = static_cast<float>(width_);
    const float h = static_cast<float>(height_);
    const auto S = [&](float value) { return value * dpiScale_; };
    const bool compact = w < S(700.0f);

    std::wstring title = Utf8ToWide(structure_->title);
    if (title.empty()) title = FormatFileStem(Utf8ToWide(structure_->sourcePathUtf8));
    if (title.empty()) title = T(Str::AppName);
    const int visibleAtoms =
        rendererReady_ ? renderer_.AtomCount() : static_cast<int>(structure_->atoms.size());
    const int visibleBonds =
        rendererReady_ ? renderer_.BondCount() : static_cast<int>(structure_->bonds.size());
    std::wstring suffix = std::wstring(L"   ·   ") + FormatDisplayName(structure_->format) + L"   ·   " +
                          std::to_wstring(visibleAtoms) + L" " + T(Str::AtomsCount);
    if (visibleBonds > 0 && renderer_.PolyhedronTriangleCount() == 0) {
        suffix += L"   " + std::to_wstring(visibleBonds) + L" " + T(Str::BondsCount);
    }
    if (compact) {
        suffix = std::wstring(L"   ·   ") + FormatDisplayName(structure_->format);
    }
    if (rendererReady_ && options_.style == AtomStyle::Polyhedral && renderer_.PolyhedronTriangleCount() == 0) {
        suffix += std::wstring(L"  ·  ") + T(Str::NoCoordinationHull);
    }
    if (rendererReady_ && renderer_.SupercellLimited()) suffix += std::wstring(L"  ·  ") + T(Str::SupercellLimited);
    else if (rendererReady_ && renderer_.BoundaryLimited()) suffix += std::wstring(L"  ·  ") + T(Str::BoundaryLimited);
    const float titleSize = S(12.5f);
    const float suffixSize = S(10.0f);
    const float maxWidth = std::min(w * 0.60f, S(580.0f));
    const float availableTitle = std::max(S(60.0f), maxWidth - S(110.0f) - overlay_.MeasureText(suffix, suffixSize));
    title = Ellipsize(title, titleSize, true, availableTitle);
    float panelWidth = S(36.0f) + overlay_.MeasureText(title, titleSize, true) + overlay_.MeasureText(suffix, suffixSize);
    panelWidth = std::min(panelWidth, maxWidth);
    const float topY = S(14.0f);
    const float panelH = S(34.0f);
    overlay_.Panel(S(16.0f), topY, panelWidth, panelH, S(10.0f), kHudPanel, kHudBorder, S(1.0f));
    overlay_.Circle(S(31.0f), topY + panelH * 0.5f, S(3.2f), kHudAccentLight, 24);
    overlay_.Ring(S(31.0f), topY + panelH * 0.5f, S(5.5f), S(0.8f), Color::Hex(0x6392FF, 0.35f), 24);
    overlay_.Text(title, S(43.0f), topY + panelH * 0.5f, titleSize, kHudText, TextAlign::Left,
                  TextVAlign::Middle, true);
    const float suffixX = S(43.0f) + overlay_.MeasureText(title, titleSize, true);
    overlay_.Text(suffix, suffixX, topY + panelH * 0.5f, suffixSize, kHudFaint, TextAlign::Left,
                  TextVAlign::Middle);

    DrawElementLegend();

    if (mode_ != MeasureMode::None) {
        const bool distance = mode_ == MeasureMode::Distance;
        const Color modeColor = distance ? kHudGold : kHudCyan;
        const int required = RequiredPicks();
        const int picked = static_cast<int>(pendingPicks_.size());
        std::wstring status = picked > 0
                                  ? Fmt(T(Str::SelectedCountFmt), picked, required)
                                  : std::wstring(distance ? T(Str::MeasurementPickDistance)
                                                          : T(Str::MeasurementPickAngle));
        std::wstring banner = std::wstring(distance ? T(Str::MeasurementDistance) : T(Str::MeasurementAngle)) +
                              L"   ·   " + status;
        const float textSize = S(10.5f);
        banner = Ellipsize(banner, textSize, false, std::max(S(140.0f), w - S(32.0f) - S(30.0f)));
        const float bannerWidth = overlay_.MeasureText(banner, textSize) + S(34.0f);
        const float bannerY = topY + panelH + S(8.0f);
        overlay_.Panel(S(16.0f), bannerY, bannerWidth, S(30.0f), S(9.0f), Color::Hex(0x0D1118, 0.82f),
                       Color::Hex(distance ? 0x6B5421 : 0x1F536A, 0.9f), S(1.0f));
        overlay_.Circle(S(30.0f), bannerY + S(15.0f), S(3.0f), modeColor, 20);
        overlay_.Text(banner, S(42.0f), bannerY + S(15.0f), textSize, modeColor, TextAlign::Left,
                      TextVAlign::Middle);
    }

    const float gizmoSize = compact ? S(86.0f) : S(100.0f);
    const float gizmoX = w - S(16.0f) - gizmoSize;
    const float gizmoY = h - S(16.0f) - gizmoSize;
    const std::wstring hint = mode_ == MeasureMode::None
                                  ? std::wstring(T(Str::ViewHint))
                                  : std::wstring(T(mode_ == MeasureMode::Distance ? Str::MeasureHintDistance
                                                                                  : Str::MeasureHintAngle));
    const float hintSize = S(10.0f);
    const float hintMax = std::max(S(120.0f), gizmoX - S(28.0f));
    const std::wstring hintShown = Ellipsize(hint, hintSize, false, hintMax);
    const float hintWidth = std::min(hintMax, overlay_.MeasureText(hintShown, hintSize) + S(24.0f));
    overlay_.Panel(S(16.0f), h - S(16.0f) - S(28.0f), hintWidth, S(28.0f), S(9.0f), kHudPanelSoft,
                   Color::Hex(0x222C3D, 0.6f), S(0.8f));
    overlay_.Text(hintShown, S(16.0f) + S(12.0f), h - S(16.0f) - S(14.0f), hintSize, kHudDim,
                  TextAlign::Left, TextVAlign::Middle);

    bool hasPeriodicBonds = false;
    for (const Bond& bond : structure_->bonds) {
        if (LengthSq(bond.imageOffset) > 1e-12) {
            hasPeriodicBonds = true;
            break;
        }
    }
    if (hasPeriodicBonds) {
        const std::wstring legend =
            T(options_.showImages ? Str::ImageLegendOn : Str::ImageLegendOff);
        const float legendSize = S(9.2f);
        const float legendWidth = overlay_.MeasureText(legend, legendSize) + S(34.0f);
        const float legendY = h - S(16.0f) - S(28.0f) - S(8.0f) - S(24.0f);
        overlay_.Panel(S(16.0f), legendY, legendWidth, S(24.0f), S(8.0f), kHudPanelSoft,
                       Color::Hex(0x222C3D, 0.55f), S(0.8f));
        overlay_.Circle(S(16.0f) + S(13.0f), legendY + S(12.0f), S(3.0f),
                        options_.showImages ? Color::Hex(0x6EA8FF, 0.75f) : Color::Hex(0xE0B45A, 0.8f), 20);
        overlay_.Text(legend, S(16.0f) + S(24.0f), legendY + S(12.0f), legendSize, kHudFaint,
                      TextAlign::Left, TextVAlign::Middle);
    }
    DrawAxisGizmo();

    DrawMeasurementLabels();
    DrawAtomLabels();

    const ULONGLONG now = GetTickCount64();
    if (!flashText_.empty() && now < flashUntil_) {
        const ULONGLONG remaining = flashUntil_ - now;
        float alpha = 1.0f;
        if (remaining < 500) alpha = static_cast<float>(remaining) / 500.0f;
        const float flashSize = S(10.5f);
        const float flashW = overlay_.MeasureText(flashText_, flashSize) + S(30.0f);
        const float flashX = (w - flashW) * 0.5f;
        const float flashY = h - S(58.0f) - S(28.0f);
        overlay_.Panel(flashX, flashY, flashW, S(28.0f), S(9.0f),
                       Color::Hex(0x0C1119, 0.88f * alpha), Color::Hex(0x8A6B2E, 0.9f * alpha), S(1.0f));
        overlay_.Text(flashText_, w * 0.5f, flashY + S(14.0f), flashSize, Color::Hex(0xFFD98A, alpha),
                      TextAlign::Center, TextVAlign::Middle);
    } else if (!flashText_.empty()) {
        flashText_.clear();
    }
}

void Viewport::DrawAxisGizmo() {
    if (!structure_) return;
    const auto S = [&](float value) { return value * dpiScale_; };
    const bool compact = width_ < S(700.0f);
    const float size = compact ? S(86.0f) : S(100.0f);
    const float x = static_cast<float>(width_) - S(16.0f) - size;
    const float y = static_cast<float>(height_) - S(16.0f) - size;
    overlay_.Panel(x, y, size, size, S(11.0f), kHudPanelSoft, Color::Hex(0x253044, 0.65f), S(0.8f));
    struct AxisItem {
        Vec3 axis;
        std::wstring label;
        Color color;
        float depth = 0.0f;
    };
    std::vector<AxisItem> axes;
    if (structure_->cell.valid) {
        axes.push_back({Normalize(structure_->cell.aVec), L"a", kHudRed, 0});
        axes.push_back({Normalize(structure_->cell.bVec), L"b", kHudTeal, 0});
        axes.push_back({Normalize(structure_->cell.cVec), L"c", kHudCyan, 0});
    } else {
        axes.push_back({{1, 0, 0}, L"x", kHudRed, 0});
        axes.push_back({{0, 1, 0}, L"y", kHudTeal, 0});
        axes.push_back({{0, 0, 1}, L"z", kHudCyan, 0});
    }
    const Vec3 right = camera_.Right();
    const Vec3 up = camera_.Up();
    const Vec3 forward = camera_.Forward();
    for (AxisItem& axis : axes) axis.depth = static_cast<float>(Dot(axis.axis, forward));
    std::sort(axes.begin(), axes.end(), [](const AxisItem& a, const AxisItem& b) { return a.depth > b.depth; });
    const float centerX = x + size * 0.5f;
    const float centerY = y + size * 0.53f;
    const float len = size * 0.27f;
    overlay_.Ring(centerX, centerY, S(2.2f), S(0.8f), Color::Hex(0x94A5BE, 0.5f), 20);
    for (const AxisItem& axis : axes) {
        float dx = static_cast<float>(Dot(axis.axis, right));
        float dy = -static_cast<float>(Dot(axis.axis, up));
        const float l = std::sqrt(dx * dx + dy * dy);
        const float ex = centerX + dx * len;
        const float ey = centerY + dy * len;
        const float alpha = axis.depth > 0.0f ? 0.55f : 1.0f;
        const Color color = Color(axis.color.r, axis.color.g, axis.color.b, alpha);
        overlay_.Line(centerX, centerY, ex, ey, S(1.7f), color);
        overlay_.Circle(ex, ey, S(2.2f), color, 20);
        const float labelX = ex + (l > 0.1f ? dx / l : 1.0f) * S(10.0f);
        const float labelY = ey + (l > 0.1f ? dy / l : 0.0f) * S(10.0f);
        overlay_.Text(axis.label, labelX, labelY, S(9.5f), Color(color.r, color.g, color.b, alpha * 0.9f),
                      TextAlign::Center, TextVAlign::Middle, true);
    }
}

Vec3 Viewport::MeasurementLabelPosition(const Measurement& measurement) const {
    if (!structure_) return {};
    const Vec3 center = structure_->center;
    if (measurement.kind == MeasurementKind::Distance) {
        return (structure_->atoms[static_cast<size_t>(measurement.a)].cart + measurement.offsetA +
                structure_->atoms[static_cast<size_t>(measurement.b)].cart + measurement.offsetB) *
                   0.5 -
               center;
    }
    const Vec3 vertex = structure_->atoms[static_cast<size_t>(measurement.b)].cart - center;
    const Vec3 a = structure_->atoms[static_cast<size_t>(measurement.a)].cart + measurement.offsetA - center;
    const Vec3 c = structure_->atoms[static_cast<size_t>(measurement.c)].cart + measurement.offsetC - center;
    const Vec3 ua = Normalize(a - vertex);
    const Vec3 uc = Normalize(c - vertex);
    Vec3 bisector = Normalize(ua + uc);
    if (Length(bisector) < 0.1) bisector = Normalize(Cross(ua, camera_.Up()));
    if (Length(bisector) < 0.1) bisector = camera_.Up();
    return vertex + bisector * 0.7;
}

void Viewport::DrawMeasurementLabels() {
    if (!structure_ || measurements_.empty()) return;
    const auto S = [&](float value) { return value * dpiScale_; };
    std::vector<RECT> placed;
    const size_t count = std::min<size_t>(measurements_.size(), 24);
    for (size_t i = 0; i < count; ++i) {
        const Measurement& measurement = measurements_[i];
        const Vec3 world = MeasurementLabelPosition(measurement);
        const ScreenPoint screen = camera_.WorldToScreen(world, width_, height_);
        if (!screen.visible) continue;
        if (screen.x < S(20.0f) || screen.x > width_ - S(20.0f) || screen.y < S(20.0f) ||
            screen.y > height_ - S(20.0f))
            continue;
        const bool distance = measurement.kind == MeasurementKind::Distance;
        const Color color = distance ? kHudGold : kHudCyan;
        const std::wstring value = MeasurementValueText(measurement);
        const float textSize = S(10.0f);
        const float boxW = overlay_.MeasureText(value, textSize, true) + S(16.0f);
        const float boxH = S(22.0f);
        float left = static_cast<float>(screen.x) + S(8.0f);
        float top = static_cast<float>(screen.y) - boxH - S(4.0f);
        RECT box{static_cast<LONG>(std::lround(left)), static_cast<LONG>(std::lround(top)),
                 static_cast<LONG>(std::lround(left + boxW)), static_cast<LONG>(std::lround(top + boxH))};
        for (int attempt = 0; attempt < 5; ++attempt) {
            bool collision = false;
            for (const RECT& other : placed) {
                if (RectOverlaps(box, other)) {
                    collision = true;
                    break;
                }
            }
            if (!collision) break;
            top -= boxH + S(3.0f);
            box.top = static_cast<LONG>(std::lround(top));
            box.bottom = static_cast<LONG>(std::lround(top + boxH));
        }
        placed.push_back(box);
        overlay_.Panel(left, top, boxW, boxH, S(7.0f), Color::Hex(0x0A0F18, 0.88f),
                       Color(color.r, color.g, color.b, 0.55f), S(0.9f));
        overlay_.Text(value, left + boxW * 0.5f, top + boxH * 0.5f, textSize, color, TextAlign::Center,
                      TextVAlign::Middle, true);
    }
}

void Viewport::DrawAtomLabels() {
    if (!structure_ || !options_.showLabels || structure_->atoms.size() > 400) return;
    const auto S = [&](float value) { return value * dpiScale_; };
    struct Projected {
        ScreenPoint screen;
        int index = 0;
    };
    std::vector<Projected> projected;
    projected.reserve(structure_->atoms.size());
    const auto& radii = renderer_.SiteRadii();
    for (size_t i = 0; i < radii.size(); ++i) {
        if (radii[i] <= 0) continue;
        const ScreenPoint screen = camera_.WorldToScreen(AtomWorldPosition(static_cast<int>(i)), width_, height_);
        if (!screen.visible) continue;
        if (screen.x < S(8.0f) || screen.x > width_ - S(8.0f) || screen.y < S(8.0f) ||
            screen.y > height_ - S(8.0f))
            continue;
        projected.push_back({screen, static_cast<int>(i)});
    }
    std::sort(projected.begin(), projected.end(),
              [](const Projected& a, const Projected& b) { return a.screen.depth < b.screen.depth; });
    std::vector<RECT> placed;
    int drawn = 0;
    const int maxDrawn = 90;
    const float textSize = S(9.0f);
    for (const Projected& item : projected) {
        if (drawn >= maxDrawn) break;
        const Atom& atom = structure_->atoms[static_cast<size_t>(item.index)];
        std::wstring text = Utf8ToWide(atom.label);
        if (text.empty()) text = ColorToText(ElementByZ(atom.atomicNumber));
        if (text.size() > 12) text = text.substr(0, 11) + L"…";
        const float textW = overlay_.MeasureText(text, textSize);
        const float textH = overlay_.TextHeight(textSize);
        const float x = static_cast<float>(item.screen.x) + S(5.0f);
        const float y = static_cast<float>(item.screen.y) - textH - S(3.0f);
        RECT box{static_cast<LONG>(std::lround(x)) - 2, static_cast<LONG>(std::lround(y)) - 1,
                 static_cast<LONG>(std::lround(x + textW)) + 2, static_cast<LONG>(std::lround(y + textH)) + 1};
        bool collision = false;
        for (const RECT& other : placed) {
            if (RectOverlaps(box, other)) {
                collision = true;
                break;
            }
        }
        if (collision) continue;
        placed.push_back(box);
        const Element& element = ElementByZ(atom.atomicNumber);
        const Color textColor = LabelColorForElement(options_.elementStyles[element.z].Color(element));
        overlay_.Text(text, x + S(1.0f), y + S(1.0f), textSize, Color::Hex(0x000000, 0.65f), TextAlign::Left,
                      TextVAlign::Top);
        overlay_.Text(text, x, y, textSize, textColor, TextAlign::Left, TextVAlign::Top);
        ++drawn;
    }
}

void Viewport::DrawFallback(HDC dc) {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    const int width = rc.right - rc.left;
    const int height = rc.bottom - rc.top;
    HBRUSH background = CreateSolidBrush(RGB(9, 13, 21));
    FillRect(dc, &rc, background);
    DeleteObject(background);

    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(232, 238, 248));
    HFONT titleFont = CreateFontW(-static_cast<int>(std::lround(18.0f * dpiScale_)), 0, 0, 0, FW_SEMIBOLD,
                                  FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                                  CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE,
                                  L"Microsoft YaHei UI");
    HGDIOBJ old = SelectObject(dc, titleFont);
    RECT titleRect{0, height / 2 - static_cast<int>(80 * dpiScale_), width, height / 2};
    DrawTextW(dc, T(Str::RendererError), -1, &titleRect, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX);

    SetTextColor(dc, RGB(155, 168, 188));
    HFONT bodyFont = CreateFontW(-static_cast<int>(std::lround(11.0f * dpiScale_)), 0, 0, 0, FW_NORMAL, FALSE,
                                 FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                 CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
    SelectObject(dc, bodyFont);
    RECT hintRect{static_cast<LONG>(width * 0.1f), height / 2 + static_cast<int>(8 * dpiScale_),
                  static_cast<LONG>(width * 0.9f), height / 2 + static_cast<int>(52 * dpiScale_)};
    DrawTextW(dc, T(Str::RendererErrorHint), -1, &hintRect, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX);

    std::wstring detail = Utf8ToWide(rendererError_);
    if (!detail.empty()) {
        SetTextColor(dc, RGB(108, 121, 143));
        HFONT smallFont = CreateFontW(-static_cast<int>(std::lround(9.0f * dpiScale_)), 0, 0, 0, FW_NORMAL,
                                      FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                                      CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE,
                                      L"Consolas");
        SelectObject(dc, smallFont);
        RECT detailRect{static_cast<LONG>(width * 0.08f), height / 2 + static_cast<int>(66 * dpiScale_),
                        static_cast<LONG>(width * 0.92f), height / 2 + static_cast<int>(150 * dpiScale_)};
        DrawTextW(dc, detail.c_str(), -1, &detailRect, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX);
        DeleteObject(smallFont);
    }
    SelectObject(dc, old);
    DeleteObject(titleFont);
    DeleteObject(bodyFont);
}

bool Viewport::CaptureScreenshot(const std::wstring& path, std::wstring* error) {
    if (!rendererReady_ || !gl_.valid) {
        if (error) *error = L"渲染器尚未就绪";
        return false;
    }
    if (width_ <= 0 || height_ <= 0) {
        if (error) *error = L"视图尺寸无效";
        return false;
    }
    wglMakeCurrent(gl_.hdc, gl_.hglrc);
    RenderFrame(false);
    std::vector<unsigned char> rgba(static_cast<size_t>(width_) * height_ * 4);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadPixels(0, 0, width_, height_, GL_RGBA, GL_UNSIGNED_BYTE, rgba.data());

    std::vector<unsigned char> bgra(static_cast<size_t>(width_) * height_ * 4);
    for (int y = 0; y < height_; ++y) {
        const int srcY = height_ - 1 - y;
        for (int x = 0; x < width_; ++x) {
            const size_t src = (static_cast<size_t>(srcY) * width_ + x) * 4;
            const size_t dst = (static_cast<size_t>(y) * width_ + x) * 4;
            bgra[dst + 0] = rgba[src + 2];
            bgra[dst + 1] = rgba[src + 1];
            bgra[dst + 2] = rgba[src + 0];
            bgra[dst + 3] = 255;
        }
    }
    CLSID pngClsid{};
    if (GetPngEncoderClsid(&pngClsid) < 0) {
        if (error) *error = L"未找到 PNG 编码器";
        return false;
    }
    Gdiplus::Bitmap bitmap(width_, height_, width_ * 4, PixelFormat32bppARGB, bgra.data());
    if (bitmap.GetLastStatus() != Gdiplus::Ok || bitmap.Save(path.c_str(), &pngClsid, nullptr) != Gdiplus::Ok) {
        if (error) *error = L"无法写入图片文件";
        return false;
    }
    return true;
}

std::wstring Viewport::RendererDescription() const {
    if (!rendererReady_) return T(Str::Unknown);
    std::wstring version = Utf8ToWide(gl_.version);
    const size_t space = version.find(L' ');
    if (space != std::wstring::npos) version = version.substr(0, space);
    std::wstring text = L"OpenGL " + version + L"  ·  " + Utf8ToWide(gl_.renderer);
    if (gl_.samples > 1) text += L"  ·  " + std::to_wstring(gl_.samples) + L"× MSAA";
    return text;
}

LRESULT CALLBACK Viewport::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    Viewport* self = reinterpret_cast<Viewport*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<Viewport*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT Viewport::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_NCCREATE:
        return TRUE;
    case WM_CREATE:
        return 0;
    case WM_SIZE: {
        EndDrag();
        width_ = LOWORD(lParam);
        height_ = HIWORD(lParam);
        UpdateWindowRegion();
        if (structure_ && !userAdjustedCamera_ && width_ > 0 && height_ > 0) {
            FitToStructure();
        }
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    }
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps{};
        HDC dc = BeginPaint(hwnd_, &ps);
        if (!rendererReady_ || glFailed_) {
            DrawFallback(dc);
        } else {
            RenderFrame(true);
        }
        EndPaint(hwnd_, &ps);
        return 0;
    }
    case WM_TIMER:
        if (wParam == kViewportTimer && rendererReady_ && IsWindowVisible(hwnd_) &&
            !IsIconic(GetAncestor(hwnd_, GA_ROOT))) {
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        return 0;
    case WM_MOUSEMOVE: {
        if (!trackingMouseLeave_) {
            TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, hwnd_, 0};
            TrackMouseEvent(&track);
            trackingMouseLeave_ = true;
        }
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        if (dragMode_ == DragMode::Orbit || dragMode_ == DragMode::Zoom) {
            UpdateLeftDrag(x, y);
        } else if (dragMode_ == DragMode::Pan) {
            camera_.Pan(x - lastMouseX_, y - lastMouseY_, width_, height_);
            lastMouseX_ = x;
            lastMouseY_ = y;
            userAdjustedCamera_ = true;
            InvalidateView();
        } else {
            UpdateHover(x, y);
        }
        return 0;
    }
    case WM_LBUTTONDOWN: {
        SetFocus(hwnd_);
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        if (!structure_) {
            if (emptyButtonRectValid_ && PointInRect(emptyButtonRect_, x, y) && host_) {
                host_->OnViewportCommand(CmdLibrary);
            }
            return 0;
        }
        if (dragMode_ != DragMode::None) return 0;
        if (pendingFit_ && !userAdjustedCamera_) FitToStructure();
        SetCapture(hwnd_);
        movedDuringDrag_ = false;
        dragMode_ = (wParam & MK_CONTROL) ? DragMode::Zoom : DragMode::Orbit;
        fineRotation_ = (wParam & MK_SHIFT) != 0;
        dragStartX_ = x;
        dragStartY_ = y;
        dragCamera_ = camera_;
        SetCursorForState();
        return 0;
    }
    case WM_LBUTTONUP: {
        if (dragMode_ == DragMode::Orbit || dragMode_ == DragMode::Zoom) {
            const int x = GET_X_LPARAM(lParam), y = GET_Y_LPARAM(lParam);
            UpdateLeftDrag(x, y);
            const bool clicked = dragMode_ == DragMode::Orbit && !movedDuringDrag_;
            EndDrag();
            if (clicked) HandleLeftClick(x, y);
        }
        return 0;
    }
    case WM_MBUTTONDOWN:
    case WM_RBUTTONDOWN: {
        if (!structure_ || dragMode_ != DragMode::None) return 0;
        SetFocus(hwnd_);
        SetCapture(hwnd_);
        dragMode_ = DragMode::Pan;
        dragButton_ = message == WM_MBUTTONDOWN ? 2 : 3;
        lastMouseX_ = GET_X_LPARAM(lParam);
        lastMouseY_ = GET_Y_LPARAM(lParam);
        SetCursorForState();
        return 0;
    }
    case WM_MBUTTONUP:
    case WM_RBUTTONUP:
        if ((message == WM_MBUTTONUP && dragButton_ == 2) ||
            (message == WM_RBUTTONUP && dragButton_ == 3)) EndDrag();
        return 0;
    case WM_CAPTURECHANGED:
    case WM_CANCELMODE:
    case WM_KILLFOCUS:
        EndDrag();
        break;
    case WM_MOUSELEAVE:
        trackingMouseLeave_ = false;
        if (dragMode_ == DragMode::None) {
            if (hoveredAtom_ >= 0) {
                hoveredAtom_ = -1;
                UpdateHighlight();
                if (host_) host_->OnViewportHoverChanged(-1);
                InvalidateRect(hwnd_, nullptr, FALSE);
            }
            if (emptyButtonHovered_) {
                emptyButtonHovered_ = false;
                InvalidateRect(hwnd_, nullptr, FALSE);
            }
            SetCursorForState();
        }
        return 0;
    case WM_MOUSEWHEEL: {
        if (!structure_) return 0;
        const double steps = static_cast<double>(GET_WHEEL_DELTA_WPARAM(wParam)) / WHEEL_DELTA;
        POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
        ScreenToClient(hwnd_, &point);
        RECT client{};
        GetClientRect(hwnd_, &client);
        if (!PtInRect(&client, point)) return SendMessageW(GetParent(hwnd_), message, wParam, lParam);
        EndDrag();
        camera_.ZoomAt(steps, point.x, point.y, width_, height_);
        userAdjustedCamera_ = true;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    }
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT) {
            SetCursorForState();
            return TRUE;
        }
        break;
    case WM_KEYDOWN: {
        const bool ctrl = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
        if (ctrl) break;
        switch (wParam) {
        case VK_ESCAPE:
            if (mode_ != MeasureMode::None) {
                CancelMeasure();
            } else if (selectedAtom_ >= 0) {
                selectedAtom_ = -1;
                UpdateHighlight();
                NotifySelection();
                InvalidateRect(hwnd_, nullptr, FALSE);
            }
            return 0;
        case 'F':
            FitView();
            return 0;
        case VK_HOME:
            ResetView();
            return 0;
        case 'D':
            SetModeInternal(mode_ == MeasureMode::Distance ? MeasureMode::None : MeasureMode::Distance, true);
            return 0;
        case 'A':
            SetModeInternal(mode_ == MeasureMode::Angle ? MeasureMode::None : MeasureMode::Angle, true);
            return 0;
        case 'C':
            if (host_) host_->OnViewportCommand(CmdToggleCell);
            return 0;
        case 'B':
            if (host_) host_->OnViewportCommand(CmdToggleBonds);
            return 0;
        case 'L':
            if (host_) host_->OnViewportCommand(CmdToggleLabels);
            return 0;
        case 'P':
            if (host_) host_->OnViewportCommand(camera_.orthographic ? CmdPerspective : CmdOrthographic);
            return 0;
        case VK_F1:
            if (host_) host_->OnViewportCommand(CmdHelp);
            return 0;
        case VK_F2:
            if (host_) host_->OnViewportCommand(CmdEditAtom);
            return 0;
        case VK_DELETE:
            if (host_) host_->OnViewportCommand(CmdDeleteAtom);
            return 0;
        case VK_LEFT:
        case VK_RIGHT:
        case VK_UP:
        case VK_DOWN: {
            constexpr double step = 3.3 * kDegToRad;
            EndDrag();
            camera_.OrbitBy(step * ((wParam == VK_RIGHT) - (wParam == VK_LEFT)),
                            step * ((wParam == VK_DOWN) - (wParam == VK_UP)));
            userAdjustedCamera_ = true;
            InvalidateView();
            return 0;
        }
        case VK_ADD:
        case VK_OEM_PLUS:
            EndDrag();
            camera_.Zoom(1.0);
            userAdjustedCamera_ = true;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return 0;
        case VK_SUBTRACT:
        case VK_OEM_MINUS:
            EndDrag();
            camera_.Zoom(-1.0);
            userAdjustedCamera_ = true;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return 0;
        default:
            break;
        }
        break;
    }
    case WM_GETDLGCODE:
        return DLGC_WANTARROWS;
    case WM_CONTEXTMENU:
        return 0;
    case WM_DROPFILES:
        return SendMessageW(GetParent(hwnd_), WM_DROPFILES, wParam, lParam);
    case WM_DESTROY:
        KillTimer(hwnd_, kViewportTimer);
        ShutdownGraphics();
        return 0;
    case WM_NCDESTROY:
        SetWindowLongPtrW(hwnd_, GWLP_USERDATA, 0);
        return DefWindowProcW(hwnd_, message, wParam, lParam);
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

} // namespace cl
