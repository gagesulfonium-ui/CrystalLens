#pragma once

#include "Math.h"

#include <array>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace cl {

enum class SourceFormat { Unknown, Cif, Xyz, Vesta };

const wchar_t* FormatDisplayName(SourceFormat format);

struct Cell {
    bool valid = false;
    double a = 1.0, b = 1.0, c = 1.0;
    double alpha = 90.0, beta = 90.0, gamma = 90.0;
    Vec3 aVec{1.0, 0.0, 0.0};
    Vec3 bVec{0.0, 1.0, 0.0};
    Vec3 cVec{0.0, 0.0, 1.0};
    double volume = 1.0;

    bool SetFromParameters(double a, double b, double c, double alpha, double beta, double gamma,
                           std::string* error = nullptr);
    Vec3 FractionalToCartesian(const Vec3& frac) const;
    Vec3 CartesianToFractional(const Vec3& cart) const;
    Vec3 MinimumImageVector(const Vec3& fromCart, const Vec3& toCart) const;
    Vec3 ImageOffset(const Vec3& fromCart, const Vec3& toCart) const;
    std::array<Vec3, 8> Corners() const;
    // Fractional displacement wrapped to the nearest periodic image.
    Vec3 MinimumFractionalDelta(const Vec3& delta) const;
};

struct SymmetryOp {
    double m[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    Vec3 t{0, 0, 0};
    std::string text;
    Vec3 Apply(const Vec3& frac) const;
};

bool ParseSymmetryOperation(std::string_view text, SymmetryOp& out, std::string* error = nullptr);

struct Atom {
    std::string label;
    std::string baseLabel;
    std::string element = "X";
    int atomicNumber = 0;
    Vec3 frac;
    Vec3 cart;
    std::string disorderGroup;
    std::string disorderAssembly;
    double occupancy = 1.0;
    double uiso = 0.0;
    bool hasUiso = false;
    int siteIndex = 0;
    int symmetryIndex = 0;
    bool symmetryGenerated = false;
};

struct Bond {
    int a = -1;
    int b = -1;
    double length = 0.0;
    std::array<int, 3> shift{}; // integer translation applied to endpoint b
    Vec3 imageOffset;
    bool periodic = false;
};

struct Structure {
    SourceFormat format = SourceFormat::Unknown;
    std::string title;
    std::string blockName;
    std::string spaceGroup;
    std::string formula;
    std::string cellContents;
    std::string sourcePathUtf8;
    std::string note;

    Cell cell;
    bool periodic = false;
    bool symmetryExpanded = false;
    bool truncated = false;
    int asymmetricAtomCount = 0;
    int symmetryOperatorCount = 0;

    std::vector<Atom> asymmetricAtoms;
    std::vector<SymmetryOp> symmetryOps;
    std::vector<Atom> atoms;
    std::vector<Bond> bonds;
    std::map<int, int> elementCounts; // atomic number -> count in the displayed unit cell

    Vec3 center;
    double boundRadius = 8.0;

    void ComputeBounds();
    void ComputeContents();
};

struct ParseError {
    std::string message;
    int line = 0;
};

constexpr size_t kMaxDisplayAtoms = 30000;
constexpr size_t kMaxBonds = 150000;

// Expands the asymmetric unit with the supplied symmetry operations, or an
// identity operation when none are present.
void ExpandAsymmetricUnit(Structure& structure, double tolerance = 1e-3);
void BuildBonds(Structure& structure, double tolerance = 1.20);
void FinalizeStructure(Structure& structure, bool expandSymmetry);
bool LoadStructureFile(const std::wstring& path, Structure& out, ParseError& error);

// Element input for editors: accepts a symbol ("Si", "si") or an atomic
// number ("14"). On success z/symbol are filled.
bool ElementFromInput(std::string_view text, int& z, std::string& symbol, std::string* error = nullptr);

// In-memory editing helpers. Each one validates the complete result before
// mutating the structure, then rebuilds symmetry copies, bounds and bonds.
// Atom coordinates are fractional when the structure has a cell and Cartesian
// otherwise. Atom::occupancy must be in (0, 1].
bool SetCellParameters(Structure& structure, double a, double b, double c, double alpha, double beta,
                       double gamma, std::string* error = nullptr);
int AddAtomSite(Structure& structure, const Atom& source, std::string* error = nullptr);
bool UpdateAtomSite(Structure& structure, int siteIndex, const Atom& source, std::string* error = nullptr);
bool DeleteAtomSite(Structure& structure, int siteIndex, std::string* error = nullptr);

// Export helpers. CIF export uses the asymmetric unit plus symmetry
// operations and therefore requires a valid cell; XYZ export writes the
// currently displayed atoms in Cartesian coordinates.
bool ExportStructureToCif(const Structure& structure, const std::wstring& path, std::string* error = nullptr);
bool ExportStructureToXyz(const Structure& structure, const std::wstring& path, std::string* error = nullptr);

enum class MeasurementKind { Distance, Angle };

struct Measurement {
    MeasurementKind kind = MeasurementKind::Distance;
    int a = -1, b = -1, c = -1;
    double value = 0.0;
    Vec3 offsetA; // periodic image offset applied to atom a (angle arm)
    Vec3 offsetB; // periodic image offset applied to atom b (distance endpoint / angle vertex)
    Vec3 offsetC; // periodic image offset applied to atom c (angle arm)
};

double MeasureDistance(const Structure& s, int a, int b, Vec3* offsetA = nullptr, Vec3* offsetB = nullptr);
bool MeasureAngle(const Structure& s, int a, int b, int c, double& degrees, Vec3* armA = nullptr,
                  Vec3* armC = nullptr);
Measurement MakeDistanceMeasurement(const Structure& s, int a, int b);
Measurement MakeAngleMeasurement(const Structure& s, int a, int b, int c);

std::string Trim(std::string_view text);
std::wstring Utf8ToWide(std::string_view text);
std::string WideToUtf8(std::wstring_view text);
std::string FormatDouble(double value, int decimals);

} // namespace cl
