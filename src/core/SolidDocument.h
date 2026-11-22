#pragma once
#include "Solids.h"
#include <iosfwd>

namespace cl {
struct SolidLook {
    uint32_t face = 0x6FA8DE, edge = 0x193047, background = 0x101823;
    int mode = 0; // faces and edges, faces only, wireframe
    bool points = true;
};
struct SolidDocument {
    int preset = 0, sides = 5;
    bool mirror = false;
    SolidMesh mesh;
    SolidLook look;
};
SolidDocument NewSolidDocument(int preset, int sides, bool mirror);
bool ReadSolidDocument(std::istream& input, SolidDocument& document);
bool WriteSolidDocument(std::ostream& output, const SolidDocument& document);
} // namespace cl
