#include "Picking.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace cl {

int PickAtom(const Structure& structure, const Camera& camera, int viewportWidth, int viewportHeight,
             double screenX, double screenY, const std::vector<float>& siteRadii) {
    if (viewportWidth <= 0 || viewportHeight <= 0 || structure.atoms.empty()) return -1;
    const Ray ray = camera.ScreenRay(screenX, screenY, viewportWidth, viewportHeight);
    if (siteRadii.size() != structure.atoms.size()) return -1;
    int best = -1;
    double bestT = std::numeric_limits<double>::max();
    for (size_t i = 0; i < structure.atoms.size(); ++i) {
        const Atom& atom = structure.atoms[i];
        const double atomRadius = siteRadii[i];
        if (atomRadius <= 0) continue;
        const double pickRadius =
            std::max(atomRadius * 1.04, static_cast<double>(structure.boundRadius) * 0.007);
        const Vec3 center = atom.cart - structure.center;
        const Vec3 oc = center - ray.origin;
        const double tca = Dot(oc, ray.direction);
        if (tca < 0.0) continue;
        const double d2 = Dot(oc, oc) - tca * tca;
        const double r2 = pickRadius * pickRadius;
        if (d2 > r2) continue;
        const double thc = std::sqrt(std::max(0.0, r2 - d2));
        const double t = tca - thc;
        if (t > 0.0 && t < bestT) {
            bestT = t;
            best = static_cast<int>(i);
        }
    }
    return best;
}

} // namespace cl
