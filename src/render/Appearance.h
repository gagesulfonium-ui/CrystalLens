#pragma once

#include "core/PeriodicTable.h"

#include <array>
#include <cstdint>

namespace cl {

constexpr int kMaxCellRepeats = 16;

struct ElementStyle {
    int color = -1; // Use the element table when no override is set.
    int radiusPercent = 100;
    uint32_t Color(const Element& element) const {
        return color < 0 ? element.color : static_cast<uint32_t>(color);
    }
};
using ElementStyles = std::array<ElementStyle, 119>; // Includes unknown element X.

struct AppearanceState {
    uint32_t cellColor = 0xD6DEE9;
    uint32_t backgroundColor = 0x020305;
    float cellLineWidth = 1.0f;
    int polyTransparency = 66; // percent, 100 leaves the outline only
    float polyEdgeWidth = 1.2f; // screen pixels, 0 hides the outline
    uint32_t polyEdgeColor = 0x91B4D3;
};

} // namespace cl
