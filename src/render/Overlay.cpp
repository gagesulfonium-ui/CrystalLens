#include "Overlay.h"

#include "core/Crystal.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace cl {
namespace {

const char* kPrimVertex = R"GLSL(
#version 330 core
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
uniform vec2 uScreen;
out vec4 vColor;
void main() {
    vec2 ndc = vec2(aPos.x / uScreen.x * 2.0 - 1.0, 1.0 - aPos.y / uScreen.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    vColor = aColor;
}
)GLSL";

const char* kPrimFragment = R"GLSL(
#version 330 core
in vec4 vColor;
out vec4 FragColor;
void main() { FragColor = vColor; }
)GLSL";

const char* kTextVertex = R"GLSL(
#version 330 core
layout(location = 0) in vec2 aUV;
uniform vec2 uScreen;
uniform vec2 uOrigin;
uniform vec2 uSize;
out vec2 vUV;
void main() {
    vec2 p = uOrigin + aUV * uSize;
    vec2 ndc = vec2(p.x / uScreen.x * 2.0 - 1.0, 1.0 - p.y / uScreen.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);
    vUV = aUV;
}
)GLSL";

const char* kTextFragment = R"GLSL(
#version 330 core
in vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uColor;
out vec4 FragColor;
void main() {
    float a = texture(uTex, vUV).r;
    FragColor = vec4(uColor.rgb, uColor.a * a);
}
)GLSL";

constexpr float kPiF = 3.14159265358979323846f;

} // namespace

bool Overlay::Initialize(GLContext* context, std::string* error) {
    Shutdown();
    context_ = context;
    if (!context_ || !context_->valid) {
        if (error) *error = "OpenGL 上下文无效";
        return false;
    }
    std::string buildError;
    if (!primProgram_.Build(context_->gl, kPrimVertex, kPrimFragment, nullptr, &buildError) ||
        !textProgram_.Build(context_->gl, kTextVertex, kTextFragment, nullptr, &buildError)) {
        if (error) *error = "无法创建界面绘制着色器: " + buildError;
        Shutdown();
        return false;
    }
    memoryDC_ = CreateCompatibleDC(nullptr);
    if (!memoryDC_) {
        if (error) *error = "无法创建文本绘制缓冲";
        Shutdown();
        return false;
    }

    auto& gl = context_->gl;
    gl.GenVertexArrays(1, &primVAO_);
    gl.GenBuffers(1, &primVBO_);
    gl.BindVertexArray(primVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, primVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, 0, nullptr, GL_DYNAMIC_DRAW);
    gl.EnableVertexAttribArray(0);
    gl.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(PrimVertex),
                           reinterpret_cast<const void*>(offsetof(PrimVertex, x)));
    gl.EnableVertexAttribArray(1);
    gl.VertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(PrimVertex),
                           reinterpret_cast<const void*>(offsetof(PrimVertex, r)));

    gl.GenVertexArrays(1, &textVAO_);
    gl.GenBuffers(1, &textVBO_);
    static const float uv[] = {0, 0, 1, 0, 0, 1, 1, 1};
    gl.BindVertexArray(textVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, textVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, sizeof(uv), uv, GL_STATIC_DRAW);
    gl.EnableVertexAttribArray(0);
    gl.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), nullptr);
    gl.BindVertexArray(0);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
    initialized_ = true;
    return true;
}

void Overlay::Shutdown() {
    if (context_) {
        ClearTextCache();
    }
    for (auto& [key, font] : fonts_) {
        if (font) DeleteObject(font);
    }
    fonts_.clear();
    if (memoryDC_) {
        DeleteDC(memoryDC_);
        memoryDC_ = nullptr;
    }
    if (context_) {
        auto& gl = context_->gl;
        primProgram_.Destroy();
        textProgram_.Destroy();
        if (primVBO_) gl.DeleteBuffers(1, &primVBO_);
        if (textVBO_) gl.DeleteBuffers(1, &textVBO_);
        if (primVAO_) gl.DeleteVertexArrays(1, &primVAO_);
        if (textVAO_) gl.DeleteVertexArrays(1, &textVAO_);
    }
    primVBO_ = textVBO_ = 0;
    primVAO_ = textVAO_ = 0;
    context_ = nullptr;
    initialized_ = false;
    frameActive_ = false;
}

void Overlay::Begin(int width, int height, float dpiScale) {
    if (!initialized_) return;
    width_ = std::max(1, width);
    height_ = std::max(1, height);
    dpiScale_ = std::max(0.5f, dpiScale);
    frameActive_ = true;
    vertices_.clear();
    textCommands_.clear();
    textCommands_.reserve(128);
    vertices_.reserve(1024);
    if (textCache_.size() > 600) ClearTextCache();
    auto& gl = context_->gl;
    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_FALSE);
    glDisable(GL_CULL_FACE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
}

void Overlay::End() {
    if (!initialized_ || !frameActive_) return;
    FlushPrimitives();
    FlushText();
    auto& gl = context_->gl;
    glDisable(GL_BLEND);
    glEnable(GL_DEPTH_TEST);
    glDepthMask(GL_TRUE);
    frameActive_ = false;
}

void Overlay::PushVertex(float x, float y, const Color& color) {
    vertices_.push_back(PrimVertex{x, y, color.r, color.g, color.b, color.a});
}

void Overlay::AddTriangle(float x0, float y0, float x1, float y1, float x2, float y2, const Color& color) {
    PushVertex(x0, y0, color);
    PushVertex(x1, y1, color);
    PushVertex(x2, y2, color);
}

void Overlay::FillRect(float x, float y, float w, float h, const Color& color) {
    if (!frameActive_ || w <= 0 || h <= 0 || color.a <= 0.0f) return;
    AddTriangle(x, y, x + w, y, x, y + h, color);
    AddTriangle(x + w, y, x + w, y + h, x, y + h, color);
}

void Overlay::FillRoundedRect(float x, float y, float w, float h, float radius, const Color& color) {
    if (!frameActive_ || w <= 0 || h <= 0 || color.a <= 0.0f) return;
    radius = Clampf(radius, 0.0f, std::min(w, h) * 0.5f);
    if (radius < 0.6f) {
        FillRect(x, y, w, h, color);
        return;
    }
    const int segments = std::max(4, std::min(12, static_cast<int>(radius * 0.45f) + 4));
    struct Pt {
        float x, y;
    };
    std::vector<Pt> pts;
    pts.reserve(static_cast<size_t>(segments + 1) * 4);
    auto arc = [&](float cx, float cy, float a0, float a1) {
        for (int i = 0; i <= segments; ++i) {
            const float t = static_cast<float>(i) / static_cast<float>(segments);
            const float a = a0 + (a1 - a0) * t;
            pts.push_back({cx + radius * std::cos(a), cy + radius * std::sin(a)});
        }
    };
    arc(x + radius, y + radius, kPiF, kPiF * 1.5f);
    arc(x + w - radius, y + radius, kPiF * 1.5f, kPiF * 2.0f);
    arc(x + w - radius, y + h - radius, 0.0f, kPiF * 0.5f);
    arc(x + radius, y + h - radius, kPiF * 0.5f, kPiF);
    const float cx = x + w * 0.5f;
    const float cy = y + h * 0.5f;
    for (size_t i = 0; i < pts.size(); ++i) {
        const Pt& p0 = pts[i];
        const Pt& p1 = pts[(i + 1) % pts.size()];
        AddTriangle(cx, cy, p0.x, p0.y, p1.x, p1.y, color);
    }
}

void Overlay::Panel(float x, float y, float w, float h, float radius, const Color& fill, const Color& border,
                    float borderThickness) {
    FillRoundedRect(x, y, w, h, radius, border);
    if (borderThickness <= 0.0f) {
        FillRoundedRect(x, y, w, h, radius, fill);
        return;
    }
    const float t = std::max(0.5f, borderThickness);
    FillRoundedRect(x + t, y + t, w - t * 2.0f, h - t * 2.0f, std::max(0.0f, radius - t), fill);
}

void Overlay::Line(float x0, float y0, float x1, float y1, float thickness, const Color& color) {
    if (!frameActive_ || color.a <= 0.0f) return;
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const float len = std::sqrt(dx * dx + dy * dy);
    if (len < 1e-4f) return;
    const float nx = -dy / len * std::max(0.5f, thickness) * 0.5f;
    const float ny = dx / len * std::max(0.5f, thickness) * 0.5f;
    AddTriangle(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x0 - nx, y0 - ny, color);
    AddTriangle(x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, color);
}

void Overlay::Circle(float cx, float cy, float radius, const Color& color, int segments) {
    if (!frameActive_ || radius <= 0 || color.a <= 0.0f) return;
    segments = std::max(8, segments);
    for (int i = 0; i < segments; ++i) {
        const float a0 = static_cast<float>(i) / segments * kPiF * 2.0f;
        const float a1 = static_cast<float>(i + 1) / segments * kPiF * 2.0f;
        AddTriangle(cx, cy, cx + std::cos(a0) * radius, cy + std::sin(a0) * radius,
                    cx + std::cos(a1) * radius, cy + std::sin(a1) * radius, color);
    }
}

void Overlay::Ring(float cx, float cy, float radius, float thickness, const Color& color, int segments) {
    if (!frameActive_ || radius <= 0 || thickness <= 0 || color.a <= 0.0f) return;
    segments = std::max(8, segments);
    const float inner = std::max(0.0f, radius - thickness);
    for (int i = 0; i < segments; ++i) {
        const float a0 = static_cast<float>(i) / segments * kPiF * 2.0f;
        const float a1 = static_cast<float>(i + 1) / segments * kPiF * 2.0f;
        const float x0 = cx + std::cos(a0) * radius;
        const float y0 = cy + std::sin(a0) * radius;
        const float x1 = cx + std::cos(a1) * radius;
        const float y1 = cy + std::sin(a1) * radius;
        const float ix0 = cx + std::cos(a0) * inner;
        const float iy0 = cy + std::sin(a0) * inner;
        const float ix1 = cx + std::cos(a1) * inner;
        const float iy1 = cy + std::sin(a1) * inner;
        AddTriangle(x0, y0, x1, y1, ix0, iy0, color);
        AddTriangle(x1, y1, ix1, iy1, ix0, iy0, color);
    }
}

HFONT Overlay::FontFor(int pixelSize, bool bold) {
    pixelSize = std::clamp(pixelSize, 7, 96);
    const auto key = std::make_pair(pixelSize, bold);
    auto it = fonts_.find(key);
    if (it != fonts_.end()) return it->second;
    const int weight = bold ? FW_SEMIBOLD : FW_NORMAL;
    HFONT font = CreateFontW(-pixelSize, 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                             OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY,
                             DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
    if (!font) {
        font = CreateFontW(-pixelSize, 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                           OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, ANTIALIASED_QUALITY,
                           DEFAULT_PITCH | FF_DONTCARE, L"Segoe UI");
    }
    fonts_[key] = font;
    return font;
}

int Overlay::TextWidthPixels(const std::wstring& text, int pixelSize, bool bold) {
    if (!memoryDC_ || text.empty()) return 0;
    HFONT font = FontFor(pixelSize, bold);
    HGDIOBJ old = SelectObject(memoryDC_, font);
    SIZE size{};
    GetTextExtentPoint32W(memoryDC_, text.c_str(), static_cast<int>(text.size()), &size);
    SelectObject(memoryDC_, old);
    return std::max(0L, size.cx);
}

int Overlay::TextHeightPixels(int pixelSize, bool bold) {
    if (!memoryDC_) return pixelSize;
    HFONT font = FontFor(pixelSize, bold);
    HGDIOBJ old = SelectObject(memoryDC_, font);
    TEXTMETRICW metric{};
    GetTextMetricsW(memoryDC_, &metric);
    SelectObject(memoryDC_, old);
    return std::max<LONG>(1, metric.tmHeight);
}

const Overlay::TextTexture* Overlay::GetTextTexture(const std::wstring& text, int pixelSize, bool bold) {
    if (!initialized_ || !context_ || !memoryDC_ || text.empty()) return nullptr;
    TextKey key;
    key.pixelSize = std::clamp(pixelSize, 7, 96);
    key.bold = bold;
    key.text = text;
    auto it = textCache_.find(key);
    if (it != textCache_.end()) return &it->second;

    const int textW = TextWidthPixels(text, key.pixelSize, key.bold);
    const int textH = TextHeightPixels(key.pixelSize, key.bold);
    if (textW <= 0 || textH <= 0) return nullptr;
    const int pad = std::max(1, static_cast<int>(std::lround(1.5f * dpiScale_)));
    const int bw = textW + pad * 2;
    const int bh = textH + pad * 2;

    BITMAPINFO bmi{};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = bw;
    bmi.bmiHeader.biHeight = -bh;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    void* bits = nullptr;
    HBITMAP bitmap = CreateDIBSection(memoryDC_, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    if (!bitmap || !bits) return nullptr;
    std::memset(bits, 0, static_cast<size_t>(bw) * bh * 4);
    HGDIOBJ oldBitmap = SelectObject(memoryDC_, bitmap);
    HGDIOBJ oldFont = SelectObject(memoryDC_, FontFor(key.pixelSize, key.bold));
    SetBkMode(memoryDC_, TRANSPARENT);
    SetTextColor(memoryDC_, RGB(255, 255, 255));
    SetTextAlign(memoryDC_, TA_LEFT | TA_TOP);
    TextOutW(memoryDC_, pad, pad, text.c_str(), static_cast<int>(text.size()));
    GdiFlush();

    std::vector<unsigned char> alpha(static_cast<size_t>(bw) * bh);
    const auto* pixels = static_cast<const unsigned char*>(bits);
    for (size_t i = 0; i < alpha.size(); ++i) {
        const unsigned char b = pixels[i * 4 + 0];
        const unsigned char g = pixels[i * 4 + 1];
        const unsigned char r = pixels[i * 4 + 2];
        alpha[i] = std::max({b, g, r});
    }
    SelectObject(memoryDC_, oldFont);
    SelectObject(memoryDC_, oldBitmap);
    DeleteObject(bitmap);

    auto& gl = context_->gl;
    GLuint texture = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, bw, bh, 0, GL_RED, GL_UNSIGNED_BYTE, alpha.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glBindTexture(GL_TEXTURE_2D, 0);

    TextTexture entry;
    entry.texture = texture;
    entry.width = bw;
    entry.height = bh;
    entry.textWidth = textW;
    entry.textHeight = textH;
    entry.pad = pad;
    auto inserted = textCache_.emplace(key, entry);
    ++cacheMisses_;
    return &inserted.first->second;
}

void Overlay::Text(const std::wstring& text, float x, float y, float pixelSize, const Color& color,
                   TextAlign align, TextVAlign valign, bool bold) {
    if (!frameActive_ || text.empty() || color.a <= 0.0f) return;
    const int px = std::clamp(static_cast<int>(std::lround(pixelSize)), 7, 96);
    const TextTexture* entry = GetTextTexture(text, px, bold);
    if (!entry) return;
    float left = x;
    if (align == TextAlign::Center) left = x - entry->textWidth * 0.5f;
    else if (align == TextAlign::Right) left = x - entry->textWidth;
    float top = y;
    if (valign == TextVAlign::Middle) top = y - entry->textHeight * 0.5f;
    else if (valign == TextVAlign::Bottom) top = y - entry->textHeight;
    const float drawX = std::round(left) - entry->pad;
    const float drawY = std::round(top) - entry->pad;
    TextCommand command;
    command.texture = entry->texture;
    command.x = drawX;
    command.y = drawY;
    command.w = static_cast<float>(entry->width);
    command.h = static_cast<float>(entry->height);
    command.color = color;
    textCommands_.push_back(command);
    ++cacheHits_;
}

void Overlay::TextUtf8(const std::string& text, float x, float y, float pixelSize, const Color& color,
                       TextAlign align, TextVAlign valign, bool bold) {
    Text(Utf8ToWide(text), x, y, pixelSize, color, align, valign, bold);
}

float Overlay::MeasureText(const std::wstring& text, float pixelSize, bool bold) {
    const int px = std::clamp(static_cast<int>(std::lround(pixelSize)), 7, 96);
    return static_cast<float>(TextWidthPixels(text, px, bold));
}

float Overlay::MeasureTextUtf8(const std::string& text, float pixelSize, bool bold) {
    return MeasureText(Utf8ToWide(text), pixelSize, bold);
}

float Overlay::TextHeight(float pixelSize, bool bold) {
    const int px = std::clamp(static_cast<int>(std::lround(pixelSize)), 7, 96);
    return static_cast<float>(TextHeightPixels(px, bold));
}

void Overlay::FlushPrimitives() {
    if (vertices_.empty()) return;
    auto& gl = context_->gl;
    primProgram_.Use(gl);
    gl.Uniform2f(gl.GetUniformLocation(primProgram_.id(), "uScreen"), static_cast<float>(width_),
                 static_cast<float>(height_));
    gl.BindVertexArray(primVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, primVBO_);
    gl.BufferData(GL_ARRAY_BUFFER,
                  static_cast<GLsizeiptr>(vertices_.size() * sizeof(PrimVertex)), vertices_.data(),
                  GL_DYNAMIC_DRAW);
    gl.DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(vertices_.size()));
}

void Overlay::FlushText() {
    if (textCommands_.empty()) return;
    auto& gl = context_->gl;
    textProgram_.Use(gl);
    gl.Uniform2f(gl.GetUniformLocation(textProgram_.id(), "uScreen"), static_cast<float>(width_),
                 static_cast<float>(height_));
    gl.Uniform1i(gl.GetUniformLocation(textProgram_.id(), "uTex"), 0);
    gl.ActiveTexture(GL_TEXTURE0);
    gl.BindVertexArray(textVAO_);
    for (const TextCommand& command : textCommands_) {
        glBindTexture(GL_TEXTURE_2D, command.texture);
        gl.Uniform2f(gl.GetUniformLocation(textProgram_.id(), "uOrigin"), command.x, command.y);
        gl.Uniform2f(gl.GetUniformLocation(textProgram_.id(), "uSize"), command.w, command.h);
        gl.Uniform4f(gl.GetUniformLocation(textProgram_.id(), "uColor"), command.color.r, command.color.g,
                     command.color.b, command.color.a);
        gl.DrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
    glBindTexture(GL_TEXTURE_2D, 0);
    gl.BindVertexArray(0);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
    gl.UseProgram(0);
}

void Overlay::ClearTextCache() {
    if (context_) {
        for (auto& [key, entry] : textCache_) {
            if (entry.texture) glDeleteTextures(1, &entry.texture);
        }
    }
    textCache_.clear();
}

} // namespace cl

