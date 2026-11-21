#include "PolyhedronMesh.h"
#include "core/Crystal.h"
#include "core/PeriodicTable.h"

#include <algorithm>
#include <cstdint>
#include <set>

namespace cl {
namespace {

constexpr double eps = 1e-6;

// Monotone chain in the face plane. Interior and collinear points do not
// introduce extra outlines or overlapping triangles.
std::vector<Vec3> FaceBoundary(std::vector<Vec3> face, const Vec3& normal) {
    const Vec3 u = Normalize(face[1] - face[0]);
    const Vec3 v = Cross(normal, u);
    std::sort(face.begin(), face.end(), [&](const Vec3& a, const Vec3& b) {
        double x = Dot(a, u), y = Dot(b, u);
        return x != y ? x < y : Dot(a, v) < Dot(b, v);
    });
    std::vector<Vec3> hull;
    auto append = [&](const Vec3& p, size_t base) {
        while (hull.size() >= base + 2) {
            const Vec3& a = hull[hull.size()-2];
            if (Dot(normal, Cross(hull.back() - a, p - a)) > eps) break;
            hull.pop_back();
        }
        hull.push_back(p);
    };
    for (const Vec3& p : face) append(p, 0);
    const size_t split = hull.size() - 1;
    for (auto p = face.rbegin() + 1; p != face.rend(); ++p) append(*p, split);
    hull.pop_back();
    return hull;
}

} // namespace

std::vector<PolyTriangle> CoordinationHull(const std::vector<Vec3>& ligands) {
    std::vector<Vec3> points;
    for (const Vec3& p : ligands) {
        if (std::none_of(points.begin(), points.end(), [&](const Vec3& q) { return LengthSq(p-q) < eps*eps; }))
            points.push_back(p);
        if (points.size() > 14) return {};
    }
    std::vector<PolyTriangle> mesh;
    std::set<uint32_t> planes;
    for (size_t a = 0; a < points.size(); ++a) {
        for (size_t b = a+1; b < points.size(); ++b) {
            for (size_t c = b+1; c < points.size(); ++c) {
                Vec3 normal = Cross(points[b]-points[a], points[c]-points[a]);
                const double len = Length(normal);
                if (len < eps) continue;
                normal = normal / len;
                bool above = false, below = false;
                uint32_t mask = 0;
                for (size_t i = 0; i < points.size(); ++i) {
                    const double d = Dot(normal, points[i]-points[a]);
                    if (d > eps) above = true;
                    else if (d < -eps) below = true;
                    else mask |= 1u << i;
                }
                if (above == below || !planes.insert(mask).second) continue;
                if (above) normal = -normal;
                std::vector<Vec3> face;
                for (size_t i = 0; i < points.size(); ++i)
                    if (mask & (1u << i)) face.push_back(points[i]);
                const auto polygon = FaceBoundary(std::move(face), normal);
                for (size_t i = 1; i+1 < polygon.size(); ++i)
                    mesh.push_back({{polygon[0], polygon[i], polygon[i+1]}, normal,
                                    {true, i+2 == polygon.size(), i == 1}});
            }
        }
    }
    return mesh;
}

SiteMeshes CoordinationMeshes(const Structure& structure) {
    if (!structure.cell.valid || structure.bonds.empty()) return {};
    std::vector<std::vector<Vec3>> shells(structure.atoms.size());
    for (const Bond& bond : structure.bonds) {
        const Vec3 delta = structure.atoms[bond.b].cart + bond.imageOffset - structure.atoms[bond.a].cart;
        shells[bond.a].push_back(delta);
        shells[bond.b].push_back(-delta);
    }

    SiteMeshes meshes(shells.size());
    // Prefer framework sites such as Ti in perovskite. In salts without such
    // a hull, the alkali/alkaline-earth site defines the coordination cage.
    for (const bool ionicCenters : {false, true}) {
        bool found = false;
        for (size_t site = 0; site < shells.size(); ++site) {
            const int z = structure.atoms[site].atomicNumber;
            const bool ligand = z == 7 || z == 8 || z == 9 || z == 16 || z == 17 ||
                                z == 34 || z == 35 || z == 53;
            if (z == 0 || ligand || IsAlkaliOrAlkaline(z) != ionicCenters || shells[site].size() < 4) continue;
            meshes[site] = CoordinationHull(shells[site]);
            if (!meshes[site].empty()) found = true;
        }
        if (found) return meshes;
    }
    return {};
}

} // namespace cl
