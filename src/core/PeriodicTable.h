#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace cl {

struct Element {
    int z = 0;
    const char* symbol = "X";
    const char* name = "Unknown";
    float covalent = 0.77f; // Angstrom
    float vdw = 1.70f;      // Angstrom
    uint32_t color = 0x9AA4B2;
};

const Element& ElementByZ(int z);
const Element& ElementBySymbol(std::string_view symbol);

// Distance-only bond heuristic shared by the core bond builder and renderer:
// cutoff = covalent(za) + covalent(zb) + PairBondAllowance(za, zb).
// A return value of 0 means the pair should not be bonded (e.g. K-K/K-Ni in
// ionic alkali crystals). Returns 0 when no bond is allowed.
double PairBondCutoff(int za, int zb);

// Extracts a chemical element from a CIF/XYZ label. Handles "O2-", "Fe3+",
// "C1", "CA" (case-insensitively) and isotope-prefixed labels such as "13C".
std::string NormalizeElementSymbol(std::string_view raw);
const Element& ElementFromLabel(std::string_view label);

std::wstring ElementDisplayName(int z);

} // namespace cl
