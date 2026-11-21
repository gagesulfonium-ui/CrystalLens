#pragma once

#include "Camera.h"

#include "core/Crystal.h"

namespace cl {

// Returns the index of the nearest atom whose rendered sphere is hit by the
// screen-space ray, or -1 when no atom is under the cursor. The visual radius
// follows the same atom-size rules as the renderer.
int PickAtom(const Structure& structure, const Camera& camera, int viewportWidth, int viewportHeight,
             double screenX, double screenY, float atomScale, bool spaceFill);

} // namespace cl
