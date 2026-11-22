#pragma once

#include "Math.h"
#include <string>
#include <vector>

namespace cl {

enum class SolidFamily { Platonic, Archimedean, Star, Prism, Antiprism };
struct SolidPreset {
    const char* id;
    const wchar_t* zh;
    const wchar_t* en;
    SolidFamily family;
    int p, q, mask;
};
struct SolidMesh {
    std::vector<Vec3> vertices;
    std::vector<std::vector<int>> faces;
};
const std::vector<SolidPreset>& SolidPresets();
SolidMesh MakeSolid(const SolidPreset& preset, int sides = 5, bool mirror = false);

} // namespace cl
