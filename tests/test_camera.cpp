#include "render/PolyhedronMesh.h"
#include "render/Renderer.h"
#include "render/Camera.h"
#include "render/Picking.h"

#include <cmath>
#include <filesystem>
#include <iostream>

using namespace cl;

namespace {

int gPassed = 0;
int gFailed = 0;

void Check(bool condition, const char* expression, int line) {
    if (condition) {
        ++gPassed;
    } else {
        ++gFailed;
        std::cerr << "FAIL [camera] line " << line << ": " << expression << "\n";
    }
}

void CheckNear(double a, double b, double eps, const char* expression, int line) {
    if (std::abs(a - b) <= eps) {
        ++gPassed;
    } else {
        ++gFailed;
        std::cerr << "FAIL [camera] line " << line << ": " << expression << " (got " << a << ", expected " << b
                  << " +/- " << eps << ")\n";
    }
}

#define CHECK(expr) Check((expr), #expr, __LINE__)
#define CHECK_NEAR(a, b, eps) CheckNear((a), (b), (eps), #a " ~= " #b, __LINE__)

void TestFitFramesTheScene() {
    Camera camera;
    camera.Reset(Vec3{1.0, 2.0, 3.0}, 6.6, 1.15);
    const ScreenPoint center = camera.WorldToScreen(Vec3{1.0, 2.0, 3.0}, 1200, 1000);
    CHECK(center.visible);
    CHECK_NEAR(center.x, 600.0, 1.0);
    CHECK_NEAR(center.y, 500.0, 1.0);

    const Vec3 up = camera.Up();
    const ScreenPoint top = camera.WorldToScreen(Vec3{1.0, 2.0, 3.0} + up * 6.6, 1200, 1000);
    CHECK(top.visible);
    CHECK(top.y > 8.0);
    CHECK(top.y < 180.0);

    const Vec3 right = camera.Right();
    const ScreenPoint side = camera.WorldToScreen(Vec3{1.0, 2.0, 3.0} + right * 6.6, 1200, 1000);
    CHECK(side.visible);
    CHECK(side.x > 950.0);
    CHECK(side.x < 1200.0);
}

void TestRayThroughCenter() {
    Camera camera;
    camera.Reset(Vec3{0.0, 0.0, 0.0}, 5.0, 1.4);
    const Ray ray = camera.ScreenRay(700.0, 500.0, 1400, 1000);
    CHECK_NEAR(Length(ray.direction), 1.0, 1e-9);
    const Vec3 toCenter = Vec3{0, 0, 0} - ray.origin;
    const double t = Dot(toCenter, ray.direction);
    CHECK(t > 0.0);
    const Vec3 closest = ray.origin + ray.direction * t;
    CHECK_NEAR(Length(closest), 0.0, 0.05);
}

void TestOrbitAndZoom() {
    Camera camera;
    camera.Reset(Vec3{}, 5.0, 1.5);
    const Camera start = camera;
    const Vec3 front = start.target - start.Forward();
    const double startDistance = camera.distance;
    camera.OrbitFromDrag(start, 40.0, 20.0, 1200, 800);
    const ScreenPoint moved = camera.WorldToScreen(front, 1200, 800);
    CHECK(moved.x > 600 && moved.y > 400);
    const Camera singleMove = camera;
    for (int i = 0; i <= 40; ++i) camera.OrbitFromDrag(start, i, i * 0.5, 1200, 800);
    CHECK(Length(camera.Eye() - singleMove.Eye()) < 1e-12);
    camera.OrbitFromDrag(start, 80, 40, 2400, 1600);
    CHECK(Length(camera.Up() - singleMove.Up()) < 1e-12);
    camera.OrbitFromDrag(start, 0, 800, 1200, 800);
    CHECK_NEAR(Dot(camera.Forward(), start.Forward()), -1.0, 1e-12);
    camera.OrbitFromDrag(start, 0, 0, 1200, 800);
    CHECK(Length(camera.Up() - start.Up()) < 1e-12);
    CHECK(Length(camera.Eye() - start.Eye()) < 1e-12);
    for (int i = 0; i < 10000; ++i) camera.OrbitBy(0.031, std::cos(i) * 0.02);
    CHECK_NEAR(Length(camera.Eye() - camera.target), startDistance, 1e-10);
    CHECK_NEAR(Length(camera.Right()), 1.0, 1e-12);
    CHECK_NEAR(Length(camera.Up()), 1.0, 1e-12);
    CHECK_NEAR(Dot(camera.Right(), camera.Up()), 0.0, 1e-12);
    camera.Zoom(3.0);
    CHECK(camera.distance < startDistance);
}

void TestPannedOrbit() {
    for (bool ortho : {false, true}) {
        const Vec3 center{10, -2, 5};
        Camera camera;
        camera.Reset(center, 5, 1.5);
        camera.SetProjection(ortho);
        camera.Pan(140, -60, 1200, 800);
        const Camera start = camera;
        const auto before = camera.WorldToScreen(center, 1200, 800);
        camera.OrbitFromDrag(start, 350, -600, 1200, 800);
        const auto after = camera.WorldToScreen(center, 1200, 800);
        CHECK_NEAR(before.x, after.x, 1e-9);
        CHECK_NEAR(before.y, after.y, 1e-9);
        const Ray ray = camera.ScreenRay(after.x, after.y, 1200, 800);
        CHECK(Length(Cross(center - ray.origin, ray.direction)) < 1e-9);
    }
}

void TestOrthographic() {
    Camera camera;
    camera.Reset(Vec3{}, 5.0, 1.5);
    camera.SetProjection(true);
    const ScreenPoint center = camera.WorldToScreen(Vec3{}, 1000, 800);
    CHECK(center.visible);
    CHECK_NEAR(center.x, 500.0, 0.5);
    CHECK_NEAR(center.y, 400.0, 0.5);
    const Ray ray = camera.ScreenRay(500, 400, 1000, 800);
    CHECK_NEAR(Length(ray.direction), 1.0, 1e-9);
}

void TestTightPointFit() {
    Camera camera;
    camera.SetScene(Vec3{0, 0, 0}, 8.0);
    std::vector<Vec3> points;
    for (int x = -1; x <= 1; x += 2) {
        for (int y = -1; y <= 1; y += 2) {
            for (int z = -1; z <= 1; z += 2) {
                points.emplace_back(5.0 * x, 4.0 * y, 3.0 * z);
            }
        }
    }
    camera.Fit(1.5);
    const double sphericalDistance = camera.distance;
    camera.FitPoints(points, 1.5, 1.18);
    CHECK(camera.distance < sphericalDistance);
    bool allInside = true;
    bool touchesMargin = false;
    for (const Vec3& point : points) {
        const ScreenPoint screen = camera.WorldToScreen(point, 1500, 1000);
        if (!screen.visible) allInside = false;
        if (screen.x < 0.0 || screen.x > 1500.0 || screen.y < 0.0 || screen.y > 1000.0) allInside = false;
        if (screen.x < 120.0 || screen.x > 1380.0 || screen.y < 90.0 || screen.y > 910.0) touchesMargin = true;
    }
    CHECK(allInside);
    CHECK(touchesMargin);
}

void TestPolyhedronFaces() {
    std::vector<Vec3> cube;
    for (int x : {-1,1}) for (int y : {-1,1}) for (int z : {-1,1}) cube.emplace_back(x,y,z);
    cube.insert(cube.end(), {{0,0,0}, {1,0,0}, {1,1,0}, {1,1,1}});
    const auto mesh = CoordinationHull(cube);
    CHECK(mesh.size() == 12);
    std::ptrdiff_t sides = 0;
    for (const auto& tri : mesh) {
        sides += std::count(tri.boundary.begin(), tri.boundary.end(), true);
        CHECK(Dot(tri.normal, tri.corners[0]) > 0.99);
    }
    CHECK(sides == 24); // twelve physical edges, each seen by two faces
    CHECK(CoordinationHull({{0,0,0},{1,0,0},{0,1,0},{1,1,0}}).empty());
    CHECK(CoordinationHull({{1,0,0},{0,1,0},{0,0,1},{-1,-1,-1}}).size() == 4);
}

void TestDisplayGeometry() {
    Renderer renderer;
    Structure s;
    ParseError error;
    const auto path = std::filesystem::path(CL_EXAMPLES_DIR) / "srtio3.cif";
    CHECK(LoadStructureFile(path.wstring(), s, error));
    renderer.SetStructure(&s);
    RenderOptions options;
    options.supercellX = options.supercellY = options.supercellZ = 2;
    renderer.SetOptions(options);
    CHECK(renderer.AtomCount() == 71);
    CHECK(renderer.CellBondCount() == 18);
    CHECK(renderer.BondCount() == 192);
    CHECK(renderer.LineCount() == 192 + 27);
    renderer.SetAnnotations({}, {});
    CHECK(renderer.LineCount() == 219);
    options.showImages = false;
    renderer.SetOptions(options);
    CHECK(renderer.AtomCount() == 40 && renderer.BondCount() < 192);
    options.supercellX = options.supercellY = options.supercellZ = kMaxCellRepeats;
    renderer.SetOptions(options);
    CHECK(!renderer.SupercellLimited());
    CHECK(renderer.AtomCount() == 5*16*16*16);
    options.style = AtomStyle::Polyhedral;
    renderer.SetOptions(options);
    CHECK(renderer.AtomCount() == 16*16*16);
    options.style = AtomStyle::BallAndStick;
    options.supercellX = options.supercellY = options.supercellZ = 2;
    renderer.SetOptions(options);
    // Coincident mixed sites retain their identities throughout the supercell.
    s.atoms.push_back(s.atoms[0]);
    renderer.SetStructure(&s);
    CHECK(renderer.AtomCount() == 48);
    s.atoms.resize(9000, s.atoms[0]);
    renderer.SetStructure(&s);
    CHECK(renderer.SupercellLimited());
    CHECK(renderer.AtomCount() == 9000);
    CHECK(renderer.LineCount() - renderer.BondCount() == 12);
    renderer.SetStructure(nullptr);
    CHECK(renderer.AtomCount() == 0 && renderer.BondCount() == 0 && renderer.LineCount() == 0);
}

void TestCoordinationRendering() {
    const auto library = std::filesystem::path(CL_EXAMPLES_DIR).parent_path() / "library";
    const struct Example {
        const char* file;
        const char* center;
        int sites;
        int triangles;
    } examples[] = {
        {"halite.cif", "Na", 4, 8},
        {"fluorite.cif", "Ca", 4, 12},
        {"perovskite.cif", "Ti", 4, 8},
        {"quartz.cif", "Si", 3, 4}
    };
    Renderer renderer;
    Structure structure;
    ParseError error;
    RenderOptions options;
    options.style = AtomStyle::Polyhedral;
    options.showImages = false;
    renderer.SetOptions(options);
    for (const Example& example : examples) {
        CHECK(LoadStructureFile((library / example.file).wstring(), structure, error));
        renderer.SetStructure(&structure);
        CHECK(renderer.AtomCount() == example.sites);
        CHECK(renderer.PolyhedronTriangleCount() == example.sites * example.triangles);
        const auto meshes = CoordinationMeshes(structure);
        CHECK(meshes.size() == structure.atoms.size());
        if (meshes.size() != structure.atoms.size()) continue;
        for (size_t site = 0; site < meshes.size(); ++site) {
            const bool center = structure.atoms[site].element == example.center;
            CHECK((renderer.SiteRadii()[site] > 0) == center);
            CHECK(meshes[site].size() == (center ? example.triangles : 0));
        }
    }
    CHECK(LoadStructureFile((library / "halite.cif").wstring(), structure, error));
    options.supercellX = options.supercellY = options.supercellZ = 2;
    renderer.SetStructure(&structure);
    renderer.SetOptions(options);
    CHECK(renderer.AtomCount() == 32 && renderer.PolyhedronTriangleCount() == 256);
    options.showImages = true;
    options.showBonds = false;
    renderer.SetOptions(options);
    CHECK(renderer.AtomCount() == 63 && renderer.PolyhedronTriangleCount() == 504);
    CHECK(renderer.LineCount() == 27);
    const auto shells = CoordinationMeshes(structure);
    for (const auto& mesh : shells) {
        for (const auto& triangle : mesh) {
            for (const Vec3& vertex : triangle.corners) CHECK_NEAR(Length(vertex), structure.cell.a / 2, 1e-6);
        }
    }

    structure.bonds.clear();
    renderer.SetStructure(&structure);
    CHECK(renderer.PolyhedronTriangleCount() == 0 && renderer.AtomCount() == 125);
    CHECK(LoadStructureFile((std::filesystem::path(CL_EXAMPLES_DIR) / "water.xyz").wstring(), structure, error));
    renderer.SetStructure(&structure);
    CHECK(renderer.AtomCount() == 3 && renderer.PolyhedronTriangleCount() == 0);
    options.showBonds = true;
    renderer.SetOptions(options);
    CHECK(renderer.LineCount() == 2);
    renderer.SetStructure(nullptr);
    CHECK(renderer.SiteRadii().empty() && renderer.PolyhedronTriangleCount() == 0);
}

void TestSupercellFit() {
    Camera camera;
    std::vector<Vec3> points;
    for (int z : {0, 1}) for (int y : {0, 1}) for (int x : {0, 1})
        points.emplace_back(40 + 6*x, -11 + 8*y, 12*z);
    for (bool ortho : {false,true}) {
        camera.SetProjection(ortho);
        camera.FitScenePoints(points, 1.25, 1.18);
        CHECK(Length(camera.target - Vec3{43, -7, 6}) < 1e-9);
        for (auto& p : points) {
            const auto q = camera.WorldToScreen(p, 1000, 800);
            CHECK(q.visible && q.x > 0 && q.y > 0 && q.x < 1000 && q.y < 800);
        }
    }
}

void TestAtomPicking() {
    Structure structure;
    ParseError error;
    const std::filesystem::path path = std::filesystem::path(CL_EXAMPLES_DIR) / "quartz.cif";
    if (!LoadStructureFile(path.wstring(), structure, error)) {
        std::cerr << "FAIL [camera] could not load quartz: " << error.message << "\n";
        ++gFailed;
        return;
    }
    Renderer renderer;
    renderer.SetStructure(&structure);
    Camera camera;
    camera.Reset(structure.center, structure.boundRadius, 1.35);
    int visibleAtoms = 0;
    for (size_t i = 0; i < structure.atoms.size(); ++i) {
        const ScreenPoint screen = camera.WorldToScreen(structure.atoms[i].cart - structure.center, 1200, 900);
        if (!screen.visible) continue;
        ++visibleAtoms;
        const int picked = PickAtom(structure, camera, 1200, 900, screen.x, screen.y, renderer.SiteRadii());
        CHECK(picked >= 0);
    }
    CHECK(visibleAtoms == static_cast<int>(structure.atoms.size()));
    CHECK(PickAtom(structure, camera, 1200, 900, 4.0, 4.0, renderer.SiteRadii()) == -1);
    CHECK(PickAtom(structure, camera, 1200, 900, 1196.0, 4.0, renderer.SiteRadii()) == -1);
    camera.SetProjection(true);
    const ScreenPoint screen = camera.WorldToScreen(structure.atoms[0].cart - structure.center, 1200, 900);
    CHECK(PickAtom(structure, camera, 1200, 900, screen.x, screen.y, renderer.SiteRadii()) >= 0);
}

} // namespace

int RunCameraTests() {
    TestFitFramesTheScene();
    TestRayThroughCenter();
    TestOrbitAndZoom();
    TestPannedOrbit();
    TestOrthographic();
    TestTightPointFit();
    TestSupercellFit();
    TestPolyhedronFaces();
    TestDisplayGeometry();
    TestCoordinationRendering();
    TestAtomPicking();
    return gFailed == 0 ? 0 : 1;
}

int main() {
    std::cout << "CrystalLens camera tests\n";
    const int result = RunCameraTests();
    std::cout << gPassed << " checks passed, " << gFailed << " failed\n";
    return result;
}
