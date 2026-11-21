#pragma once

#include "core/Math.h"
#include <array>
#include <vector>

namespace cl {

struct PolyTriangle {
    std::array<Vec3, 3> corners;
    Vec3 normal;
    std::array<bool, 3> boundary; // edge opposite each corner
};

struct Structure;
using SiteMeshes = std::vector<std::vector<PolyTriangle>>;
// Indexed by expanded unit-cell site. An empty outer vector means no 3D shell.
SiteMeshes CoordinationMeshes(const Structure& structure);
std::vector<PolyTriangle> CoordinationHull(const std::vector<Vec3>& ligands);

} // namespace cl
