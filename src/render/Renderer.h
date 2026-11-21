#pragma once

#include "render/Appearance.h"

#include "Camera.h"
#include "PolyhedronMesh.h"
#include "GL.h"
#include "core/Crystal.h"

#include <cstdint>
#include <string>
#include <vector>

namespace cl {

enum class AtomStyle { BallAndStick = 0, SpaceFill = 1, Polyhedral = 2 };

struct RenderOptions : AppearanceState {
    bool showCell = true;
    bool showAxes = true;
    bool showBonds = true;
    bool showLabels = false;
    bool showImages = true;
    AtomStyle style = AtomStyle::BallAndStick;
    float atomScale = 0.30f;
    float bondRadius = 0.105f;
    int supercellX = 1;
    int supercellY = 1;
    int supercellZ = 1;
    bool ambientOcclusion = true;
};

bool FitsSupercell(const Structure& s, int copies);

class Renderer {
public:
    bool Initialize(GLContext* context, std::string* error);
    void Shutdown();

    void SetStructure(const Structure* structure);
    void SetOptions(const RenderOptions& options);
    void SetAppearance(const AppearanceState& state);
    void SetHighlight(const std::vector<int>& selected, int hovered);
    void SetAnnotations(const std::vector<Measurement>& measurements, const std::vector<int>& pending);

    void Draw(const Camera& camera, int width, int height);
    void Clear(GLContext* context);

    int AtomCount() const { return atomCount_; }
    const std::vector<float>& SiteRadii() const { return siteRadii_; }
    int PolyhedronTriangleCount() const { return polyVertexCount_ / 3; }
    int BondCount() const { return visibleBondCount_; }
    int CellBondCount() const { return bondCount_; }
    bool SupercellLimited() const { return supercellLimited_; }
    bool BoundaryLimited() const { return boundaryLimited_; }
    int LineCount() const { return lineCount_; }
    const RenderOptions& Options() const { return options_; }
    bool Ready() const { return initialized_; }

    // Bounds of everything currently rendered. The viewport uses this instead
    // of the unit-cell contents so the surrounding boundary atoms fit too.
    void GetVisiblePoints(std::vector<Vec3>& points) const;

private:
    struct AtomInstance {
        float x, y, z;
        float radius;
        float r, g, b;
        float flags;
        float index;
    };
    struct LineInstance {
        float p0x, p0y, p0z;
        float p1x, p1y, p1z;
        float radius;
        float c0r, c0g, c0b;
        float c1r, c1g, c1b;
        float flags;
    };
    struct ImageInstance {
        int atom;
        int tx, ty, tz;
        Vec3 position;
    };
    struct PolyVertex {
        float px, py, pz;
        float nx, ny, nz;
        float r, g, b;
        float bary[3];
    };

    void RebuildGeometry();
    void RebuildAtoms(const SiteMeshes& meshes);
    void RebuildLines();
    void UploadAtoms();
    void UploadGhosts();
    void UploadLines();
    void UploadPolyhedra();
    void SortPolyhedra(const Vec3& forward);
    void BuildPolyhedra(const SiteMeshes& meshes);
    void AppendLine(const Vec3& p0, const Vec3& p1, float radius, const float c0[3], const float c1[3],
                    float flags);
    void AppendMeasurementLines();

    GLContext* context_ = nullptr;
    bool initialized_ = false;
    ShaderProgram atomProgram_;
    ShaderProgram lineProgram_;
    ShaderProgram backgroundProgram_;
    ShaderProgram polyProgram_;

    GLuint atomVAO_ = 0;
    GLuint atomVBO_ = 0;
    GLuint ghostVAO_ = 0;
    GLuint ghostVBO_ = 0;
    GLuint quadVBO_ = 0;
    GLuint lineVAO_ = 0;
    GLuint lineVBO_ = 0;
    GLuint polyVAO_ = 0;
    GLuint polyVBO_ = 0;
    GLuint polyIndexBuffer_ = 0;
    GLuint emptyVAO_ = 0;

    const Structure* structure_ = nullptr;
    RenderOptions options_;
    std::vector<int> selected_;
    int hovered_ = -1;
    std::vector<Measurement> measurements_;
    std::vector<int> pending_;

    std::vector<float> siteRadii_; // original sites only, zero when hidden
    std::vector<AtomInstance> atoms_;
    std::vector<AtomInstance> ghosts_;
    std::vector<LineInstance> lines_;
    std::vector<ImageInstance> images_;
    std::vector<PolyVertex> polyVertices_;
    std::array<int, 3> displayedCells_{1, 1, 1};
    bool supercellLimited_ = false;
    bool boundaryLimited_ = false;
    int atomCount_ = 0;
    int ghostCount_ = 0;
    int bondCount_ = 0;
    int visibleBondCount_ = 0;
    size_t sceneLineCount_ = 0;
    int lineCount_ = 0;
    int polyVertexCount_ = 0;
    std::string error_;

    // Uniform locations are resolved once at initialization instead of every
    // frame, keeping the per-frame driver work to a minimum.
    GLint atomViewLoc_ = -1;
    GLint atomProjLoc_ = -1;
    GLint atomHoveredLoc_ = -1;
    GLint atomSelectedLoc_[3] = {-1, -1, -1};
    GLint lineViewLoc_ = -1;
    GLint lineProjLoc_ = -1;
    GLint lineOverlayLoc_ = -1;
    GLint backgroundResolutionLoc_ = -1;
    int cellLineCount_ = 0;
    float cellBaseRadius_ = 0.03f;
    GLint backgroundColorLoc_ = -1;
    GLint polyViewLoc_ = -1;
    GLint polyProjLoc_ = -1;
    GLint polyAlphaLoc_ = -1;
    GLint polyEdgeWidthLoc_ = -1;
    GLint polyEdgeColorLoc_ = -1;
    std::vector<Vec3> triangleCenters_;
    Vec3 sortedDirection_;

};

} // namespace cl
