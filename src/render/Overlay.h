#pragma once

#include "GL.h"

#include <map>
#include <string>
#include <vector>

namespace cl {

struct Color {
    float r = 1.0f, g = 1.0f, b = 1.0f, a = 1.0f;
    Color() = default;
    Color(float r_, float g_, float b_, float a_ = 1.0f) : r(r_), g(g_), b(b_), a(a_) {}
    static Color Hex(uint32_t rgb, float alpha = 1.0f) {
        return Color(((rgb >> 16) & 0xFF) / 255.0f, ((rgb >> 8) & 0xFF) / 255.0f, (rgb & 0xFF) / 255.0f,
                     alpha);
    }
};

enum class TextAlign { Left, Center, Right };
enum class TextVAlign { Top, Middle, Bottom };

class Overlay {
public:
    bool Initialize(GLContext* context, std::string* error);
    void Shutdown();

    void Begin(int width, int height, float dpiScale);
    void End();

    void FillRect(float x, float y, float w, float h, const Color& color);
    void FillRoundedRect(float x, float y, float w, float h, float radius, const Color& color);
    void Panel(float x, float y, float w, float h, float radius, const Color& fill, const Color& border,
               float borderThickness);
    void Line(float x0, float y0, float x1, float y1, float thickness, const Color& color);
    void Circle(float cx, float cy, float radius, const Color& color, int segments = 36);
    void Ring(float cx, float cy, float radius, float thickness, const Color& color, int segments = 36);

    void Text(const std::wstring& text, float x, float y, float pixelSize, const Color& color,
              TextAlign align = TextAlign::Left, TextVAlign valign = TextVAlign::Middle, bool bold = false);
    void TextUtf8(const std::string& text, float x, float y, float pixelSize, const Color& color,
                  TextAlign align = TextAlign::Left, TextVAlign valign = TextVAlign::Middle, bool bold = false);
    float MeasureText(const std::wstring& text, float pixelSize, bool bold = false);
    float MeasureTextUtf8(const std::string& text, float pixelSize, bool bold = false);
    float TextHeight(float pixelSize, bool bold = false);

    bool Ready() const { return initialized_; }

private:
    struct PrimVertex {
        float x, y;
        float r, g, b, a;
    };
    struct TextCommand {
        GLuint texture = 0;
        float x = 0, y = 0, w = 0, h = 0;
        Color color;
    };
    struct TextTexture {
        GLuint texture = 0;
        int width = 0;
        int height = 0;
        int textWidth = 0;
        int textHeight = 0;
        int pad = 0;
    };
    struct TextKey {
        int pixelSize = 0;
        bool bold = false;
        std::wstring text;
        bool operator<(const TextKey& other) const {
            if (pixelSize != other.pixelSize) return pixelSize < other.pixelSize;
            if (bold != other.bold) return bold < other.bold;
            return text < other.text;
        }
    };

    void AddTriangle(float x0, float y0, float x1, float y1, float x2, float y2, const Color& color);
    void PushVertex(float x, float y, const Color& color);
    HFONT FontFor(int pixelSize, bool bold);
    const TextTexture* GetTextTexture(const std::wstring& text, int pixelSize, bool bold);
    int TextWidthPixels(const std::wstring& text, int pixelSize, bool bold);
    int TextHeightPixels(int pixelSize, bool bold);
    void FlushPrimitives();
    void FlushText();
    void ClearTextCache();

    GLContext* context_ = nullptr;
    bool initialized_ = false;
    int width_ = 1;
    int height_ = 1;
    float dpiScale_ = 1.0f;
    bool frameActive_ = false;

    ShaderProgram primProgram_;
    ShaderProgram textProgram_;
    GLuint primVAO_ = 0;
    GLuint primVBO_ = 0;
    GLuint textVAO_ = 0;
    GLuint textVBO_ = 0;
    std::vector<PrimVertex> vertices_;
    std::vector<TextCommand> textCommands_;

    HDC memoryDC_ = nullptr;
    std::map<std::pair<int, bool>, HFONT> fonts_;
    std::map<TextKey, TextTexture> textCache_;
    int cacheHits_ = 0;
    int cacheMisses_ = 0;
};

} // namespace cl
