#include "Renderer.h"
#include "PolyhedronMesh.h"

#include "core/PeriodicTable.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <set>
#include <tuple>
#include <map>
#include <vector>

namespace cl {
namespace {

bool IsLigandElement(int z) {
    return z == 7 || z == 8 || z == 9 || z == 16 || z == 17 || z == 34 || z == 35 || z == 53;
}

bool IsAlkaliElement(int z) {
    return z == 3 || z == 4 || z == 11 || z == 12 || z == 19 || z == 20 || z == 37 || z == 38 ||
           z == 55 || z == 56 || z == 87 || z == 88;
}

bool IsPolyhedronCenter(int z) { return !IsLigandElement(z) && !IsAlkaliElement(z); }

const char* kAtomVertex = R"GLSL(
#version 330 core
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aCenter;
layout(location = 2) in float aRadius;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aFlags;
layout(location = 5) in float aIndex;

uniform mat4 uView;
uniform mat4 uProj;
uniform int uHovered;
uniform int uSelected0;
uniform int uSelected1;
uniform int uSelected2;

out vec3 vCenterView;
out vec2 vLocal;
out vec3 vColor;
out float vFlags;
out float vRadius;

void main() {
    vec3 centerView = (uView * vec4(aCenter, 1.0)).xyz;
    vec3 pos = centerView + vec3(aCorner.x * aRadius, aCorner.y * aRadius, 0.0);
    gl_Position = uProj * vec4(pos, 1.0);
    vCenterView = centerView;
    vLocal = aCorner;
    vColor = aColor;
    vRadius = aRadius;

    int flags = int(aFlags + 0.5);
    int index = int(aIndex);
    if (index >= 0) {
        if (index == uHovered) flags |= 2;
        if (index == uSelected0 || index == uSelected1 || index == uSelected2) flags |= 1;
    }
    vFlags = float(flags);
}
)GLSL";

const char* kAtomFragment = R"GLSL(
#version 330 core
in vec3 vCenterView;
in vec2 vLocal;
in vec3 vColor;
in float vFlags;
in float vRadius;

uniform mat4 uProj;
out vec4 FragColor;

void main() {
    float r2 = dot(vLocal, vLocal);
    if (r2 > 1.0) discard;
    float z = sqrt(max(0.0, 1.0 - r2));
    vec3 n = normalize(vec3(vLocal, z));
    vec3 viewPos = vCenterView + vec3(vLocal, z) * vRadius;
    vec4 clip = uProj * vec4(viewPos, 1.0);
    if (clip.w <= 0.0) discard;
    gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);

    vec3 key = normalize(vec3(-0.42, 0.50, 0.76));
    vec3 fill = normalize(vec3(0.55, -0.18, 0.58));
    float diffuse = max(dot(n, key), 0.0);
    float fillLight = max(dot(n, fill), 0.0);
    vec3 keyHalf = normalize(key + vec3(0.0, 0.0, 1.0));
    vec3 fillHalf = normalize(fill + vec3(0.0, 0.0, 1.0));
    float specular = pow(max(dot(n, keyHalf), 0.0), 64.0);
    float softSpecular = pow(max(dot(n, fillHalf), 0.0), 16.0);

    vec3 base = vColor;
    vec3 color = base * (0.24 + 0.80 * diffuse) + base * 0.16 * fillLight;
    color += vec3(1.0, 0.96, 0.88) * specular * 0.30;
    color += base * softSpecular * 0.07;
    float rim = pow(1.0 - z, 3.0);
    color += base * rim * 0.12 + vec3(0.10, 0.18, 0.26) * rim * 0.07;

    int flags = int(vFlags + 0.5);
    if ((flags & 1) != 0) {
        float ring = smoothstep(0.38, 0.92, 1.0 - z);
        color = mix(color, vec3(1.0, 0.80, 0.30), ring * 0.90);
        color += vec3(0.22, 0.15, 0.03) * rim;
    } else if ((flags & 2) != 0) {
        color = mix(color, vec3(0.62, 0.86, 1.0), rim * 0.55);
        color *= 1.08;
    }

    float alpha = smoothstep(0.0, 0.075, 1.0 - r2);
    if ((flags & 4) != 0) {
        color = mix(color, vec3(0.085, 0.115, 0.155), 0.22);
        alpha *= 0.36;
    }
    FragColor = vec4(color, alpha);
}
)GLSL";

const char* kLineVertex = R"GLSL(
#version 330 core
layout(location = 1) in vec3 aP0;
layout(location = 2) in vec3 aP1;
layout(location = 3) in float aRadius;
layout(location = 4) in vec3 aC0;
layout(location = 5) in vec3 aC1;
layout(location = 6) in float aFlags;

out vec3 gP0;
out vec3 gP1;
out float gRadius;
out vec3 gC0;
out vec3 gC1;
out float gFlags;

void main() {
    gP0 = aP0;
    gP1 = aP1;
    gRadius = aRadius;
    gC0 = aC0;
    gC1 = aC1;
    gFlags = aFlags;
    gl_Position = vec4(0.0);
}
)GLSL";

const char* kLineGeometry = R"GLSL(
#version 330 core
layout(lines) in;
layout(triangle_strip, max_vertices = 14) out;

in vec3 gP0[];
in vec3 gP1[];
in float gRadius[];
in vec3 gC0[];
in vec3 gC1[];
in float gFlags[];

uniform mat4 uView;
uniform mat4 uProj;

out vec3 vNormal;
out vec3 vC0;
out vec3 vC1;
out float vT;
out float vFlags;

void main() {
    vec3 p0 = gP0[0];
    vec3 p1 = gP1[0];
    float radius = gRadius[0];
    vec3 segment = p1 - p0;
    float segmentLength = length(segment);
    if (segmentLength < 1e-7 || radius <= 0.0) return;
    vec3 axis = segment / segmentLength;

    vec3 reference = abs(axis.z) < 0.85 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(axis, reference));
    vec3 up = normalize(cross(side, axis));
    mat3 normalMatrix = mat3(uView);
    vec4 viewP0 = uView * vec4(p0, 1.0);
    vec4 viewP1 = uView * vec4(p1, 1.0);

    // Emit a closed tube. The final ring repeats the first one, so the strip
    // has no crack. Smooth per-vertex normals make even six sides read as a
    // round cylinder at normal viewing sizes.
    for (int i = 0; i <= 6; ++i) {
        float angle = 6.28318530718 * float(i) / 6.0;
        vec3 normal = side * cos(angle) + up * sin(angle);
        for (int end = 0; end < 2; ++end) {
            vNormal = normalMatrix * normal;
            vC0 = gC0[0];
            vC1 = gC1[0];
            vFlags = gFlags[0];
            vT = float(end);
            vec4 endpoint = end == 0 ? viewP0 : viewP1;
            gl_Position = uProj * (endpoint + vec4(vNormal * radius, 0.0));
            EmitVertex();
        }
    }
}
)GLSL";

const char* kLineFragment = R"GLSL(
#version 330 core
in vec3 vNormal;
in vec3 vC0;
in vec3 vC1;
in float vT;
in float vFlags;

uniform float uOverlayAlpha;
out vec4 FragColor;

void main() {
    if (uOverlayAlpha < 1.0 && (int(vFlags + 0.5) & 4) != 0) discard;
    if ((int(vFlags + 0.5) & 1) != 0) {
        if (fract(vT * 15.0) > 0.58) discard;
    }
    vec3 normal = normalize(vNormal);
    vec3 key = normalize(vec3(-0.42, 0.50, 0.76));
    vec3 fill = normalize(vec3(0.55, -0.18, 0.58));
    vec3 base = mix(vC0, vC1, clamp(vT, 0.0, 1.0));
    float diffuse = max(dot(normal, key), 0.0);
    float fillLight = max(dot(normal, fill), 0.0);
    vec3 color = base * (0.28 + 0.80 * diffuse) + base * 0.16 * fillLight;
    vec3 halfDir = normalize(key + vec3(0.0, 0.0, 1.0));
    float specular = pow(max(dot(normal, halfDir), 0.0), 48.0);
    color += vec3(1.0, 0.97, 0.92) * specular * 0.22;
    float rim = pow(1.0 - max(normal.z, 0.0), 3.0);
    color += base * rim * 0.09;
    if ((int(vFlags + 0.5) & 2) != 0) {
        color = mix(base, color, 0.30);
        if ((int(vFlags + 0.5) & 4) != 0) color *= 0.57;
    }
    FragColor = vec4(color, uOverlayAlpha);
}
)GLSL";

const char* kBackgroundVertex = R"GLSL(
#version 330 core
out vec2 vUV;
void main() {
    vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
    gl_Position = vec4(p, 0.0, 1.0);
    vUV = p * 0.5 + 0.5;
}
)GLSL";

const char* kBackgroundFragment = R"GLSL(
#version 330 core
in vec2 vUV;
uniform vec2 uResolution;
uniform vec3 uBackgroundColor;
out vec4 FragColor;

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec3 base = uBackgroundColor;
    vec3 color = base * (0.55 + 0.55 * pow(clamp(uv.y, 0.0, 1.0), 0.82));

    vec2 glow = (uv - vec2(0.60, 0.50)) * vec2(aspect, 1.0);
    color += base * 0.45 * exp(-dot(glow, glow) * 3.5);

    float vignette = length((uv - 0.5) * vec2(aspect, 1.0));
    color *= 1.0 - 0.22 * smoothstep(0.35, 1.05, vignette);
    FragColor = vec4(color, 1.0);
}
)GLSL";

const char* kPolyVertex = R"GLSL(
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec3 aBary;

uniform mat4 uView;
uniform mat4 uProj;

out vec3 vNormal;
out vec3 vColor;
noperspective out vec3 vBary;

void main() {
    vec3 viewPos = (uView * vec4(aPosition, 1.0)).xyz;
    gl_Position = uProj * vec4(viewPos, 1.0);
    vNormal = mat3(uView) * aNormal;
    vColor = aColor;
    vBary = aBary;
}
)GLSL";

const char* kPolyFragment = R"GLSL(
#version 330 core
in vec3 vNormal;
in vec3 vColor;
noperspective in vec3 vBary;

uniform float uAlpha;
uniform float uEdgeWidth;
uniform vec3 uEdgeColor;
out vec4 FragColor;

void main() {
    vec3 normal = normalize(vNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 key = normalize(vec3(-0.42, 0.50, 0.76));
    vec3 fill = normalize(vec3(0.55, -0.18, 0.58));
    float diffuse = max(dot(normal, key), 0.0);
    float fillLight = max(dot(normal, fill), 0.0);
    vec3 color = vColor * (0.34 + 0.66 * diffuse) + vColor * 0.18 * fillLight;
    vec3 gradient = sqrt(dFdx(vBary)*dFdx(vBary) + dFdy(vBary)*dFdy(vBary));
    vec3 dist = vBary / max(gradient, vec3(1e-7));
    float pixels = min(dist.x, min(dist.y, dist.z));
    float edge = uEdgeWidth > 0.0 ? clamp(0.5*uEdgeWidth + 0.5 - pixels, 0.0, 1.0) : 0.0;
    float alpha = edge + (1.0-edge)*uAlpha;
    if (alpha <= 0.0) discard;
    FragColor = vec4(mix(color*uAlpha, uEdgeColor, edge) / alpha, alpha);
}
)GLSL";

const float kGold[3] = {1.00f, 0.76f, 0.28f};
const float kCyan[3] = {0.38f, 0.83f, 1.00f};

} // namespace

bool FitsSupercell(const Structure& s, int copies) {
    return copies == 1 || (s.atoms.size() * copies <= 65536 && s.bonds.size() * copies <= 300000);
}

bool Renderer::Initialize(GLContext* context, std::string* error) {
    Shutdown();
    context_ = context;
    if (!context_ || !context_->valid) {
        if (error) *error = "OpenGL 上下文无效";
        return false;
    }
    std::string buildError;
    if (!atomProgram_.Build(context_->gl, kAtomVertex, kAtomFragment, nullptr, &buildError) ||
        !lineProgram_.Build(context_->gl, kLineVertex, kLineFragment, kLineGeometry, &buildError) ||
        !backgroundProgram_.Build(context_->gl, kBackgroundVertex, kBackgroundFragment, nullptr,
                                  &buildError) ||
        !polyProgram_.Build(context_->gl, kPolyVertex, kPolyFragment, nullptr, &buildError)) {
        if (error) *error = "无法创建晶体的渲染着色器: " + buildError;
        Shutdown();
        return false;
    }

    auto& gl = context_->gl;
    atomViewLoc_ = gl.GetUniformLocation(atomProgram_.id(), "uView");
    atomProjLoc_ = gl.GetUniformLocation(atomProgram_.id(), "uProj");
    atomHoveredLoc_ = gl.GetUniformLocation(atomProgram_.id(), "uHovered");
    atomSelectedLoc_[0] = gl.GetUniformLocation(atomProgram_.id(), "uSelected0");
    atomSelectedLoc_[1] = gl.GetUniformLocation(atomProgram_.id(), "uSelected1");
    atomSelectedLoc_[2] = gl.GetUniformLocation(atomProgram_.id(), "uSelected2");
    lineViewLoc_ = gl.GetUniformLocation(lineProgram_.id(), "uView");
    lineProjLoc_ = gl.GetUniformLocation(lineProgram_.id(), "uProj");
    lineOverlayLoc_ = gl.GetUniformLocation(lineProgram_.id(), "uOverlayAlpha");
    backgroundResolutionLoc_ = gl.GetUniformLocation(backgroundProgram_.id(), "uResolution");
    backgroundColorLoc_ = gl.GetUniformLocation(backgroundProgram_.id(), "uBackgroundColor");
    polyViewLoc_ = gl.GetUniformLocation(polyProgram_.id(), "uView");
    polyProjLoc_ = gl.GetUniformLocation(polyProgram_.id(), "uProj");
    polyEdgeWidthLoc_ = gl.GetUniformLocation(polyProgram_.id(), "uEdgeWidth");
    polyEdgeColorLoc_ = gl.GetUniformLocation(polyProgram_.id(), "uEdgeColor");
    polyAlphaLoc_ = gl.GetUniformLocation(polyProgram_.id(), "uAlpha");

    gl.GenVertexArrays(1, &atomVAO_);
    gl.GenBuffers(1, &atomVBO_);
    gl.GenBuffers(1, &quadVBO_);

    static const float quad[] = {-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1};
    gl.BindVertexArray(atomVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, quadVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
    gl.EnableVertexAttribArray(0);
    gl.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), nullptr);

    gl.BindBuffer(GL_ARRAY_BUFFER, atomVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, 0, nullptr, GL_DYNAMIC_DRAW);
    gl.EnableVertexAttribArray(1);
    gl.VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, x)));
    gl.VertexAttribDivisor(1, 1);
    gl.EnableVertexAttribArray(2);
    gl.VertexAttribPointer(2, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, radius)));
    gl.VertexAttribDivisor(2, 1);
    gl.EnableVertexAttribArray(3);
    gl.VertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, r)));
    gl.VertexAttribDivisor(3, 1);
    gl.EnableVertexAttribArray(4);
    gl.VertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, flags)));
    gl.VertexAttribDivisor(4, 1);
    gl.EnableVertexAttribArray(5);
    gl.VertexAttribPointer(5, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, index)));
    gl.VertexAttribDivisor(5, 1);

    gl.GenVertexArrays(1, &ghostVAO_);
    gl.GenBuffers(1, &ghostVBO_);
    gl.BindVertexArray(ghostVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, quadVBO_);
    gl.EnableVertexAttribArray(0);
    gl.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), nullptr);
    gl.BindBuffer(GL_ARRAY_BUFFER, ghostVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, 0, nullptr, GL_DYNAMIC_DRAW);
    gl.EnableVertexAttribArray(1);
    gl.VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, x)));
    gl.VertexAttribDivisor(1, 1);
    gl.EnableVertexAttribArray(2);
    gl.VertexAttribPointer(2, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, radius)));
    gl.VertexAttribDivisor(2, 1);
    gl.EnableVertexAttribArray(3);
    gl.VertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, r)));
    gl.VertexAttribDivisor(3, 1);
    gl.EnableVertexAttribArray(4);
    gl.VertexAttribPointer(4, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, flags)));
    gl.VertexAttribDivisor(4, 1);
    gl.EnableVertexAttribArray(5);
    gl.VertexAttribPointer(5, 1, GL_FLOAT, GL_FALSE, sizeof(AtomInstance),
                           reinterpret_cast<const void*>(offsetof(AtomInstance, index)));
    gl.VertexAttribDivisor(5, 1);

    gl.GenVertexArrays(1, &lineVAO_);
    gl.GenBuffers(1, &lineVBO_);
    gl.BindVertexArray(lineVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, lineVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, 0, nullptr, GL_DYNAMIC_DRAW);
    gl.EnableVertexAttribArray(1);
    gl.VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, p0x)));
    gl.VertexAttribDivisor(1, 1);
    gl.EnableVertexAttribArray(2);
    gl.VertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, p1x)));
    gl.VertexAttribDivisor(2, 1);
    gl.EnableVertexAttribArray(3);
    gl.VertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, radius)));
    gl.VertexAttribDivisor(3, 1);
    gl.EnableVertexAttribArray(4);
    gl.VertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, c0r)));
    gl.VertexAttribDivisor(4, 1);
    gl.EnableVertexAttribArray(5);
    gl.VertexAttribPointer(5, 3, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, c1r)));
    gl.VertexAttribDivisor(5, 1);
    gl.EnableVertexAttribArray(6);
    gl.VertexAttribPointer(6, 1, GL_FLOAT, GL_FALSE, sizeof(LineInstance),
                           reinterpret_cast<const void*>(offsetof(LineInstance, flags)));
    gl.VertexAttribDivisor(6, 1);

    gl.GenVertexArrays(1, &polyVAO_);
    gl.GenBuffers(1, &polyVBO_);
    gl.BindVertexArray(polyVAO_);
    gl.BindBuffer(GL_ARRAY_BUFFER, polyVBO_);
    gl.BufferData(GL_ARRAY_BUFFER, 0, nullptr, GL_DYNAMIC_DRAW);
    gl.EnableVertexAttribArray(0);
    gl.VertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(PolyVertex),
                           reinterpret_cast<const void*>(offsetof(PolyVertex, px)));
    gl.EnableVertexAttribArray(1);
    gl.VertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(PolyVertex),
                           reinterpret_cast<const void*>(offsetof(PolyVertex, nx)));
    gl.EnableVertexAttribArray(2);
    gl.VertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, sizeof(PolyVertex),
                           reinterpret_cast<const void*>(offsetof(PolyVertex, r)));

    gl.EnableVertexAttribArray(3);
    gl.VertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, sizeof(PolyVertex),
                           reinterpret_cast<const void*>(offsetof(PolyVertex, bary)));
    gl.GenBuffers(1, &polyIndexBuffer_);
    gl.BindBuffer(GL_ELEMENT_ARRAY_BUFFER, polyIndexBuffer_);

    gl.GenVertexArrays(1, &emptyVAO_);
    gl.BindVertexArray(0);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
    initialized_ = true;
    return true;
}

void Renderer::Shutdown() {
    if (!context_) {
        initialized_ = false;
        return;
    }
    auto& gl = context_->gl;
    if (gl.DeleteProgram) {
        atomProgram_.Destroy();
        lineProgram_.Destroy();
        backgroundProgram_.Destroy();
        polyProgram_.Destroy();
    }
    if (atomVBO_) gl.DeleteBuffers(1, &atomVBO_);
    if (ghostVBO_) gl.DeleteBuffers(1, &ghostVBO_);
    if (quadVBO_) gl.DeleteBuffers(1, &quadVBO_);
    if (lineVBO_) gl.DeleteBuffers(1, &lineVBO_);
    if (atomVAO_) gl.DeleteVertexArrays(1, &atomVAO_);
    if (ghostVAO_) gl.DeleteVertexArrays(1, &ghostVAO_);
    if (lineVAO_) gl.DeleteVertexArrays(1, &lineVAO_);
    if (polyIndexBuffer_) gl.DeleteBuffers(1, &polyIndexBuffer_);
    if (polyVBO_) gl.DeleteBuffers(1, &polyVBO_);
    if (polyVAO_) gl.DeleteVertexArrays(1, &polyVAO_);
    polyIndexBuffer_ = polyVBO_ = polyVAO_ = 0;
    if (emptyVAO_) gl.DeleteVertexArrays(1, &emptyVAO_);
    atomVBO_ = ghostVBO_ = quadVBO_ = lineVBO_ = 0;
    atomVAO_ = ghostVAO_ = lineVAO_ = emptyVAO_ = 0;
    context_ = nullptr;
    initialized_ = false;
    atoms_.clear();
    ghosts_.clear();
    lines_.clear();
    atomCount_ = ghostCount_ = lineCount_ = bondCount_ = 0;
}

void Renderer::SetStructure(const Structure* structure) {
    structure_ = structure;
    selected_.clear();
    hovered_ = -1;
    measurements_.clear();
    pending_.clear();
    RebuildGeometry();
}

void Renderer::SetOptions(const RenderOptions& options) {
    options_ = options;
    RebuildGeometry();
}

void Renderer::SetAppearance(const AppearanceState& state) {
    const bool frameChanged = state.cellColor != options_.cellColor || state.cellLineWidth != options_.cellLineWidth;
    static_cast<AppearanceState&>(options_) = state;
    if (!frameChanged) return;
    const uint32_t cellColor = state.cellColor;
    const float cellLineWidth = state.cellLineWidth;
    const float r = ((cellColor >> 16) & 0xFF) / 255.0f;
    const float g = ((cellColor >> 8) & 0xFF) / 255.0f;
    const float b = (cellColor & 0xFF) / 255.0f;
    const float radius = cellBaseRadius_ * std::clamp(cellLineWidth, 0.5f, 4.0f);
    for (int i = 0; i < cellLineCount_ && i < static_cast<int>(lines_.size()); ++i) {
        LineInstance& line = lines_[static_cast<size_t>(i)];
        line.c0r = line.c1r = r;
        line.c0g = line.c1g = g;
        line.c0b = line.c1b = b;
        line.radius = (static_cast<int>(line.flags) & 4) ? radius * 0.52f : radius;
    }
    if (!lines_.empty()) UploadLines();
}

void Renderer::SetHighlight(const std::vector<int>& selected, int hovered) {
    if (selected_ == selected && hovered_ == hovered) return;
    selected_ = selected;
    hovered_ = hovered;
    // Selection/hover are evaluated in the vertex shader from a per-instance
    // index, so hovering large structures no longer re-uploads the whole atom
    // buffer.
}

void Renderer::SetAnnotations(const std::vector<Measurement>& measurements, const std::vector<int>& pending) {
    measurements_ = measurements;
    pending_ = pending;
    lines_.resize(sceneLineCount_);
    AppendMeasurementLines();
    lineCount_ = static_cast<int>(lines_.size());
    UploadLines();
}

void Renderer::RebuildGeometry() {
    RebuildAtoms();
    RebuildLines();
    UploadAtoms();
    UploadGhosts();
    UploadPolyhedra();
}

void Renderer::RebuildAtoms() {
    atoms_.clear();
    ghosts_.clear();
    images_.clear();
    supercellLimited_ = boundaryLimited_ = false;
    atomCount_ = 0;
    ghostCount_ = 0;
    if (!structure_) return;
    const float styleScale = options_.style == AtomStyle::SpaceFill ? 0.92f
                                                                   : Clampf(options_.atomScale, 0.10f, 0.85f);
    auto appendAtom = [&](const Atom& atom, const Vec3& cart, int selectableIndex,
                          std::vector<ImageInstance>& images, int atomIndex, int tx, int ty, int tz) {
        images.push_back(ImageInstance{atomIndex, tx, ty, tz,
                                       Vec3(cart.x - structure_->center.x, cart.y - structure_->center.y,
                                            cart.z - structure_->center.z)});
        if (options_.style == AtomStyle::Polyhedral && !IsPolyhedronCenter(atom.atomicNumber)) {
            return;
        }
        const Element& element = ElementByZ(atom.atomicNumber);
        AtomInstance instance{};
        instance.x = static_cast<float>(cart.x - structure_->center.x);
        instance.y = static_cast<float>(cart.y - structure_->center.y);
        instance.z = static_cast<float>(cart.z - structure_->center.z);
        const bool transitionMetal =
            (atom.atomicNumber >= 21 && atom.atomicNumber <= 30) ||
            (atom.atomicNumber >= 39 && atom.atomicNumber <= 48) ||
            (atom.atomicNumber >= 57 && atom.atomicNumber <= 80) || atom.atomicNumber >= 89;
        const float baseRadius =
            (options_.style == AtomStyle::SpaceFill || !transitionMetal) ? element.vdw : element.covalent;
        instance.radius = std::max(0.10f, baseRadius * styleScale);
        instance.r = ((element.color >> 16) & 0xFF) / 255.0f;
        instance.g = ((element.color >> 8) & 0xFF) / 255.0f;
        instance.b = (element.color & 0xFF) / 255.0f;
        instance.flags = 0.0f;
        instance.index = static_cast<float>(selectableIndex);
        if (options_.style == AtomStyle::Polyhedral) instance.radius *= 0.72f;
        atoms_.push_back(instance);
    };

    const size_t cellCount = structure_->atoms.size();
    displayedCells_ = {std::clamp(options_.supercellX, 1, kMaxCellRepeats), std::clamp(options_.supercellY, 1, kMaxCellRepeats),
                       std::clamp(options_.supercellZ, 1, kMaxCellRepeats)};
    const bool periodic = structure_->cell.valid && cellCount > 0;
    const auto requested = displayedCells_[0] * displayedCells_[1] * displayedCells_[2];
    supercellLimited_ = periodic && requested > 1 && !FitsSupercell(*structure_, requested);
    if (!periodic || supercellLimited_) displayedCells_ = {1, 1, 1};
    const auto [nx, ny, nz] = displayedCells_;
    const size_t interiorCount = cellCount * nx * ny * nz;
    constexpr size_t maxImages = 80000;

    atoms_.reserve(interiorCount + 64);
    images_.reserve(atoms_.capacity());
    // Keep the original sites first for picking. Identify each replica by
    // source site and integer shift, including coincident mixed-occupancy sites.
    for (size_t i = 0; i < cellCount; ++i) {
        const Atom& atom = structure_->atoms[i];
        appendAtom(atom, atom.cart, static_cast<int>(i), images_, static_cast<int>(i), 0, 0, 0);
    }
    if (periodic) {
        // Reserve capacity for every interior copy before spending the remaining
        // budget on boundary images; never drop sites from inside a drawn cell.
        size_t boundaryBudget = maxImages - std::min(maxImages, interiorCount);
        constexpr double eps = 1e-7;
        for (size_t i = 0; i < cellCount; ++i) {
            const Atom& atom = structure_->atoms[i];
            auto limits = [&](double f, int n) {
                if (!options_.showImages) return std::pair<int,int>{0, n-1};
                return std::pair<int,int>{static_cast<int>(std::ceil(-eps - f)),
                                          static_cast<int>(std::floor(n + eps - f))};
            };
            const auto x = limits(atom.frac.x, nx);
            const auto y = limits(atom.frac.y, ny);
            const auto z = limits(atom.frac.z, nz);
            for (int tx = x.first; tx <= x.second; ++tx)
                for (int ty = y.first; ty <= y.second; ++ty)
                    for (int tz = z.first; tz <= z.second; ++tz) {
                        if (tx == 0 && ty == 0 && tz == 0) continue;
                        if (tx < 0 || ty < 0 || tz < 0 || tx >= nx || ty >= ny || tz >= nz) {
                            if (!boundaryBudget) { boundaryLimited_ = true; continue; }
                            --boundaryBudget;
                        }
                        const Vec3 offset = structure_->cell.FractionalToCartesian({double(tx), double(ty), double(tz)});
                        appendAtom(atom, atom.cart + offset, -1, images_, static_cast<int>(i), tx, ty, tz);
                    }
        }
    }
    atomCount_ = static_cast<int>(atoms_.size());
}

void Renderer::GetVisiblePoints(std::vector<Vec3>& points) const {
    points.clear();
    if (!structure_) return;
    if (structure_->cell.valid) {
        const auto [nx, ny, nz] = displayedCells_;
        for (int i = 0; i < 8; ++i) {
            const Vec3 frac{static_cast<double>((i & 1) ? nx : 0), static_cast<double>((i & 2) ? ny : 0),
                            static_cast<double>((i & 4) ? nz : 0)};
            points.push_back(structure_->cell.FractionalToCartesian(frac) - structure_->center);
        }
    }
    points.reserve(points.size() + 8 * atoms_.size() + polyVertices_.size());
    for (const AtomInstance& atom : atoms_) {
        for (int i = 0; i < 8; ++i) {
            points.emplace_back(atom.x + ((i & 1) ? atom.radius : -atom.radius),
                                atom.y + ((i & 2) ? atom.radius : -atom.radius),
                                atom.z + ((i & 4) ? atom.radius : -atom.radius));
        }
    }
    for (const PolyVertex& p : polyVertices_) points.emplace_back(p.px, p.py, p.pz);
}

void Renderer::AppendLine(const Vec3& p0, const Vec3& p1, float radius, const float c0[3], const float c1[3],
                          float flags) {
    LineInstance line{};
    line.p0x = static_cast<float>(p0.x);
    line.p0y = static_cast<float>(p0.y);
    line.p0z = static_cast<float>(p0.z);
    line.p1x = static_cast<float>(p1.x);
    line.p1y = static_cast<float>(p1.y);
    line.p1z = static_cast<float>(p1.z);
    line.radius = radius;
    line.c0r = c0[0];
    line.c0g = c0[1];
    line.c0b = c0[2];
    line.c1r = c1[0];
    line.c1g = c1[1];
    line.c1b = c1[2];
    line.flags = flags;
    lines_.push_back(line);
}

void Renderer::AppendMeasurementLines() {
    if (!structure_) return;
    const Vec3 c = structure_->center;
    auto endpoint = [&](int index, const Vec3& offset) {
        const Atom& atom = structure_->atoms[static_cast<size_t>(index)];
        return atom.cart + offset - c;
    };
    for (const Measurement& measurement : measurements_) {
        if (measurement.a < 0 || measurement.b < 0) continue;
        if (measurement.kind == MeasurementKind::Distance) {
            AppendLine(endpoint(measurement.a, measurement.offsetA),
                       endpoint(measurement.b, measurement.offsetB), 0.028f, kGold, kGold, 1.0f);
        } else if (measurement.kind == MeasurementKind::Angle && measurement.c >= 0) {
            const Vec3 vertex = endpoint(measurement.b, {});
            AppendLine(vertex, endpoint(measurement.a, measurement.offsetA), 0.028f, kCyan, kCyan, 1.0f);
            AppendLine(vertex, endpoint(measurement.c, measurement.offsetC), 0.028f, kCyan, kCyan, 1.0f);
        }
    }
    for (size_t i = 1; i < pending_.size(); ++i) {
        const int a = pending_[i - 1];
        const int b = pending_[i];
        if (a < 0 || b < 0) continue;
        AppendLine(endpoint(a, {}), endpoint(b, {}), 0.030f, kGold, kGold, 1.0f);
    }
}

void Renderer::RebuildLines() {
    lines_.clear();
    sceneLineCount_ = 0;
    lineCount_ = cellLineCount_ = visibleBondCount_ = 0;
    polyVertices_.clear();
    bondCount_ = structure_ ? static_cast<int>(structure_->bonds.size()) : 0;
    if (!structure_) return;

    if (structure_->cell.valid) {
        const auto [nx, ny, nz] = displayedCells_;
        auto edgePoint = [&](int ix, int iy, int iz) {
            const Vec3 frac{static_cast<double>(ix), static_cast<double>(iy), static_cast<double>(iz)};
            return structure_->cell.FractionalToCartesian(frac) - structure_->center;
        };
        const Cell& cell = structure_->cell;
        cellBaseRadius_ = Clampf(static_cast<float>(std::min({cell.a, cell.b, cell.c})) * 0.005f,
                                0.017f, 0.065f);
        float cellRadius = cellBaseRadius_ * Clampf(options_.cellLineWidth, 0.5f, 4.0f);
        const float cellColor[3] = {((options_.cellColor >> 16) & 0xFF) / 255.0f,
                                    ((options_.cellColor >> 8) & 0xFF) / 255.0f,
                                    (options_.cellColor & 0xFF) / 255.0f};
        if (options_.showCell) {
            auto edge = [&](const Vec3& a, const Vec3& b, bool outer) {
                AppendLine(a, b, cellRadius * (outer ? 1.0f : 0.52f), cellColor, cellColor, outer ? 2.0f : 6.0f);
            };
            for (int iy = 0; iy <= ny; ++iy) {
                for (int iz = 0; iz <= nz; ++iz) {
                    edge(edgePoint(0, iy, iz), edgePoint(nx, iy, iz),
                         (iy == 0 || iy == ny) && (iz == 0 || iz == nz));
                }
            }
            for (int ix = 0; ix <= nx; ++ix) {
                for (int iz = 0; iz <= nz; ++iz) {
                    edge(edgePoint(ix, 0, iz), edgePoint(ix, ny, iz),
                         (ix == 0 || ix == nx) && (iz == 0 || iz == nz));
                }
            }
            for (int ix = 0; ix <= nx; ++ix) {
                for (int iy = 0; iy <= ny; ++iy) {
                    edge(edgePoint(ix, iy, 0), edgePoint(ix, iy, nz),
                         (ix == 0 || ix == nx) && (iy == 0 || iy == ny));
                }
            }
        }
    }

    cellLineCount_ = static_cast<int>(lines_.size());
    visibleBondCount_ = 0;
    polyVertices_.clear();
    const bool polyhedral = options_.style == AtomStyle::Polyhedral;
    if (options_.style != AtomStyle::SpaceFill && !images_.empty() && (options_.showBonds || polyhedral)) {
        using ImageKey = std::array<int, 4>;
        std::map<ImageKey, size_t> lookup;
        std::vector<std::vector<size_t>> copies(structure_->atoms.size());
        for (size_t i = 0; i < images_.size(); ++i) {
            const auto& p = images_[i];
            copies[p.atom].push_back(i);
            lookup[{p.atom, p.tx, p.ty, p.tz}] = i;
        }
        const float bondColor[3] = {0.66f, 0.70f, 0.76f};
        for (const Bond& bond : structure_->bonds) {
            for (size_t index : copies[bond.a]) {
                const ImageInstance& source = images_[index];
                const auto end = lookup.find({bond.b, source.tx + bond.shift[0], source.ty + bond.shift[1],
                                              source.tz + bond.shift[2]});
                if (end == lookup.end()) continue;
                ++visibleBondCount_;
                if (polyhedral) continue;
                float radius = options_.bondRadius;
                if (structure_->atoms[bond.a].atomicNumber == 1 || structure_->atoms[bond.b].atomicNumber == 1)
                    radius *= 0.82f;
                AppendLine(source.position, images_[end->second].position, radius, bondColor, bondColor, 0.0f);
            }
        }
    }
    if (polyhedral) BuildPolyhedra();
    sceneLineCount_ = lines_.size();
    AppendMeasurementLines();
    lineCount_ = static_cast<int>(lines_.size());
    UploadLines();
}

void Renderer::BuildPolyhedra() {
    polyVertices_.clear();
    if (!structure_ || !structure_->cell.valid) return;
    std::vector<std::vector<Vec3>> shells(structure_->atoms.size());
    for (const Bond& bond : structure_->bonds) {
        const Vec3 delta = structure_->atoms[bond.b].cart + bond.imageOffset - structure_->atoms[bond.a].cart;
        shells[bond.a].push_back(delta);
        shells[bond.b].push_back(-delta);
    }
    std::vector<std::vector<PolyTriangle>> meshes(shells.size());
    for (size_t site = 0; site < shells.size(); ++site) {
        if (IsPolyhedronCenter(structure_->atoms[site].atomicNumber))
            meshes[site] = CoordinationHull(shells[site]);
    }
    size_t triangleCount = 0;
    for (const ImageInstance& image : images_) triangleCount += meshes[image.atom].size();
    polyVertices_.reserve(3 * triangleCount);
    for (const ImageInstance& image : images_) {
        const auto color = ElementByZ(structure_->atoms[image.atom].atomicNumber).color;
        for (const auto& tri : meshes[image.atom]) {
            for (int i = 0; i < 3; ++i) {
                const Vec3 p = image.position + tri.corners[i];
                PolyVertex v{float(p.x), float(p.y), float(p.z),
                             float(tri.normal.x), float(tri.normal.y), float(tri.normal.z),
                             ((color >> 16) & 255) / 255.f, ((color >> 8) & 255) / 255.f, (color & 255) / 255.f};
                // Set a disabled barycentric component to constant one across
                // the triangle. Its zero contour (a fan diagonal) disappears.
                for (int j = 0; j < 3; ++j) v.bary[j] = (i == j || !tri.boundary[j]) ? 1.f : 0.f;
                polyVertices_.push_back(v);
            }
        }
    }
}

void Renderer::SortPolyhedra(const Vec3& forward) {
    if (LengthSq(forward - sortedDirection_) < 1e-14) return;
    sortedDirection_ = forward;
    std::vector<std::pair<double, unsigned>> order;
    order.reserve(triangleCenters_.size());
    for (unsigned i = 0; i < triangleCenters_.size(); ++i)
        order.emplace_back(-Dot(forward, triangleCenters_[i]), 3*i);
    std::sort(order.begin(), order.end());
    std::vector<unsigned> indices;
    indices.reserve(polyVertices_.size());
    for (const auto& item : order) {
        const unsigned i = item.second;
        indices.insert(indices.end(), {i, i+1, i+2});
    }
    // The caller has bound the polyhedron VAO (which owns the index binding).
    context_->gl.BufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size()*sizeof(unsigned), indices.data(), GL_DYNAMIC_DRAW);
}

void Renderer::UploadPolyhedra() {
    sortedDirection_ = {};
    triangleCenters_.clear();
    triangleCenters_.reserve(polyVertices_.size()/3);
    for (size_t i = 0; i < polyVertices_.size(); i += 3) {
        Vec3 sum;
        for (size_t j=i; j<i+3; ++j) {
            const auto& v = polyVertices_[j];
            sum += Vec3(v.px, v.py, v.pz);
        }
        triangleCenters_.push_back(sum / 3.0);
    }
    polyVertexCount_ = static_cast<int>(polyVertices_.size());
    if (!context_) return;
    auto& gl = context_->gl;
    gl.BindBuffer(GL_ARRAY_BUFFER, polyVBO_);
    const GLsizeiptr bytes = static_cast<GLsizeiptr>(polyVertices_.size() * sizeof(PolyVertex));
    gl.BufferData(GL_ARRAY_BUFFER, bytes, polyVertices_.empty() ? nullptr : polyVertices_.data(),
                  GL_DYNAMIC_DRAW);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
}

void Renderer::UploadLines() {
    if (!context_) return;
    auto& gl = context_->gl;
    gl.BindBuffer(GL_ARRAY_BUFFER, lineVBO_);
    const GLsizeiptr bytes = static_cast<GLsizeiptr>(lines_.size() * sizeof(LineInstance));
    gl.BufferData(GL_ARRAY_BUFFER, bytes, lines_.empty() ? nullptr : lines_.data(), GL_DYNAMIC_DRAW);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
}

void Renderer::UploadAtoms() {
    if (!context_) return;
    auto& gl = context_->gl;
    gl.BindBuffer(GL_ARRAY_BUFFER, atomVBO_);
    const GLsizeiptr bytes = static_cast<GLsizeiptr>(atoms_.size() * sizeof(AtomInstance));
    gl.BufferData(GL_ARRAY_BUFFER, bytes, atoms_.empty() ? nullptr : atoms_.data(), GL_DYNAMIC_DRAW);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
}

void Renderer::UploadGhosts() {
    if (!context_) return;
    auto& gl = context_->gl;
    gl.BindBuffer(GL_ARRAY_BUFFER, ghostVBO_);
    const GLsizeiptr bytes = static_cast<GLsizeiptr>(ghosts_.size() * sizeof(AtomInstance));
    gl.BufferData(GL_ARRAY_BUFFER, bytes, ghosts_.empty() ? nullptr : ghosts_.data(), GL_DYNAMIC_DRAW);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
}

void Renderer::Draw(const Camera& camera, int width, int height) {
    if (!initialized_ || !context_ || width <= 0 || height <= 0) return;
    auto& gl = context_->gl;
    glViewport(0, 0, width, height);

    glDepthMask(GL_TRUE);
    glClearColor(0.007f, 0.008f, 0.011f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glDisable(GL_BLEND);
    glDisable(GL_CULL_FACE);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    if (context_->samples > 0) glEnable(GL_SAMPLE_ALPHA_TO_COVERAGE);

    glDisable(GL_DEPTH_TEST);
    glDepthMask(GL_FALSE);
    backgroundProgram_.Use(gl);
    if (backgroundResolutionLoc_ >= 0) {
        gl.Uniform2f(backgroundResolutionLoc_, static_cast<float>(width), static_cast<float>(height));
    }
    if (backgroundColorLoc_ >= 0) {
        const float r = ((options_.backgroundColor >> 16) & 0xFF) / 255.0f;
        const float g = ((options_.backgroundColor >> 8) & 0xFF) / 255.0f;
        const float b = (options_.backgroundColor & 0xFF) / 255.0f;
        gl.Uniform3f(backgroundColorLoc_, r, g, b);
    }
    gl.BindVertexArray(emptyVAO_);
    gl.DrawArrays(GL_TRIANGLES, 0, 3);

    glEnable(GL_DEPTH_TEST);
    glDepthMask(GL_TRUE);
    const Mat4 view = camera.ViewMatrix();
    const Mat4 projection = camera.ProjectionMatrix(width, height);

    if (lineCount_ > 0) {
        lineProgram_.Use(gl);
        gl.UniformMatrix4fv(lineViewLoc_, 1, GL_FALSE, view.m);
        gl.UniformMatrix4fv(lineProjLoc_, 1, GL_FALSE, projection.m);
        if (lineOverlayLoc_ >= 0) gl.Uniform1f(lineOverlayLoc_, 1.0f);
        gl.BindVertexArray(lineVAO_);
        gl.DrawArraysInstanced(GL_LINES, 0, 2, lineCount_);
    }

    if (atomCount_ > 0) {
        atomProgram_.Use(gl);
        gl.UniformMatrix4fv(atomViewLoc_, 1, GL_FALSE, view.m);
        gl.UniformMatrix4fv(atomProjLoc_, 1, GL_FALSE, projection.m);
        const int selected0 = selected_.size() > 0 ? selected_[0] : -1;
        const int selected1 = selected_.size() > 1 ? selected_[1] : -1;
        const int selected2 = selected_.size() > 2 ? selected_[2] : -1;
        if (atomHoveredLoc_ >= 0) gl.Uniform1i(atomHoveredLoc_, hovered_);
        if (atomSelectedLoc_[0] >= 0) gl.Uniform1i(atomSelectedLoc_[0], selected0);
        if (atomSelectedLoc_[1] >= 0) gl.Uniform1i(atomSelectedLoc_[1], selected1);
        if (atomSelectedLoc_[2] >= 0) gl.Uniform1i(atomSelectedLoc_[2], selected2);
        gl.BindVertexArray(atomVAO_);
        gl.DrawArraysInstanced(GL_TRIANGLES, 0, 6, atomCount_);
    }

    if (ghostCount_ > 0) {
        atomProgram_.Use(gl);
        gl.UniformMatrix4fv(atomViewLoc_, 1, GL_FALSE, view.m);
        gl.UniformMatrix4fv(atomProjLoc_, 1, GL_FALSE, projection.m);
        if (atomHoveredLoc_ >= 0) gl.Uniform1i(atomHoveredLoc_, -1);
        for (GLint location : atomSelectedLoc_) {
            if (location >= 0) gl.Uniform1i(location, -1);
        }
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(GL_FALSE);
        if (context_->samples > 0) glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
        gl.BindVertexArray(ghostVAO_);
        gl.DrawArraysInstanced(GL_TRIANGLES, 0, 6, ghostCount_);
        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
    }

    if (polyVertexCount_ > 0 && (options_.polyTransparency < 100 || options_.polyEdgeWidth > 0)) {
        polyProgram_.Use(gl);
        gl.UniformMatrix4fv(polyViewLoc_, 1, GL_FALSE, view.m);
        gl.UniformMatrix4fv(polyProjLoc_, 1, GL_FALSE, projection.m);
        gl.Uniform1f(polyAlphaLoc_, 1.0f - options_.polyTransparency / 100.0f);
        gl.Uniform1f(polyEdgeWidthLoc_, options_.polyEdgeWidth);
        const auto rgb = options_.polyEdgeColor;
        gl.Uniform3f(polyEdgeColorLoc_, ((rgb>>16)&255)/255.f, ((rgb>>8)&255)/255.f, (rgb&255)/255.f);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(options_.polyTransparency == 0 ? GL_TRUE : GL_FALSE);
        glDisable(GL_CULL_FACE);
        if (context_->samples > 0) glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
        gl.BindVertexArray(polyVAO_);
        if (options_.polyTransparency == 0) {
            gl.DrawArrays(GL_TRIANGLES, 0, polyVertexCount_);
        } else {
            SortPolyhedra(camera.Forward());
            glDrawElements(GL_TRIANGLES, polyVertexCount_, GL_UNSIGNED_INT, nullptr);
        }
        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
    }

    if (cellLineCount_ > 0) {
        lineProgram_.Use(gl);
        gl.UniformMatrix4fv(lineViewLoc_, 1, GL_FALSE, view.m);
        gl.UniformMatrix4fv(lineProjLoc_, 1, GL_FALSE, projection.m);
        if (lineOverlayLoc_ >= 0) gl.Uniform1f(lineOverlayLoc_, 0.18f);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glDepthMask(GL_FALSE);
        glDepthFunc(GL_GREATER);
        glEnable(GL_CULL_FACE);
        if (context_->samples > 0) glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
        gl.BindVertexArray(lineVAO_);
        gl.DrawArraysInstanced(GL_LINES, 0, 2, cellLineCount_);
        if (lineOverlayLoc_ >= 0) gl.Uniform1f(lineOverlayLoc_, 1.0f);
        glDisable(GL_CULL_FACE);
        glDepthFunc(GL_LEQUAL);
        glDepthMask(GL_TRUE);
        glDisable(GL_BLEND);
    }

    if (context_->samples > 0) glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
    gl.BindVertexArray(0);
    gl.BindBuffer(GL_ARRAY_BUFFER, 0);
    gl.UseProgram(0);
}

void Renderer::Clear(GLContext* context) {
    if (!context || !context->valid) return;
    glClearColor(0.007f, 0.008f, 0.011f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
}

} // namespace cl

