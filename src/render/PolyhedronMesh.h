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

std::vector<PolyTriangle> CoordinationHull(const std::vector<Vec3>& ligands);

} // namespace cl
