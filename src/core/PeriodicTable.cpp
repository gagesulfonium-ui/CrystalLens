#include "PeriodicTable.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cwctype>

namespace cl {
namespace {

constexpr Element kElements[] = {
    {1, "H", "Hydrogen", 0.31f, 1.20f, 0xF2F4F8},   {2, "He", "Helium", 0.28f, 1.40f, 0xD9E7F2},
    {3, "Li", "Lithium", 1.28f, 1.82f, 0xC7A6FF},  {4, "Be", "Beryllium", 0.96f, 1.53f, 0x9FE3B0},
    {5, "B", "Boron", 0.84f, 1.92f, 0xF0A98B},     {6, "C", "Carbon", 0.76f, 1.70f, 0x7F8A9A},
    {7, "N", "Nitrogen", 0.71f, 1.55f, 0x5B8CFF},  {8, "O", "Oxygen", 0.66f, 1.52f, 0xFF5C6C},
    {9, "F", "Fluorine", 0.57f, 1.47f, 0x66E0A3},  {10, "Ne", "Neon", 0.58f, 1.54f, 0x9CD7E8},
    {11, "Na", "Sodium", 1.66f, 2.27f, 0xD8C34A},  {12, "Mg", "Magnesium", 1.41f, 1.73f, 0x8FE58C},
    {13, "Al", "Aluminium", 1.21f, 1.84f, 0x4FA3FF},{14, "Si", "Silicon", 1.11f, 2.10f, 0x5A7CFF},
    {15, "P", "Phosphorus", 1.07f, 1.80f, 0xFF9F43},{16, "S", "Sulfur", 1.05f, 1.80f, 0xFFD54A},
    {17, "Cl", "Chlorine", 1.02f, 1.75f, 0x4ADF7A},{18, "Ar", "Argon", 1.06f, 1.88f, 0x88D6E8},
    {19, "K", "Potassium", 2.03f, 2.75f, 0xB26BFF},{20, "Ca", "Calcium", 1.76f, 2.31f, 0x7FE08A},
    {21, "Sc", "Scandium", 1.70f, 2.15f, 0xC9D18A},{22, "Ti", "Titanium", 1.60f, 2.11f, 0x93A8C7},
    {23, "V", "Vanadium", 1.53f, 2.07f, 0xE4B563}, {24, "Cr", "Chromium", 1.39f, 2.06f, 0xE040B0},
    {25, "Mn", "Manganese", 1.39f, 2.05f, 0xC58BC9},{26, "Fe", "Iron", 1.32f, 2.04f, 0xE3753F},
    {27, "Co", "Cobalt", 1.26f, 2.00f, 0x2F5BD8},  {28, "Ni", "Nickel", 1.24f, 1.97f, 0x9AA7B8},
    {29, "Cu", "Copper", 1.32f, 1.96f, 0xD98246},  {30, "Zn", "Zinc", 1.22f, 2.01f, 0xA99BD8},
    {31, "Ga", "Gallium", 1.22f, 1.87f, 0xC9A16B},{32, "Ge", "Germanium", 1.20f, 2.11f, 0x9DBF9D},
    {33, "As", "Arsenic", 1.19f, 1.85f, 0xC99BCB},{34, "Se", "Selenium", 1.20f, 1.90f, 0xF2A65A},
    {35, "Br", "Bromine", 1.20f, 1.85f, 0xA65A38},{36, "Kr", "Krypton", 1.16f, 2.02f, 0x92D8E8},
    {37, "Rb", "Rubidium", 2.20f, 3.03f, 0xC36BFF},{38, "Sr", "Strontium", 1.95f, 2.49f, 0x7FE08A},
    {39, "Y", "Yttrium", 1.90f, 2.32f, 0x9BBFD1},  {40, "Zr", "Zirconium", 1.75f, 2.23f, 0x99B873},
    {41, "Nb", "Niobium", 1.64f, 2.14f, 0x92A8C4}, {42, "Mo", "Molybdenum", 1.54f, 2.17f, 0x7FA9DD},
    {43, "Tc", "Technetium", 1.47f, 2.16f, 0xC9A46B},{44, "Ru", "Ruthenium", 1.46f, 2.13f, 0x8FC0B8},
    {45, "Rh", "Rhodium", 1.42f, 2.10f, 0xA4B6D8},{46, "Pd", "Palladium", 1.39f, 2.05f, 0xA8B8C8},
    {47, "Ag", "Silver", 1.45f, 2.03f, 0xCFD6E2},  {48, "Cd", "Cadmium", 1.44f, 2.18f, 0xD5C58A},
    {49, "In", "Indium", 1.42f, 1.93f, 0xC6A5D8},  {50, "Sn", "Tin", 1.39f, 2.17f, 0xA6B8C5},
    {51, "Sb", "Antimony", 1.39f, 2.06f, 0xC89BD8},{52, "Te", "Tellurium", 1.38f, 2.06f, 0xD8A45A},
    {53, "I", "Iodine", 1.39f, 1.98f, 0xA97BFF},   {54, "Xe", "Xenon", 1.40f, 2.16f, 0x8FD8E8},
    {55, "Cs", "Caesium", 2.44f, 3.43f, 0xB36BFF},{56, "Ba", "Barium", 2.15f, 2.68f, 0x8CE38A},
    {57, "La", "Lanthanum", 2.07f, 2.40f, 0x9BC98F},{58, "Ce", "Cerium", 2.04f, 2.35f, 0xB8D18A},
    {59, "Pr", "Praseodymium", 2.03f, 2.39f, 0xA6D19A},{60, "Nd", "Neodymium", 2.01f, 2.29f, 0x9CCB9D},
    {61, "Pm", "Promethium", 1.99f, 2.36f, 0x9EC9A8},{62, "Sm", "Samarium", 1.98f, 2.29f, 0x9CC7AA},
    {63, "Eu", "Europium", 1.98f, 2.33f, 0xA0C8B8},{64, "Gd", "Gadolinium", 1.96f, 2.37f, 0x9DC4B5},
    {65, "Tb", "Terbium", 1.94f, 2.21f, 0x99C0B8},{66, "Dy", "Dysprosium", 1.92f, 2.29f, 0x95BCC0},
    {67, "Ho", "Holmium", 1.92f, 2.16f, 0x91B8C8},{68, "Er", "Erbium", 1.89f, 2.35f, 0x8DB4CE},
    {69, "Tm", "Thulium", 1.90f, 2.27f, 0x89B0D2},{70, "Yb", "Ytterbium", 1.87f, 2.42f, 0x85ACD6},
    {71, "Lu", "Lutetium", 1.87f, 2.21f, 0x81A8D8},{72, "Hf", "Hafnium", 1.75f, 2.12f, 0x8FB1C2},
    {73, "Ta", "Tantalum", 1.70f, 2.17f, 0x8BA8C9},{74, "W", "Tungsten", 1.62f, 2.10f, 0x87A0D0},
    {75, "Re", "Rhenium", 1.51f, 2.17f, 0x8398D6},{76, "Os", "Osmium", 1.44f, 2.16f, 0x7F90D8},
    {77, "Ir", "Iridium", 1.41f, 2.02f, 0x7B88D9},{78, "Pt", "Platinum", 1.36f, 2.09f, 0x7780DA},
    {79, "Au", "Gold", 1.36f, 2.14f, 0xFFD34E},    {80, "Hg", "Mercury", 1.32f, 2.23f, 0xCFC7D8},
    {81, "Tl", "Thallium", 1.45f, 1.96f, 0xA6B29C},{82, "Pb", "Lead", 1.46f, 2.02f, 0x8C96AE},
    {83, "Bi", "Bismuth", 1.48f, 2.07f, 0xD77AA8},{84, "Po", "Polonium", 1.40f, 1.97f, 0xC96B8F},
    {85, "At", "Astatine", 1.50f, 2.02f, 0xB85A7E},{86, "Rn", "Radon", 1.50f, 2.20f, 0x8ED0E8},
    {87, "Fr", "Francium", 2.60f, 3.48f, 0xC36BFF},{88, "Ra", "Radium", 2.21f, 2.83f, 0x8CE38A},
    {89, "Ac", "Actinium", 2.15f, 2.60f, 0x9CCBA4},{90, "Th", "Thorium", 2.06f, 2.37f, 0xB0C88A},
    {91, "Pa", "Protactinium", 2.00f, 2.43f, 0xA6C29A},{92, "U", "Uranium", 1.96f, 2.40f, 0xFFB84D},
    {93, "Np", "Neptunium", 1.90f, 2.39f, 0x9AB8C6},{94, "Pu", "Plutonium", 1.87f, 2.43f, 0x9AA8D0},
    {95, "Am", "Americium", 1.80f, 2.44f, 0x9AA0C0},{96, "Cm", "Curium", 1.69f, 2.45f, 0x9A98B0},
    {97, "Bk", "Berkelium", 1.68f, 2.44f, 0xB0A0B8},{98, "Cf", "Californium", 1.68f, 2.45f, 0xB0A8C0},
    {99, "Es", "Einsteinium", 1.65f, 2.45f, 0xB0B0C8},{100, "Fm", "Fermium", 1.67f, 2.45f, 0xB0B8D0},
    {101, "Md", "Mendelevium", 1.73f, 2.46f, 0xB8C0D8},{102, "No", "Nobelium", 1.76f, 2.46f, 0xB8C8D8},
    {103, "Lr", "Lawrencium", 1.61f, 2.46f, 0xC0D0E0},{104, "Rf", "Rutherfordium", 1.57f, 2.40f, 0xC8D0E0},
    {105, "Db", "Dubnium", 1.49f, 2.38f, 0xC8C8D8}, {106, "Sg", "Seaborgium", 1.43f, 2.32f, 0xC0C0D0},
    {107, "Bh", "Bohrium", 1.41f, 2.30f, 0xB8B8C8},{108, "Hs", "Hassium", 1.34f, 2.26f, 0xB0B0C0},
    {109, "Mt", "Meitnerium", 1.29f, 2.20f, 0xA8A8B8},{110, "Ds", "Darmstadtium", 1.28f, 2.20f, 0xA0A0B0},
    {111, "Rg", "Roentgenium", 1.21f, 2.20f, 0x9898A8},{112, "Cn", "Copernicium", 1.22f, 2.20f, 0x9090A0},
    {113, "Nh", "Nihonium", 1.36f, 2.40f, 0x888898},{114, "Fl", "Flerovium", 1.43f, 2.60f, 0x808090},
    {115, "Mc", "Moscovium", 1.62f, 2.60f, 0x787888},{116, "Lv", "Livermorium", 1.75f, 2.60f, 0x707080},
    {117, "Ts", "Tennessine", 1.65f, 2.40f, 0x686878},{118, "Og", "Oganesson", 1.57f, 2.30f, 0x606070},
};

constexpr Element kUnknown{0, "X", "Unknown", 0.77f, 1.70f, 0x9AA4B2};

std::string LowerAscii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    return out;
}

} // namespace

bool IsAlkaliOrAlkaline(int z) {
    return z == 3 || z == 4 || z == 11 || z == 12 || z == 19 || z == 20 || z == 37 || z == 38 ||
           z == 55 || z == 56 || z == 87 || z == 88;
}

namespace {

bool IsNonMetal(int z) {
    static const int values[] = {1,  2,  6,  7,  8,  9,  10, 15, 16, 17, 18, 34, 35, 36,
                                 53, 54, 85, 86, 117, 118};
    for (int value : values) {
        if (value == z) return true;
    }
    return false;
}

bool IsMetalloid(int z) {
    static const int values[] = {5, 14, 32, 33, 51, 52, 84};
    for (int value : values) {
        if (value == z) return true;
    }
    return false;
}

} // namespace

double PairBondCutoff(int za, int zb) {
    const Element& a = ElementByZ(za);
    const Element& b = ElementByZ(zb);
    const bool aNonMetal = IsNonMetal(za);
    const bool bNonMetal = IsNonMetal(zb);
    const bool aMetal = !aNonMetal && !IsMetalloid(za);
    const bool bMetal = !bNonMetal && !IsMetalloid(zb);
    if (aMetal && bMetal) {
        // Alkali/alkaline contacts in ionic crystals are not real bonds.
        if (IsAlkaliOrAlkaline(za) || IsAlkaliOrAlkaline(zb)) return 0.0;
        return static_cast<double>(a.covalent) + b.covalent + 0.12;
    }
    if ((aMetal && bNonMetal) || (bMetal && aNonMetal)) {
        // Metal/non-metal bonds are often ionic and legitimately longer than
        // the pure covalent-radius sum (e.g. K-F, Ni-F, Na-Cl).
        return static_cast<double>(a.covalent) + b.covalent + 0.35;
    }
    // Non-metal / metalloid contacts use a fairly tight covalent allowance;
    // this is what rejects the 3.07-3.25 A Bi-Te contacts in Bi2Te3.
    return static_cast<double>(a.covalent) + b.covalent + 0.12;
}

const Element& ElementByZ(int z) {
    if (z >= 1 && z <= 118) return kElements[z - 1];
    return kUnknown;
}

const Element& ElementBySymbol(std::string_view symbol) {
    for (const auto& e : kElements) {
        if (symbol == e.symbol) return e;
    }
    const std::string lower = LowerAscii(symbol);
    for (const auto& e : kElements) {
        if (lower == LowerAscii(e.symbol)) return e;
    }
    return kUnknown;
}

std::string NormalizeElementSymbol(std::string_view raw) {
    std::string s(raw);
    while (!s.empty() && (std::isspace(static_cast<unsigned char>(s.front())) || s.front() == '_')) s.erase(s.begin());
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.pop_back();
    if (s.empty()) return "X";

    // Strip everything from the first character that cannot start/continue a symbol.
    std::string letters;
    for (char c : s) {
        if (std::isalpha(static_cast<unsigned char>(c))) {
            if (letters.size() < 2) letters.push_back(c);
        } else if (!letters.empty()) {
            if (std::isdigit(static_cast<unsigned char>(c)) || c == '+' || c == '-' || c == '(') break;
            if (c == '_' || c == '/') break;
        }
    }
    if (letters.empty()) return "X";

    // Handle isotope-prefixed labels such as "13C" or "2H".
    std::string upper = letters;
    for (char& c : upper) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    if (upper == "D" || upper == "T") return "H";

    // Try the chemically correct two-letter spelling first (CA -> Ca).
    if (letters.size() >= 2) {
        std::string two;
        two += static_cast<char>(std::toupper(static_cast<unsigned char>(letters[0])));
        two += static_cast<char>(std::tolower(static_cast<unsigned char>(letters[1])));
        const Element& e = ElementBySymbol(two);
        if (e.z != 0) return two;
    }
    std::string one(1, static_cast<char>(std::toupper(static_cast<unsigned char>(letters[0]))));
    if (ElementBySymbol(one).z != 0) return one;
    return letters;
}

const Element& ElementFromLabel(std::string_view label) {
    const std::string sym = NormalizeElementSymbol(label);
    return ElementBySymbol(sym);
}

std::wstring ElementDisplayName(int z) {
    const Element& e = ElementByZ(z);
    std::string text = e.symbol;
    text += "  ";
    text += e.name;
    std::wstring out;
    out.reserve(text.size());
    for (unsigned char c : text) out.push_back(static_cast<wchar_t>(c));
    return out;
}

} // namespace cl
