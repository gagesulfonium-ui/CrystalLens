#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <GL/gl.h>

#include <cstddef>
#include <string>

namespace cl {

#ifndef GL_VERSION_2_0
typedef char GLchar;
typedef ptrdiff_t GLsizeiptr;
typedef ptrdiff_t GLintptr;
#endif

#ifndef GL_ARRAY_BUFFER
#define GL_ARRAY_BUFFER 0x8892
#define GL_ELEMENT_ARRAY_BUFFER 0x8893
#define GL_STATIC_DRAW 0x88E4
#define GL_DYNAMIC_DRAW 0x88E8
#define GL_VERTEX_SHADER 0x8B31
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_GEOMETRY_SHADER 0x8DD9
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_INFO_LOG_LENGTH 0x8B84
#define GL_TEXTURE0 0x84C0
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_MULTISAMPLE 0x809D
#define GL_MAJOR_VERSION 0x821B
#define GL_MINOR_VERSION 0x821C
#define GL_NUM_EXTENSIONS 0x821D
#endif
#ifndef GL_INVALID_FRAMEBUFFER_OPERATION
#define GL_INVALID_FRAMEBUFFER_OPERATION 0x0506
#endif
#ifndef GL_SAMPLE_ALPHA_TO_COVERAGE
#define GL_SAMPLE_ALPHA_TO_COVERAGE 0x809E
#endif
#ifndef GL_R8
#define GL_R8 0x8229
#endif
#ifndef GL_RED
#define GL_RED 0x1903
#endif

struct GLFuncs {
    typedef void(APIENTRY* PFN_GenBuffers)(GLsizei, GLuint*);
    typedef void(APIENTRY* PFN_DeleteBuffers)(GLsizei, const GLuint*);
    typedef void(APIENTRY* PFN_BindBuffer)(GLenum, GLuint);
    typedef void(APIENTRY* PFN_BufferData)(GLenum, GLsizeiptr, const void*, GLenum);
    typedef void(APIENTRY* PFN_BufferSubData)(GLenum, GLintptr, GLsizeiptr, const void*);
    typedef void(APIENTRY* PFN_GenVertexArrays)(GLsizei, GLuint*);
    typedef void(APIENTRY* PFN_DeleteVertexArrays)(GLsizei, const GLuint*);
    typedef void(APIENTRY* PFN_BindVertexArray)(GLuint);
    typedef void(APIENTRY* PFN_EnableVertexAttribArray)(GLuint);
    typedef void(APIENTRY* PFN_VertexAttribPointer)(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*);
    typedef void(APIENTRY* PFN_VertexAttribDivisor)(GLuint, GLuint);
    typedef GLuint(APIENTRY* PFN_CreateShader)(GLenum);
    typedef void(APIENTRY* PFN_ShaderSource)(GLuint, GLsizei, const GLchar* const*, const GLint*);
    typedef void(APIENTRY* PFN_CompileShader)(GLuint);
    typedef void(APIENTRY* PFN_GetShaderiv)(GLuint, GLenum, GLint*);
    typedef void(APIENTRY* PFN_GetShaderInfoLog)(GLuint, GLsizei, GLsizei*, GLchar*);
    typedef void(APIENTRY* PFN_DeleteShader)(GLuint);
    typedef GLuint(APIENTRY* PFN_CreateProgram)();
    typedef void(APIENTRY* PFN_AttachShader)(GLuint, GLuint);
    typedef void(APIENTRY* PFN_LinkProgram)(GLuint);
    typedef void(APIENTRY* PFN_GetProgramiv)(GLuint, GLenum, GLint*);
    typedef void(APIENTRY* PFN_GetProgramInfoLog)(GLuint, GLsizei, GLsizei*, GLchar*);
    typedef void(APIENTRY* PFN_DeleteProgram)(GLuint);
    typedef void(APIENTRY* PFN_UseProgram)(GLuint);
    typedef GLint(APIENTRY* PFN_GetUniformLocation)(GLuint, const GLchar*);
    typedef void(APIENTRY* PFN_Uniform1i)(GLint, GLint);
    typedef void(APIENTRY* PFN_Uniform1f)(GLint, GLfloat);
    typedef void(APIENTRY* PFN_Uniform2f)(GLint, GLfloat, GLfloat);
    typedef void(APIENTRY* PFN_Uniform3f)(GLint, GLfloat, GLfloat, GLfloat);
    typedef void(APIENTRY* PFN_Uniform4f)(GLint, GLfloat, GLfloat, GLfloat, GLfloat);
    typedef void(APIENTRY* PFN_UniformMatrix4fv)(GLint, GLsizei, GLboolean, const GLfloat*);
    typedef void(APIENTRY* PFN_DrawArraysInstanced)(GLenum, GLint, GLsizei, GLsizei);
    typedef void(APIENTRY* PFN_DrawArrays)(GLenum, GLint, GLsizei);
    typedef void(APIENTRY* PFN_ActiveTexture)(GLenum);
    typedef void(APIENTRY* PFN_GenerateMipmap)(GLenum);

    PFN_GenBuffers GenBuffers = nullptr;
    PFN_DeleteBuffers DeleteBuffers = nullptr;
    PFN_BindBuffer BindBuffer = nullptr;
    PFN_BufferData BufferData = nullptr;
    PFN_BufferSubData BufferSubData = nullptr;
    PFN_GenVertexArrays GenVertexArrays = nullptr;
    PFN_DeleteVertexArrays DeleteVertexArrays = nullptr;
    PFN_BindVertexArray BindVertexArray = nullptr;
    PFN_EnableVertexAttribArray EnableVertexAttribArray = nullptr;
    PFN_VertexAttribPointer VertexAttribPointer = nullptr;
    PFN_VertexAttribDivisor VertexAttribDivisor = nullptr;
    PFN_CreateShader CreateShader = nullptr;
    PFN_ShaderSource ShaderSource = nullptr;
    PFN_CompileShader CompileShader = nullptr;
    PFN_GetShaderiv GetShaderiv = nullptr;
    PFN_GetShaderInfoLog GetShaderInfoLog = nullptr;
    PFN_DeleteShader DeleteShader = nullptr;
    PFN_CreateProgram CreateProgram = nullptr;
    PFN_AttachShader AttachShader = nullptr;
    PFN_LinkProgram LinkProgram = nullptr;
    PFN_GetProgramiv GetProgramiv = nullptr;
    PFN_GetProgramInfoLog GetProgramInfoLog = nullptr;
    PFN_DeleteProgram DeleteProgram = nullptr;
    PFN_UseProgram UseProgram = nullptr;
    PFN_GetUniformLocation GetUniformLocation = nullptr;
    PFN_Uniform1i Uniform1i = nullptr;
    PFN_Uniform1f Uniform1f = nullptr;
    PFN_Uniform2f Uniform2f = nullptr;
    PFN_Uniform3f Uniform3f = nullptr;
    PFN_Uniform4f Uniform4f = nullptr;
    PFN_UniformMatrix4fv UniformMatrix4fv = nullptr;
    PFN_DrawArraysInstanced DrawArraysInstanced = nullptr;
    PFN_DrawArrays DrawArrays = nullptr;
    PFN_ActiveTexture ActiveTexture = nullptr;
    PFN_GenerateMipmap GenerateMipmap = nullptr;

    bool Load();
};

typedef HGLRC(WINAPI* PFN_wglCreateContextAttribsARB)(HDC, HGLRC, const int*);
typedef BOOL(WINAPI* PFN_wglChoosePixelFormatARB)(HDC, const int*, const FLOAT*, UINT, int*, UINT*);
typedef BOOL(WINAPI* PFN_wglSwapIntervalEXT)(int);

struct GLContext {
    HWND hwnd = nullptr;
    HDC hdc = nullptr;
    HGLRC hglrc = nullptr;
    GLFuncs gl;
    PFN_wglSwapIntervalEXT SwapInterval = nullptr;
    int samples = 0;
    std::string version;
    std::string renderer;
    std::string vendor;
    std::string glsl;
    bool valid = false;
};

bool CreateGLContext(HWND hwnd, GLContext& context, std::string* error, int requestedSamples = 4);
void DestroyGLContext(GLContext& context);
std::string GLErrorText(unsigned int code);

class ShaderProgram {
public:
    ShaderProgram() = default;
    ~ShaderProgram();
    ShaderProgram(const ShaderProgram&) = delete;
    ShaderProgram& operator=(const ShaderProgram&) = delete;

    bool Build(const GLFuncs& gl, const char* vertexSource, const char* fragmentSource,
               const char* geometrySource, std::string* error);
    void Destroy();
    void Use(const GLFuncs& gl) const { gl.UseProgram(program_); }
    GLuint id() const { return program_; }
    bool valid() const { return program_ != 0; }

private:
    GLuint program_ = 0;
    const GLFuncs* gl_ = nullptr;
};

} // namespace cl
