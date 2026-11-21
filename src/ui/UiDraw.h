#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>

#include <algorithm>
#include <string>

namespace cl {

using UiColor = Gdiplus::Color;
using UiRect = Gdiplus::RectF;

namespace Theme {
inline const UiColor kBgTop(255, 10, 14, 22);
inline const UiColor kBgBottom(255, 6, 9, 15);
inline const UiColor kSurface(255, 18, 24, 36);
inline const UiColor kSurfaceRaised(255, 22, 29, 43);
inline const UiColor kSurfaceHover(255, 29, 38, 55);
inline const UiColor kSurfaceSunken(255, 13, 18, 27);
inline const UiColor kBorder(255, 38, 49, 67);
inline const UiColor kBorderSoft(255, 29, 38, 53);
inline const UiColor kBorderBright(255, 55, 72, 98);
inline const UiColor kText(255, 234, 240, 248);
inline const UiColor kTextSecondary(255, 158, 170, 190);
inline const UiColor kTextMuted(255, 108, 121, 143);
inline const UiColor kTextFaint(255, 76, 89, 110);
inline const UiColor kAccent(255, 99, 146, 255);
inline const UiColor kAccentLight(255, 133, 171, 255);
inline const UiColor kAccentDim(255, 44, 70, 120);
inline const UiColor kTeal(255, 53, 211, 175);
inline const UiColor kGold(255, 255, 201, 91);
inline const UiColor kCyan(255, 91, 204, 255);
inline const UiColor kGreen(255, 63, 219, 151);
inline const UiColor kRed(255, 255, 107, 122);
inline const UiColor kWhitesmoke(255, 236, 241, 248);

inline UiColor Alpha(const UiColor& color, BYTE alpha) {
    return UiColor(alpha, color.GetR(), color.GetG(), color.GetB());
}

inline UiColor Hex(uint32_t rgb, BYTE alpha = 255) {
    return UiColor(alpha, static_cast<BYTE>((rgb >> 16) & 0xFF), static_cast<BYTE>((rgb >> 8) & 0xFF),
                   static_cast<BYTE>(rgb & 0xFF));
}

inline UiColor Mix(const UiColor& a, const UiColor& b, float t) {
    const auto mix = [&](BYTE x, BYTE y) {
        return static_cast<BYTE>(x + (y - x) * std::max(0.0f, std::min(1.0f, t)));
    };
    return UiColor(static_cast<BYTE>(a.GetA() + (b.GetA() - a.GetA()) * t), mix(a.GetR(), b.GetR()),
                   mix(a.GetG(), b.GetG()), mix(a.GetB(), b.GetB()));
}
} // namespace Theme

enum class UiTextAlign { Left, Center, Right };
enum class UiTextVAlign { Top, Middle, Bottom };

void ReleaseUiFonts();

class Painter {
public:
    Painter(Gdiplus::Graphics& graphics, float dpiScale);

    Gdiplus::Graphics& Graphics() { return g_; }
    float Dpi() const { return dpiScale_; }

    void FillRect(const UiRect& rect, const UiColor& color);
    void FillRoundRect(const UiRect& rect, float radius, const UiColor& color);
    void FillRoundRectGradient(const UiRect& rect, float radius, const UiColor& top, const UiColor& bottom);
    void StrokeRoundRect(const UiRect& rect, float radius, const UiColor& color, float thickness);
    void Shadow(const UiRect& rect, float radius, const UiColor& color, float spread = 4.0f);
    void Divider(float x0, float x1, float y, const UiColor& color);
    void VerticalDivider(float x, float y0, float y1, const UiColor& color);
    void GlowEllipse(const UiRect& rect, const UiColor& center, const UiColor& edge);
    void Line(float x0, float y0, float x1, float y1, const UiColor& color, float thickness);

    void Text(const std::wstring& text, const UiRect& rect, float pixelSize, const UiColor& color,
              UiTextAlign align = UiTextAlign::Left, UiTextVAlign valign = UiTextVAlign::Middle,
              bool bold = false, bool mono = false, bool wrap = false, bool ellipsis = true);
    void TextSimple(const std::wstring& text, float x, float y, float pixelSize, const UiColor& color,
                    bool bold = false, bool mono = false);
    float MeasureText(const std::wstring& text, float pixelSize, bool bold = false, bool mono = false);
    float MeasureTextHeight(const std::wstring& text, float pixelSize, float maxWidth, bool bold = false,
                            bool mono = false);
    float LineHeight(float pixelSize, bool bold = false, bool mono = false);

private:
    Gdiplus::Font* FontFor(float pixelSize, bool bold, bool mono);
    Gdiplus::Graphics& g_;
    float dpiScale_ = 1.0f;
};

void AddRoundedRectPath(Gdiplus::GraphicsPath& path, const UiRect& rect, float radius);

} // namespace cl
