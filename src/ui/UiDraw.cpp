#include "UiDraw.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <string>

namespace cl {
namespace {

struct FontKey {
    int size = 12;
    bool bold = false;
    bool mono = false;
    bool operator<(const FontKey& other) const {
        if (mono != other.mono) return mono < other.mono;
        if (bold != other.bold) return bold < other.bold;
        return size < other.size;
    }
};

std::unique_ptr<Gdiplus::FontFamily> uiFontFamily;
std::unique_ptr<Gdiplus::FontFamily> monoFontFamily;
std::map<FontKey, std::unique_ptr<Gdiplus::Font>> cache;

const Gdiplus::FontFamily* LookupFamily(std::unique_ptr<Gdiplus::FontFamily>& family,
                                       std::initializer_list<const wchar_t*> names) {
    if (family) return family.get();
    for (auto name : names) {
        auto candidate = std::make_unique<Gdiplus::FontFamily>(name);
        if (candidate->GetLastStatus() == Gdiplus::Ok && candidate->IsAvailable()) {
            family = std::move(candidate);
            return family.get();
        }
    }
    return Gdiplus::FontFamily::GenericSansSerif();
}

Gdiplus::Font* GetCachedFont(float pixelSize, bool bold, bool mono) {
    FontKey key;
    key.size = static_cast<int>(std::lround(std::clamp(pixelSize, 8.0f, 96.0f)));
    key.bold = bold;
    key.mono = mono;
    auto it = cache.find(key);
    if (it != cache.end()) return it->second.get();
    const Gdiplus::FontFamily* family = mono
        ? LookupFamily(monoFontFamily, {L"Cascadia Mono", L"Consolas", L"Courier New"})
        : LookupFamily(uiFontFamily, {L"Microsoft YaHei UI", L"Segoe UI"});
    auto font = std::make_unique<Gdiplus::Font>(family, static_cast<float>(key.size),
                                                bold ? Gdiplus::FontStyleBold : Gdiplus::FontStyleRegular,
                                                Gdiplus::UnitPixel);
    if (font->GetLastStatus() != Gdiplus::Ok) {
        font = std::make_unique<Gdiplus::Font>(Gdiplus::FontFamily::GenericSansSerif(),
                                               static_cast<float>(key.size), Gdiplus::FontStyleRegular,
                                               Gdiplus::UnitPixel);
    }
    Gdiplus::Font* raw = font.get();
    cache.emplace(key, std::move(font));
    return raw;
}

Gdiplus::StringAlignment ToAlign(UiTextAlign align) {
    switch (align) {
    case UiTextAlign::Center: return Gdiplus::StringAlignmentCenter;
    case UiTextAlign::Right: return Gdiplus::StringAlignmentFar;
    default: return Gdiplus::StringAlignmentNear;
    }
}

Gdiplus::StringAlignment ToVAlign(UiTextVAlign align) {
    switch (align) {
    case UiTextVAlign::Middle: return Gdiplus::StringAlignmentCenter;
    case UiTextVAlign::Bottom: return Gdiplus::StringAlignmentFar;
    default: return Gdiplus::StringAlignmentNear;
    }
}

} // namespace

void ReleaseUiFonts() {
    cache.clear();
    monoFontFamily.reset();
    uiFontFamily.reset();
}

void AddRoundedRectPath(Gdiplus::GraphicsPath& path, const UiRect& rect, float radius) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    radius = std::clamp(radius, 0.0f, std::min(rect.Width, rect.Height) * 0.5f);
    if (radius < 0.5f) {
        path.AddRectangle(rect);
        return;
    }
    const float d = radius * 2.0f;
    path.AddArc(rect.X, rect.Y, d, d, 180.0f, 90.0f);
    path.AddArc(rect.X + rect.Width - d, rect.Y, d, d, 270.0f, 90.0f);
    path.AddArc(rect.X + rect.Width - d, rect.Y + rect.Height - d, d, d, 0.0f, 90.0f);
    path.AddArc(rect.X, rect.Y + rect.Height - d, d, d, 90.0f, 90.0f);
    path.CloseFigure();
}

Painter::Painter(Gdiplus::Graphics& graphics, float dpiScale) : g_(graphics), dpiScale_(dpiScale) {
    g_.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    g_.SetTextRenderingHint(Gdiplus::TextRenderingHintClearTypeGridFit);
    g_.SetCompositingQuality(Gdiplus::CompositingQualityHighQuality);
    g_.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);
    g_.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
}

void Painter::FillRect(const UiRect& rect, const UiColor& color) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    Gdiplus::SolidBrush brush(color);
    g_.FillRectangle(&brush, rect);
}

void Painter::FillRoundRect(const UiRect& rect, float radius, const UiColor& color) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    Gdiplus::GraphicsPath path;
    AddRoundedRectPath(path, rect, radius);
    Gdiplus::SolidBrush brush(color);
    g_.FillPath(&brush, &path);
}

void Painter::FillRoundRectGradient(const UiRect& rect, float radius, const UiColor& top, const UiColor& bottom) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    if (top.GetValue() == bottom.GetValue()) {
        FillRoundRect(rect, radius, top);
        return;
    }
    Gdiplus::GraphicsPath path;
    AddRoundedRectPath(path, rect, radius);
    Gdiplus::LinearGradientBrush brush(rect, top, bottom, Gdiplus::LinearGradientModeVertical);
    g_.FillPath(&brush, &path);
}

void Painter::StrokeRoundRect(const UiRect& rect, float radius, const UiColor& color, float thickness) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    Gdiplus::GraphicsPath path;
    AddRoundedRectPath(path, rect, radius);
    Gdiplus::Pen pen(color, std::max(0.5f, thickness));
    pen.SetAlignment(Gdiplus::PenAlignmentInset);
    g_.DrawPath(&pen, &path);
}

void Painter::Shadow(const UiRect& rect, float radius, const UiColor& color, float spread) {
    for (int i = 3; i >= 1; --i) {
        const float grow = spread * static_cast<float>(i);
        UiColor shade = color;
        shade = UiColor(static_cast<BYTE>(shade.GetA() / (3 + i)), shade.GetR(), shade.GetG(), shade.GetB());
        FillRoundRect(UiRect(rect.X - grow, rect.Y - grow + 1.0f, rect.Width + grow * 2.0f,
                             rect.Height + grow * 2.0f),
                      radius + grow, shade);
    }
}

void Painter::Divider(float x0, float x1, float y, const UiColor& color) {
    Gdiplus::Pen pen(color, 1.0f);
    g_.DrawLine(&pen, x0, y, x1, y);
}

void Painter::VerticalDivider(float x, float y0, float y1, const UiColor& color) {
    Gdiplus::Pen pen(color, 1.0f);
    g_.DrawLine(&pen, x, y0, x, y1);
}

void Painter::Line(float x0, float y0, float x1, float y1, const UiColor& color, float thickness) {
    Gdiplus::Pen pen(color, std::max(0.5f, thickness));
    pen.SetStartCap(Gdiplus::LineCapRound);
    pen.SetEndCap(Gdiplus::LineCapRound);
    g_.DrawLine(&pen, x0, y0, x1, y1);
}

void Painter::GlowEllipse(const UiRect& rect, const UiColor& center, const UiColor& edge) {
    if (rect.Width <= 0 || rect.Height <= 0) return;
    Gdiplus::GraphicsPath path;
    path.AddEllipse(rect);
    Gdiplus::PathGradientBrush brush(&path);
    brush.SetCenterColor(center);
    Gdiplus::Color surround[] = {edge};
    int count = 1;
    brush.SetSurroundColors(surround, &count);
    g_.FillPath(&brush, &path);
}

Gdiplus::Font* Painter::FontFor(float pixelSize, bool bold, bool mono) {
    return GetCachedFont(pixelSize, bold, mono);
}

void Painter::Text(const std::wstring& text, const UiRect& rect, float pixelSize, const UiColor& color,
                   UiTextAlign align, UiTextVAlign valign, bool bold, bool mono, bool wrap, bool ellipsis) {
    if (text.empty() || rect.Width <= 0 || rect.Height <= 0 || color.GetA() == 0) return;
    Gdiplus::Font* font = FontFor(pixelSize, bold, mono);
    Gdiplus::StringFormat format;
    format.SetAlignment(ToAlign(align));
    format.SetLineAlignment(ToVAlign(valign));
    format.SetHotkeyPrefix(Gdiplus::HotkeyPrefixNone);
    format.SetTrimming(ellipsis ? Gdiplus::StringTrimmingEllipsisCharacter : Gdiplus::StringTrimmingNone);
    format.SetFormatFlags(wrap ? 0 : Gdiplus::StringFormatFlagsNoWrap);
    Gdiplus::SolidBrush brush(color);
    g_.DrawString(text.c_str(), static_cast<INT>(text.size()), font, rect, &format, &brush);
}

void Painter::TextSimple(const std::wstring& text, float x, float y, float pixelSize, const UiColor& color,
                         bool bold, bool mono) {
    if (text.empty()) return;
    Gdiplus::Font* font = FontFor(pixelSize, bold, mono);
    Gdiplus::SolidBrush brush(color);
    g_.DrawString(text.c_str(), static_cast<INT>(text.size()), font, Gdiplus::PointF(x, y), &brush);
}

float Painter::MeasureText(const std::wstring& text, float pixelSize, bool bold, bool mono) {
    if (text.empty()) return 0.0f;
    Gdiplus::Font* font = FontFor(pixelSize, bold, mono);
    Gdiplus::StringFormat format;
    format.SetFormatFlags(Gdiplus::StringFormatFlagsNoWrap | Gdiplus::StringFormatFlagsNoClip);
    Gdiplus::RectF layout(0, 0, 4096, 512);
    Gdiplus::RectF bounds;
    g_.MeasureString(text.c_str(), static_cast<INT>(text.size()), font, layout, &format, &bounds);
    return bounds.Width;
}

float Painter::MeasureTextHeight(const std::wstring& text, float pixelSize, float maxWidth, bool bold, bool mono) {
    if (text.empty()) return 0.0f;
    Gdiplus::Font* font = FontFor(pixelSize, bold, mono);
    Gdiplus::StringFormat format;
    format.SetTrimming(Gdiplus::StringTrimmingWord);
    format.SetFormatFlags(0);
    Gdiplus::RectF layout(0, 0, std::max(10.0f, maxWidth), 100000.0f);
    Gdiplus::RectF bounds;
    g_.MeasureString(text.c_str(), static_cast<INT>(text.size()), font, layout, &format, &bounds);
    return bounds.Height;
}

float Painter::LineHeight(float pixelSize, bool bold, bool mono) {
    Gdiplus::Font* font = FontFor(pixelSize, bold, mono);
    return font->GetHeight(&g_);
}

} // namespace cl
