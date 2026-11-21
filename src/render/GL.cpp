#include "GL.h"

#include <cstring>
#include <sstream>
#include <vector>

namespace cl {
namespace {

#define WGL_DRAW_TO_WINDOW_ARB 0x2001
#define WGL_SUPPORT_OPENGL_ARB 0x2010
#define WGL_DOUBLE_BUFFER_ARB 0x2011
#define WGL_PIXEL_TYPE_ARB 0x2013
#define WGL_TYPE_RGBA_ARB 0x202B
#define WGL_COLOR_BITS_ARB 0x2014
#define WGL_ALPHA_BITS_ARB 0x201B
#define WGL_DEPTH_BITS_ARB 0x2022
#define WGL_STENCIL_BITS_ARB 0x2023
#define WGL_SAMPLE_BUFFERS_ARB 0x2041
#define WGL_SAMPLES_ARB 0x2042
#define WGL_CONTEXT_MAJOR_VERSION_ARB 0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB 0x2092
#define WGL_CONTEXT_PROFILE_MASK_ARB 0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB 0x00000001
#define WGL_CONTEXT_FLAGS_ARB 0x2094
#define WGL_CONTEXT_DEBUG_BIT_ARB 0x00000001

template <typename T>
T LoadGLProc(const char* name) {
    PROC proc = wglGetProcAddress(name);
    if (!proc) {
        const HMODULE module = GetModuleHandleW(L"opengl32.dll");
        if (module) proc = GetProcAddress(module, name);
    }
    return reinterpret_cast<T>(proc);
}

bool LoadAllFuncs(GLFuncs& gl, std::string* error) {
    const char* missing = nullptr;
#define LOAD(field, name)                                                     \
    gl.field = LoadGLProc<GLFuncs::PFN_##field>(name);                        \
    if (!gl.field && !missing) missing = name;
    LOAD(GenBuffers, "glGenBuffers")
    LOAD(DeleteBuffers, "glDeleteBuffers")
    LOAD(BindBuffer, "glBindBuffer")
    LOAD(BufferData, "glBufferData")
    LOAD(BufferSubData, "glBufferSubData")
    LOAD(GenVertexArrays, "glGenVertexArrays")
    LOAD(DeleteVertexArrays, "glDeleteVertexArrays")
    LOAD(BindVertexArray, "glBindVertexArray")
    LOAD(EnableVertexAttribArray, "glEnableVertexAttribArray")
    LOAD(VertexAttribPointer, "glVertexAttribPointer")
    LOAD(VertexAttribDivisor, "glVertexAttribDivisor")
    LOAD(CreateShader, "glCreateShader")
    LOAD(ShaderSource, "glShaderSource")
    LOAD(CompileShader, "glCompileShader")
    LOAD(GetShaderiv, "glGetShaderiv")
    LOAD(GetShaderInfoLog, "glGetShaderInfoLog")
    LOAD(DeleteShader, "glDeleteShader")
    LOAD(CreateProgram, "glCreateProgram")
    LOAD(AttachShader, "glAttachShader")
    LOAD(LinkProgram, "glLinkProgram")
    LOAD(GetProgramiv, "glGetProgramiv")
    LOAD(GetProgramInfoLog, "glGetProgramInfoLog")
    LOAD(DeleteProgram, "glDeleteProgram")
    LOAD(UseProgram, "glUseProgram")
    LOAD(GetUniformLocation, "glGetUniformLocation")
    LOAD(Uniform1i, "glUniform1i")
    LOAD(Uniform1f, "glUniform1f")
    LOAD(Uniform2f, "glUniform2f")
    LOAD(Uniform3f, "glUniform3f")
    LOAD(Uniform4f, "glUniform4f")
    LOAD(UniformMatrix4fv, "glUniformMatrix4fv")
    LOAD(DrawArraysInstanced, "glDrawArraysInstanced")
    LOAD(DrawArrays, "glDrawArrays")
    LOAD(ActiveTexture, "glActiveTexture")
    LOAD(GenerateMipmap, "glGenerateMipmap")
#undef LOAD
    if (missing) {
        if (error) *error = std::string("OpenGL 3.3 函数不可用: ") + missing;
        return false;
    }
    return true;
}

struct Bootstrap {
    HWND hwnd = nullptr;
    HDC hdc = nullptr;
    HGLRC ctx = nullptr;
    PFN_wglCreateContextAttribsARB createContext = nullptr;
    PFN_wglChoosePixelFormatARB chooseFormat = nullptr;
    PFN_wglSwapIntervalEXT swapInterval = nullptr;
};

bool InitBootstrap(Bootstrap& boot, std::string* error) {
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    const wchar_t* className = L"CrystalLensGLBootstrap";
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_OWNDC;
    wc.lpfnWndProc = DefWindowProcW;
    wc.hInstance = instance;
    wc.lpszClassName = className;
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        if (error) *error = "无法注册 OpenGL 引导窗口";
        return false;
    }
    boot.hwnd = CreateWindowExW(0, className, L"", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, instance, nullptr);
    if (!boot.hwnd) {
        if (error) *error = "无法创建 OpenGL 引导窗口";
        return false;
    }
    boot.hdc = GetDC(boot.hwnd);
    PIXELFORMATDESCRIPTOR pfd{};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.cStencilBits = 8;
    const int format = ChoosePixelFormat(boot.hdc, &pfd);
    if (format == 0 || !SetPixelFormat(boot.hdc, format, &pfd)) {
        if (error) *error = "无法设置 OpenGL 像素格式";
        return false;
    }
    boot.ctx = wglCreateContext(boot.hdc);
    if (!boot.ctx || !wglMakeCurrent(boot.hdc, boot.ctx)) {
        if (error) *error = "无法创建 OpenGL 上下文";
        return false;
    }
    boot.createContext = LoadGLProc<PFN_wglCreateContextAttribsARB>("wglCreateContextAttribsARB");
    boot.chooseFormat = LoadGLProc<PFN_wglChoosePixelFormatARB>("wglChoosePixelFormatARB");
    boot.swapInterval = LoadGLProc<PFN_wglSwapIntervalEXT>("wglSwapIntervalEXT");
    if (!boot.createContext) {
        if (error) *error = "显卡驱动不支持 OpenGL 3.3 上下文（缺少 wglCreateContextAttribsARB）";
        return false;
    }
    return true;
}

void ShutdownBootstrap(Bootstrap& boot) {
    if (boot.ctx) {
        wglMakeCurrent(nullptr, nullptr);
        wglDeleteContext(boot.ctx);
        boot.ctx = nullptr;
    }
    if (boot.hdc && boot.hwnd) {
        ReleaseDC(boot.hwnd, boot.hdc);
        boot.hdc = nullptr;
    }
    if (boot.hwnd) {
        DestroyWindow(boot.hwnd);
        boot.hwnd = nullptr;
    }
}

std::string ShaderLog(const GLFuncs& gl, GLuint shader) {
    GLint length = 0;
    gl.GetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
    if (length <= 1) return {};
    std::vector<char> buffer(static_cast<size_t>(length));
    gl.GetShaderInfoLog(shader, length, nullptr, buffer.data());
    return std::string(buffer.data());
}

std::string ProgramLog(const GLFuncs& gl, GLuint program) {
    GLint length = 0;
    gl.GetProgramiv(program, GL_INFO_LOG_LENGTH, &length);
    if (length <= 1) return {};
    std::vector<char> buffer(static_cast<size_t>(length));
    gl.GetProgramInfoLog(program, length, nullptr, buffer.data());
    return std::string(buffer.data());
}

} // namespace

bool GLFuncs::Load() { return LoadAllFuncs(*this, nullptr); }

bool CreateGLContext(HWND hwnd, GLContext& context, std::string* error, int requestedSamples) {
    DestroyGLContext(context);
    if (error) error->clear();
    if (!hwnd) {
        if (error) *error = "无效的窗口句柄";
        return false;
    }
    Bootstrap boot;
    if (!InitBootstrap(boot, error)) {
        ShutdownBootstrap(boot);
        return false;
    }

    context.hdc = GetDC(hwnd);
    if (!context.hdc) {
        if (error) *error = "无法获取窗口设备上下文";
        ShutdownBootstrap(boot);
        return false;
    }
    int samples = requestedSamples >= 2 ? requestedSamples : 0;
    int pixelFormat = 0;
    if (boot.chooseFormat) {
        int attribs[] = {
            WGL_DRAW_TO_WINDOW_ARB, GL_TRUE,
            WGL_SUPPORT_OPENGL_ARB, GL_TRUE,
            WGL_DOUBLE_BUFFER_ARB, GL_TRUE,
            WGL_PIXEL_TYPE_ARB, WGL_TYPE_RGBA_ARB,
            WGL_COLOR_BITS_ARB, 32,
            WGL_ALPHA_BITS_ARB, 8,
            WGL_DEPTH_BITS_ARB, 24,
            WGL_STENCIL_BITS_ARB, 8,
            WGL_SAMPLE_BUFFERS_ARB, samples > 0 ? 1 : 0,
            WGL_SAMPLES_ARB, samples,
            0
        };
        UINT numFormats = 0;
        if (!boot.chooseFormat(context.hdc, attribs, nullptr, 1, &pixelFormat, &numFormats) ||
            numFormats == 0 || pixelFormat == 0) {
            samples = 0;
            attribs[16] = 0; // WGL_SAMPLE_BUFFERS_ARB
            attribs[18] = 0; // WGL_SAMPLES_ARB
            numFormats = 0;
            if (!boot.chooseFormat(context.hdc, attribs, nullptr, 1, &pixelFormat, &numFormats) ||
                numFormats == 0) {
                pixelFormat = 0;
            }
        }
    }
    PIXELFORMATDESCRIPTOR pfd{};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.cStencilBits = 8;
    if (pixelFormat == 0) {
        pixelFormat = ChoosePixelFormat(context.hdc, &pfd);
        samples = 0;
    }
    if (pixelFormat == 0) {
        if (error) *error = "没有可用的 OpenGL 像素格式";
        ReleaseDC(hwnd, context.hdc);
        context.hdc = nullptr;
        ShutdownBootstrap(boot);
        return false;
    }
    DescribePixelFormat(context.hdc, pixelFormat, sizeof(pfd), &pfd);
    if (!SetPixelFormat(context.hdc, pixelFormat, &pfd)) {
        if (error) *error = "无法设置窗口 OpenGL 像素格式";
        ReleaseDC(hwnd, context.hdc);
        context.hdc = nullptr;
        ShutdownBootstrap(boot);
        return false;
    }

    int flags = 0;
#ifdef _DEBUG
    flags |= WGL_CONTEXT_DEBUG_BIT_ARB;
#endif
    const int ctxAttribs[] = {
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        WGL_CONTEXT_FLAGS_ARB, flags,
        0
    };
    context.hglrc = boot.createContext(context.hdc, nullptr, ctxAttribs);
    if (!context.hglrc && flags != 0) {
        const int fallbackAttribs[] = {
            WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
            WGL_CONTEXT_MINOR_VERSION_ARB, 3,
            WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
            0
        };
        context.hglrc = boot.createContext(context.hdc, nullptr, fallbackAttribs);
    }
    if (!context.hglrc) {
        if (error) *error = "无法创建 OpenGL 3.3 Core 上下文，请更新显卡驱动";
        ReleaseDC(hwnd, context.hdc);
        context.hdc = nullptr;
        ShutdownBootstrap(boot);
        return false;
    }
    wglMakeCurrent(context.hdc, context.hglrc);
    if (!LoadAllFuncs(context.gl, error)) {
        DestroyGLContext(context);
        ShutdownBootstrap(boot);
        return false;
    }
    context.hwnd = hwnd;
    context.samples = samples;
    context.SwapInterval = boot.swapInterval;
    if (context.SwapInterval) context.SwapInterval(1);

    const auto version = reinterpret_cast<const char*>(glGetString(GL_VERSION));
    const auto renderer = reinterpret_cast<const char*>(glGetString(GL_RENDERER));
    const auto vendor = reinterpret_cast<const char*>(glGetString(GL_VENDOR));
    const auto glsl = reinterpret_cast<const char*>(glGetString(0x8B8C));
    context.version = version ? version : "?";
    context.renderer = renderer ? renderer : "?";
    context.vendor = vendor ? vendor : "?";
    context.glsl = glsl ? glsl : "?";
    context.valid = true;

    glEnable(GL_MULTISAMPLE);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    glDisable(GL_CULL_FACE);
    ShutdownBootstrap(boot);
    // ShutdownBootstrap unbinds the bootstrap context; restore the real one.
    if (!wglMakeCurrent(context.hdc, context.hglrc)) {
        if (error) *error = "无法激活 OpenGL 渲染上下文";
        DestroyGLContext(context);
        return false;
    }
    return true;
}

void DestroyGLContext(GLContext& context) {
    if (context.hglrc) {
        wglMakeCurrent(nullptr, nullptr);
        wglDeleteContext(context.hglrc);
        context.hglrc = nullptr;
    }
    if (context.hdc && context.hwnd) {
        ReleaseDC(context.hwnd, context.hdc);
    }
    context.hdc = nullptr;
    context.hwnd = nullptr;
    context.valid = false;
    context.SwapInterval = nullptr;
}

std::string GLErrorText(unsigned int code) {
    switch (code) {
    case GL_NO_ERROR: return "GL_NO_ERROR";
    case GL_INVALID_ENUM: return "GL_INVALID_ENUM";
    case GL_INVALID_VALUE: return "GL_INVALID_VALUE";
    case GL_INVALID_OPERATION: return "GL_INVALID_OPERATION";
    case GL_OUT_OF_MEMORY: return "GL_OUT_OF_MEMORY";
    case GL_INVALID_FRAMEBUFFER_OPERATION: return "GL_INVALID_FRAMEBUFFER_OPERATION";
    default: return "GL_ERROR_" + std::to_string(code);
    }
}

ShaderProgram::~ShaderProgram() {
    // The GL context owns these objects; Renderer::Shutdown destroys programs
    // while the context is still current. Never touch GL from this destructor.
    program_ = 0;
}

bool ShaderProgram::Build(const GLFuncs& gl, const char* vertexSource, const char* fragmentSource,
                          const char* geometrySource, std::string* error) {
    Destroy();
    auto compile = [&](GLenum type, const char* source) -> GLuint {
        if (!source) return 0;
        const GLuint shader = gl.CreateShader(type);
        gl.ShaderSource(shader, 1, &source, nullptr);
        gl.CompileShader(shader);
        GLint ok = GL_FALSE;
        gl.GetShaderiv(shader, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            if (error) {
                *error = "着色器编译失败: ";
                *error += ShaderLog(gl, shader);
            }
            gl.DeleteShader(shader);
            return 0;
        }
        return shader;
    };

    const GLuint vs = compile(GL_VERTEX_SHADER, vertexSource);
    if (!vs) return false;
    const GLuint fs = compile(GL_FRAGMENT_SHADER, fragmentSource);
    if (!fs) {
        gl.DeleteShader(vs);
        return false;
    }
    const GLuint gs = geometrySource ? compile(GL_GEOMETRY_SHADER, geometrySource) : 0;
    if (geometrySource && !gs) {
        gl.DeleteShader(vs);
        gl.DeleteShader(fs);
        return false;
    }
    const GLuint program = gl.CreateProgram();
    gl.AttachShader(program, vs);
    gl.AttachShader(program, fs);
    if (gs) gl.AttachShader(program, gs);
    gl.LinkProgram(program);
    gl.DeleteShader(vs);
    gl.DeleteShader(fs);
    if (gs) gl.DeleteShader(gs);
    GLint linked = GL_FALSE;
    gl.GetProgramiv(program, GL_LINK_STATUS, &linked);
    if (!linked) {
        if (error) {
            *error = "着色器链接失败: ";
            *error += ProgramLog(gl, program);
        }
        gl.DeleteProgram(program);
        return false;
    }
    program_ = program;
    gl_ = &gl;
    return true;
}

void ShaderProgram::Destroy() {
    if (program_ && gl_) {
        // Caller keeps the context current while shutting the renderer down.
        gl_->DeleteProgram(program_);
        program_ = 0;
    }
}

} // namespace cl
