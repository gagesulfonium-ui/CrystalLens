#include "core/CifParser.h"
#include "core/Crystal.h"
#include "core/PeriodicTable.h"
#include "core/VestaParser.h"
#include "core/XyzParser.h"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

using namespace cl;

namespace {

int gPassed = 0;
int gFailed = 0;
std::string gCurrent;

void Check(bool condition, const char* expression, int line) {
    if (condition) {
        ++gPassed;
    } else {
        ++gFailed;
        std::cerr << "FAIL [" << gCurrent << "] line " << line << ": " << expression << "\n";
    }
}

void CheckNear(double a, double b, double eps, const char* expression, int line) {
    if (std::abs(a - b) <= eps) {
        ++gPassed;
    } else {
        ++gFailed;
        std::cerr << "FAIL [" << gCurrent << "] line " << line << ": " << expression << " (got " << a
                  << ", expected " << b << " +/- " << eps << ")\n";
    }
}

#define CHECK(expr) Check((expr), #expr, __LINE__)
#define CHECK_NEAR(a, b, eps) CheckNear((a), (b), (eps), #a " ~= " #b, __LINE__)

void Begin(const std::string& name) {
    gCurrent = name;
    std::cout << "== " << name << "\n";
}

std::string ReadFile(const std::filesystem::path& path) {
    std::ifstream stream(path, std::ios::binary);
    std::ostringstream out;
    out << stream.rdbuf();
    return out.str();
}

bool ParseCif(const std::string& text, Structure& structure) {
    ParseError error;
    if (!ParseCifText(text, structure, error)) {
        std::cerr << "CIF error: " << error.message << " (line " << error.line << ")\n";
        return false;
    }
    FinalizeStructure(structure, true);
    return true;
}

const char* kNaCl = R"CIF(
data_rock_salt
_chemical_name_common 'Rock salt'
_chemical_formula_sum 'Na Cl'
_cell_length_a 5.6402
_cell_length_b 5.6402
_cell_length_c 5.6402
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'F m -3 m'
loop_
_symmetry_equiv_pos_site_id
_symmetry_equiv_pos_as_xyz
1 'x,y,z'
2 'x,y+1/2,z+1/2'
3 'x+1/2,y,z+1/2'
4 'x+1/2,y+1/2,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Na1 Na 0.0 0.0 0.0 1.0
Cl1 Cl 0.5 0.0 0.0 1.0
)CIF";

const char* kSemicolon = R"CIF(
data_text_test
_chemical_name_common
;
A title
on two lines
;
_cell_length_a 4
_cell_length_b 4
_cell_length_c 4
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Si1 Si 0 0 0
)CIF";

void TestCellMath() {
    Begin("cell parameters and fractional transforms");
    Cell cell;
    std::string error;
    CHECK(cell.SetFromParameters(3.0, 4.0, 5.0, 90, 90, 90, &error));
    CHECK_NEAR(cell.volume, 60.0, 1e-9);
    const Vec3 cart = cell.FractionalToCartesian({0.25, 0.5, 0.75});
    CHECK_NEAR(cart.x, 0.75, 1e-9);
    CHECK_NEAR(cart.y, 2.0, 1e-9);
    CHECK_NEAR(cart.z, 3.75, 1e-9);
    const Vec3 frac = cell.CartesianToFractional(cart);
    CHECK_NEAR(frac.x, 0.25, 1e-9);
    CHECK_NEAR(frac.y, 0.5, 1e-9);
    CHECK_NEAR(frac.z, 0.75, 1e-9);
    CHECK(!cell.SetFromParameters(3.0, 3.0, 3.0, 0.0, 90.0, 90.0, &error));

    Cell triclinic;
    CHECK(triclinic.SetFromParameters(5.0, 6.0, 7.0, 78.0, 83.0, 74.0, &error));
    const Vec3 p = triclinic.FractionalToCartesian({0.12, 0.45, 0.77});
    const Vec3 q = triclinic.CartesianToFractional(p);
    CHECK_NEAR(q.x, 0.12, 1e-8);
    CHECK_NEAR(q.y, 0.45, 1e-8);
    CHECK_NEAR(q.z, 0.77, 1e-8);
}

void TestSymmetryParser() {
    Begin("symmetry operation parser");
    SymmetryOp op;
    std::string error;
    CHECK(ParseSymmetryOperation("-y, x-y, z+1/6", op, &error));
    CHECK_NEAR(op.m[0][1], -1.0, 1e-12);
    CHECK_NEAR(op.m[1][0], 1.0, 1e-12);
    CHECK_NEAR(op.m[1][1], -1.0, 1e-12);
    CHECK_NEAR(op.t.z, 1.0 / 6.0, 1e-12);
    Vec3 p = op.Apply({0.1, 0.2, 0.3});
    CHECK_NEAR(p.x, -0.2, 1e-12);
    CHECK_NEAR(p.y, -0.1, 1e-12);
    CHECK_NEAR(p.z, 0.3 + 1.0 / 6.0, 1e-12);

    CHECK(ParseSymmetryOperation("1 x,y,z", op, &error));
    CHECK_NEAR(op.m[0][0], 1.0, 1e-12);
    CHECK_NEAR(op.m[1][1], 1.0, 1e-12);
    CHECK_NEAR(op.m[2][2], 1.0, 1e-12);

    CHECK(ParseSymmetryOperation("x-y, -x, -z+2/3", op, &error));
    CHECK_NEAR(op.m[0][0], 1.0, 1e-12);
    CHECK_NEAR(op.m[0][1], -1.0, 1e-12);
    CHECK_NEAR(op.m[1][0], -1.0, 1e-12);
    CHECK_NEAR(op.t.z, 2.0 / 3.0, 1e-12);

    CHECK(!ParseSymmetryOperation("x*y, z, 0", op, &error));
    CHECK(!ParseSymmetryOperation("x, y", op, &error));
}

void TestCifBasic() {
    Begin("CIF parsing, symmetry expansion, bonds");
    Structure structure;
    CHECK(ParseCif(kNaCl, structure));
    CHECK(structure.atoms.size() == 8);
    CHECK_NEAR(structure.cell.a, 5.6402, 1e-9);
    CHECK(structure.spaceGroup.find("F m -3 m") != std::string::npos);
    CHECK(structure.formula.find("Na") != std::string::npos);
    CHECK(structure.cellContents == "Na4 Cl4");
    CHECK(structure.periodic);
    CHECK(!structure.bonds.empty());
    CHECK(structure.bonds.size() == 24);
    for (const Bond& bond : structure.bonds) CHECK_NEAR(bond.length, 2.8201, 0.002);
    bool foundNaCl = false;
    for (const Bond& bond : structure.bonds) {
        const Atom& a = structure.atoms[static_cast<size_t>(bond.a)];
        const Atom& b = structure.atoms[static_cast<size_t>(bond.b)];
        if ((a.element == "Na" && b.element == "Cl") || (a.element == "Cl" && b.element == "Na")) {
            foundNaCl = true;
            CHECK_NEAR(bond.length, 2.8201, 0.002);
        }
    }
    CHECK(foundNaCl);

    double distance = MeasureDistance(structure, 0, 4);
    CHECK_NEAR(distance, 2.8201, 0.002);
}

void TestCifText() {
    Begin("CIF quoted and semicolon text fields");
    Structure structure;
    CHECK(ParseCif(kSemicolon, structure));
    CHECK(structure.title == "A title on two lines");
    CHECK(structure.atoms.size() == 1);
    CHECK(structure.atoms[0].element == "Si");
}

void TestDuplicatePositions() {
    Begin("special-position de-duplication");
    Structure structure;
    const char* text = R"CIF(
data_special
_cell_length_a 5
_cell_length_b 5
_cell_length_c 5
loop_
_symmetry_equiv_pos_as_xyz
'x,y,z'
'-x,-y,-z'
'x+1/2,y+1/2,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Na1 Na 0 0 0
)CIF";
    CHECK(ParseCif(text, structure));
    CHECK(structure.atoms.size() == 2);
    CHECK(structure.symmetryOps.size() == 3);
}

void TestXyz() {
    Begin("XYZ parsing and molecular geometry");
    const std::string text = "3\nwater molecule\nO 0.000000 0.000000 0.000000\n"
                             "H 0.757000 0.586000 0.000000\nH -0.757000 0.586000 0.000000\n";
    Structure structure;
    ParseError error;
    CHECK(ParseXyzText(text, structure, error));
    FinalizeStructure(structure, false);
    CHECK(structure.atoms.size() == 3);
    CHECK(structure.format == SourceFormat::Xyz);
    CHECK(!structure.cell.valid);
    CHECK_NEAR(MeasureDistance(structure, 0, 1), std::sqrt(0.757 * 0.757 + 0.586 * 0.586), 1e-6);
    double angle = 0;
    CHECK(MeasureAngle(structure, 1, 0, 2, angle));
    CHECK_NEAR(angle, 104.47, 0.1);
    CHECK(!structure.bonds.empty());
}

void TestVesta() {
    Begin("VESTA text format");
    const std::string text = R"VESTA(#VESTA_FORMAT_VERSION 3.5.4

CRYSTAL

TITLE
Rock salt from VESTA

CELLP
 5.6402 5.6402 5.6402 90.0 90.0 90.0
 0 0 0 0 0 0

GROUP
 225 1 F m -3 m

SYMOP
 0.0 0.0 0.0 1 0 0 0 1 0 0 0 1 1
 0.0 0.5 0.5 1 0 0 0 1 0 0 0 1 1
 0.5 0.0 0.5 1 0 0 0 1 0 0 0 1 1
 0.5 0.5 0.0 1 0 0 0 1 0 0 0 1 1
 -1.0 -1.0 -1.0 0 0 0 0 0 0 0 0 0

STRUC
 1 Na Na1 1.0000 0.0000 0.0000 0.0000 4a 1
 0.0000 0.0000 0.0000 0.00
 2 Cl Cl1 1.0000 0.5000 0.0000 0.0000 4b 1
 0.0000 0.0000 0.0000 0.00
 0 0 0 0 0 0 0

THERI 1
 1 Na 0.01
 0 0 0
)VESTA";
    Structure structure;
    ParseError error;
    CHECK(ParseVestaText(text, structure, error));
    CHECK(structure.symmetryOps.size() == 4);
    FinalizeStructure(structure, true);
    CHECK(structure.atoms.size() == 8);
    CHECK(structure.bonds.size() == 24);
    CHECK(structure.title == "Rock salt from VESTA");
}

void TestUnquotedSymmetry() {
    Begin("unquoted symmetry operation lines");
    const char* text = R"CIF(
data_unquoted_symops
_cell_length_a 5
_cell_length_b 6
_cell_length_c 7
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P -1'
_symmetry_equiv_pos_as_xyz
x, y, z
-x, -y, -z
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.1 0.2 0.3
)CIF";
    Structure structure;
    ParseError error;
    CHECK(ParseCifText(text, structure, error));
    CHECK(structure.symmetryOps.size() == 2);
    FinalizeStructure(structure, true);
    CHECK(structure.atoms.size() == 2);
    CHECK(structure.bonds.empty());
}

void TestFileLoading() {
    Begin("file loading from examples");
    const std::filesystem::path examples = CL_EXAMPLES_DIR;
    for (const char* name : {"quartz.cif", "diamond.cif", "water.xyz", "nacl.vesta"}) {
        const std::filesystem::path path = examples / name;
        Structure structure;
        ParseError error;
        const bool ok = LoadStructureFile(path.wstring(), structure, error);
        CHECK(ok);
        if (!ok) std::cerr << "  " << name << ": " << error.message << "\n";
        else {
            CHECK(!structure.atoms.empty());
            CHECK(structure.boundRadius > 0.0);
            std::cout << "  " << name << ": " << structure.atoms.size() << " atoms, "
                      << structure.bonds.size() << " bonds, " << structure.cellContents << "\n";
        }
    }
}

void TestQuartzGeometry() {
    Begin("quartz structure and Si-O bonds");
    Structure structure;
    ParseError error;
    const std::filesystem::path path = std::filesystem::path(CL_EXAMPLES_DIR) / "quartz.cif";
    CHECK(LoadStructureFile(path.wstring(), structure, error));
    CHECK(structure.atoms.size() == 9);
    CHECK(structure.cellContents == "O6 Si3");
    CHECK(structure.bonds.size() == 12);
    int siO = 0;
    for (const Bond& bond : structure.bonds) {
        const Atom& a = structure.atoms[static_cast<size_t>(bond.a)];
        const Atom& b = structure.atoms[static_cast<size_t>(bond.b)];
        if ((a.element == "Si" && b.element == "O") || (a.element == "O" && b.element == "Si")) {
            ++siO;
            if (bond.length < 1.50 || bond.length > 1.75)
                std::cerr << "  unusual Si-O distance: " << bond.length << "\n";
            CHECK(bond.length > 1.45 && bond.length < 1.80);
        }
    }
    CHECK(siO >= 12);
}

void TestEditingAndExport() {
    Begin("structure editing and export");
    Structure structure;
    ParseError loadError;
    const std::filesystem::path quartz = std::filesystem::path(CL_EXAMPLES_DIR) / "quartz.cif";
    CHECK(LoadStructureFile(quartz.wstring(), structure, loadError));
    const size_t asymmetricBefore = structure.asymmetricAtoms.size();
    const size_t displayedBefore = structure.atoms.size();
    CHECK(asymmetricBefore == 2);
    CHECK(displayedBefore == 9);

    int z = 0;
    std::string symbol;
    std::string elementError;
    CHECK(ElementFromInput("14", z, symbol, &elementError));
    CHECK(z == 14 && symbol == "Si");
    CHECK(ElementFromInput("fe", z, symbol, &elementError));
    CHECK(z == 26 && symbol == "Fe");
    CHECK(!ElementFromInput("Qq", z, symbol, &elementError));

    const double oldA = structure.cell.a;
    CHECK(SetCellParameters(structure, 5.1000, structure.cell.b, structure.cell.c, structure.cell.alpha,
                            structure.cell.beta, structure.cell.gamma, &elementError));
    CHECK_NEAR(structure.cell.a, 5.1000, 1e-9);
    CHECK(structure.cell.volume > 0.0);
    CHECK(structure.asymmetricAtoms.size() == asymmetricBefore);
    CHECK(structure.atoms.size() == displayedBefore);
    CHECK(!SetCellParameters(structure, -1.0, structure.cell.b, structure.cell.c, structure.cell.alpha,
                             structure.cell.beta, structure.cell.gamma, &elementError));
    CHECK_NEAR(structure.cell.a, 5.1000, 1e-9);

    Atom oxygen;
    oxygen.atomicNumber = 8;
    oxygen.element = "O";
    oxygen.frac = {0.13, 0.27, 0.41};
    oxygen.occupancy = 1.0;
    const int addedSite = AddAtomSite(structure, oxygen, &elementError);
    CHECK(addedSite == static_cast<int>(asymmetricBefore));
    if (addedSite < 0) std::cerr << "  add atom: " << elementError << "\n";
    CHECK(structure.asymmetricAtoms.size() == asymmetricBefore + 1);
    CHECK(structure.atoms.size() > displayedBefore);
    CHECK(structure.asymmetricAtoms.back().element == "O");

    Atom updated = structure.asymmetricAtoms[static_cast<size_t>(addedSite)];
    updated.atomicNumber = 7;
    updated.label = "N_test";
    updated.frac = {0.22, 0.31, 0.44};
    CHECK(UpdateAtomSite(structure, addedSite, updated, &elementError));
    CHECK(structure.asymmetricAtoms[static_cast<size_t>(addedSite)].element == "N");
    CHECK(structure.asymmetricAtoms[static_cast<size_t>(addedSite)].label == "N_test");
    bool foundUpdated = false;
    for (const Atom& atom : structure.atoms) {
        if (atom.siteIndex == addedSite && atom.atomicNumber == 7) foundUpdated = true;
    }
    CHECK(foundUpdated);

    CHECK(DeleteAtomSite(structure, addedSite, &elementError));
    CHECK(structure.asymmetricAtoms.size() == asymmetricBefore);
    CHECK(structure.atoms.size() == displayedBefore);
    CHECK(!DeleteAtomSite(structure, 999, &elementError));
    CHECK(structure.cellContents == "O6 Si3");

    Atom moleculeAtom;
    moleculeAtom.atomicNumber = 6;
    moleculeAtom.cart = {1.0, 2.0, 3.0};
    Structure molecule;
    ParseError moleculeError;
    CHECK(LoadStructureFile((std::filesystem::path(CL_EXAMPLES_DIR) / "water.xyz").wstring(), molecule,
                            moleculeError));
    CHECK(AddAtomSite(molecule, moleculeAtom, &elementError) >= 0);
    CHECK(molecule.atoms.size() == 4);
    CHECK(!ExportStructureToCif(molecule, std::filesystem::path(CL_EXAMPLES_DIR).parent_path() / "build" /
                                             "crystallens_molecule_test.cif",
                                &elementError));
    CHECK(ExportStructureToXyz(molecule, std::filesystem::path(CL_EXAMPLES_DIR).parent_path() / "build" /
                                            "crystallens_molecule_test.xyz",
                               &elementError));

    const std::filesystem::path build = std::filesystem::current_path();
    const std::filesystem::path cifPath = build / "crystallens_edit_test.cif";
    const std::filesystem::path xyzPath = build / "crystallens_edit_test.xyz";
    std::error_code removeError;
    std::filesystem::remove(cifPath, removeError);
    std::filesystem::remove(xyzPath, removeError);

    CHECK(ExportStructureToCif(structure, cifPath.wstring(), &elementError));
    if (!elementError.empty()) std::cerr << "  export CIF: " << elementError << "\n";
    Structure reloadedCif;
    ParseError reloadError;
    const bool cifLoaded = LoadStructureFile(cifPath.wstring(), reloadedCif, reloadError);
    CHECK(cifLoaded);
    if (cifLoaded) {
        CHECK_NEAR(reloadedCif.cell.a, structure.cell.a, 1e-5);
        CHECK(reloadedCif.asymmetricAtoms.size() == structure.asymmetricAtoms.size());
        CHECK(reloadedCif.atoms.size() == structure.atoms.size());
        CHECK(reloadedCif.symmetryOps.size() == structure.symmetryOps.size());
    }

    CHECK(ExportStructureToXyz(structure, xyzPath.wstring(), &elementError));
    Structure reloadedXyz;
    const bool xyzLoaded = LoadStructureFile(xyzPath.wstring(), reloadedXyz, reloadError);
    CHECK(xyzLoaded);
    if (xyzLoaded) {
        CHECK(reloadedXyz.atoms.size() == structure.atoms.size());
        CHECK(reloadedXyz.format == SourceFormat::Xyz);
        CHECK_NEAR(reloadedXyz.atoms[0].cart.x, structure.atoms[0].cart.x, 1e-5);
        CHECK_NEAR(reloadedXyz.atoms[0].cart.y, structure.atoms[0].cart.y, 1e-5);
        CHECK_NEAR(reloadedXyz.atoms[0].cart.z, structure.atoms[0].cart.z, 1e-5);
    }
    std::filesystem::remove(cifPath, removeError);
    std::filesystem::remove(xyzPath, removeError);
    std::filesystem::remove(build / "crystallens_molecule_test.xyz", removeError);
    (void)oldA;
}

void TestSkewImagesAndGrid() {
    Begin("skew nearest image, translated self-edges, grid equivalence");
    Structure s;
    CHECK(s.cell.SetFromParameters(2.3, 19, 17, 75, 72, 12));
    // Exhaustive reference includes shifts outside the usual 3x3x3 stencil.
    bool outside = false;
    for (int n = 1; n <= 72; ++n) {
        const Vec3 d{std::sin(n*1.1), std::cos(n*0.7), std::sin(n*0.37)};
        const Vec3 actual = s.cell.MinimumFractionalDelta(d);
        double best = 1e9;
        for (int i=-20; i<=20; ++i)
            for (int j=-4; j<=4; ++j)
                for (int k=-3; k<=3; ++k)
                    best = std::min(best, Length(s.cell.FractionalToCartesian(d + Vec3(i,j,k))));
        CHECK_NEAR(Length(s.cell.FractionalToCartesian(actual)), best, 1e-9);
        if (std::abs(actual.x - d.x) > 1.5) outside = true;
    }
    CHECK(outside);
    CHECK(s.cell.SetFromParameters(1.5, 20, 20, 90, 90, 90));
    Atom carbon;
    carbon.element = "C";
    carbon.atomicNumber = 6;
    s.asymmetricAtoms = {carbon};
    FinalizeStructure(s, true);
    CHECK(s.bonds.size() == 1);
    if (!s.bonds.empty()) {
        CHECK(s.bonds[0].a == s.bonds[0].b);
        CHECK_NEAR(s.bonds[0].length, 1.5, 1e-10);
    }
    BuildBonds(s, 1.0);
    CHECK(s.bonds.empty());
    // The direct pair crossing a narrow oblique face spans many old fractional bins.
    CHECK(s.cell.SetFromParameters(31, 30, 8, 90, 90, 5));
    carbon.frac = {0.1,0.8,0};
    s.asymmetricAtoms = {carbon};
    carbon.frac = {0.65,0.25,0};
    s.asymmetricAtoms.push_back(carbon);
    FinalizeStructure(s, true);
    const auto expected = s.bonds;
    CHECK(!expected.empty());
    // Inert placeholders trigger the 1600-site grid using the identical active sites.
    s.atoms.resize(1600);
    BuildBonds(s);
    CHECK(s.bonds.size() == expected.size());
    for (size_t i=0; i<std::min(s.bonds.size(),expected.size()); ++i) {
        CHECK(s.bonds[i].shift == expected[i].shift);
        CHECK(s.bonds[i].a == expected[i].a && s.bonds[i].b == expected[i].b);
    }
}

void TestCifCompatibility() {
    Begin("CIF lexical boundaries, Cartesian fallback, disorder and round-trip");
    const char* input = R"CIF(data_parse
_chemical_name_common 'O'Brien crystal'
_cell.length_a 1.000(2)e1
_cell.length_b 10
_cell.length_c 10
loop_
_space_group_symop.id
_space_group_symop.operation_xyz
1 x, y, z
loop_
_atom_site.label
_atom_site.type_symbol
_atom_site.fract_x
_atom_site.fract_y
_atom_site.fract_z
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.disorder_assembly
_atom_site.disorder_group
C#1 C ? ? ? 1 2 3 A 1
C2 C .2 .2 .3 ? ? ? A 2
C3 C .3 .2 .3 ? ? ? B 1
)CIF";
    Structure s;
    CHECK(ParseCif(input, s));
    if (s.atoms.size() != 3) { CHECK(false); return; }
    CHECK(s.title == "O'Brien crystal");
    CHECK(s.atoms[0].label == "C#1");
    CHECK_NEAR(s.atoms[0].frac.y, 0.2, 1e-12);
    CHECK_NEAR(s.cell.a, 10.0, 1e-12);
    CHECK(s.bonds.size() == 1);
    if (!s.bonds.empty()) CHECK(s.bonds[0].a == 1 && s.bonds[0].b == 2);
    const auto path = std::filesystem::current_path() / "cif_roundtrip_test.cif";
    ParseError err;
    auto roundtrip = [&]() {
        CHECK(ExportStructureToCif(s, path.wstring()));
        Structure reloaded;
        CHECK(LoadStructureFile(path.wstring(), reloaded, err));
        CHECK(s.atoms.size() == reloaded.atoms.size());
        CHECK(s.bonds.size() == reloaded.bonds.size());
        for (size_t i = 0; i < std::min(s.atoms.size(), reloaded.atoms.size()); ++i) {
            CHECK_NEAR(Length(s.atoms[i].cart - reloaded.atoms[i].cart), 0.0, 1e-7);
            CHECK(s.atoms[i].disorderGroup == reloaded.atoms[i].disorderGroup);
            CHECK(s.atoms[i].label == reloaded.atoms[i].label);
        }
        CHECK(s.title == reloaded.title);
    };
    roundtrip();
    CHECK(LoadStructureFile((std::filesystem::path(CL_EXAMPLES_DIR)/"nacl.vesta").wstring(),s,err));
    CHECK(s.spaceGroup == "F m -3 m");
    roundtrip();
    std::string vestaText = ReadFile(std::filesystem::path(CL_EXAMPLES_DIR)/"nacl.vesta");
    const size_t symStart = vestaText.find("SYMOP");
    const size_t symEnd = vestaText.find("STRUC", symStart);
    if (symStart != std::string::npos && symEnd != std::string::npos) {
        vestaText.replace(symStart, symEnd - symStart,
                          "SYMOP\n0 0 0 1 0 0 0 1 0 0 0 1\n0.5 0 0 0 -1 0 1 0 0 0 0 1\n\n");
        CHECK(ParseVestaText(vestaText,s,err));
        FinalizeStructure(s,true);
        roundtrip();
    }
    std::filesystem::remove(path);
    const std::string single = "data_one\n_atom_site.label O1\n_atom_site.Cartn_x 1\n"
                               "_atom_site.Cartn_y 2\n_atom_site.Cartn_z 3\n";
    CHECK(ParseCif(single,s));
    CHECK(!s.cell.valid && s.atoms.size() == 1 && s.atoms[0].atomicNumber == 8);
    const std::string bad = "data_bad\nloop_\n_atom_site.label\n_atom_site.Cartn_x\n"
                            "_atom_site.Cartn_y\n_atom_site.Cartn_z\nO1 0 0 0\nC1 0 0 inf/2\n";
    CHECK(!ParseCifText(bad,s,err));
    CHECK(err.line == 8);
    CHECK(ParseXyzText("2\nnumbers\n8 0 0 0\nX 1 0 0\n", s, err));
    FinalizeStructure(s,false);
    CHECK(s.atoms[0].atomicNumber == 8 && s.atoms[1].atomicNumber == 0 && s.bonds.empty());
}

void TestElementNames() {
    Begin("chemical element normalization");
    CHECK(NormalizeElementSymbol("Fe3+") == "Fe");
    CHECK(NormalizeElementSymbol("O2-") == "O");
    CHECK(NormalizeElementSymbol("C1") == "C");
    CHECK(NormalizeElementSymbol("CA") == "Ca");
    CHECK(NormalizeElementSymbol("13C") == "C");
    CHECK(ElementBySymbol("Si").z == 14);
    CHECK(ElementByZ(26).symbol == std::string("Fe"));
}

} // namespace

int main() {
    std::cout << "CrystalLens core tests\n";
    TestElementNames();
    TestSkewImagesAndGrid();
    TestCifCompatibility();
    TestCellMath();
    TestSymmetryParser();
    TestCifBasic();
    TestCifText();
    TestUnquotedSymmetry();
    TestDuplicatePositions();
    TestXyz();
    TestVesta();
    TestFileLoading();
    TestQuartzGeometry();
    TestEditingAndExport();
    std::cout << "\n" << gPassed << " checks passed, " << gFailed << " failed\n";
    return gFailed == 0 ? 0 : 1;
}

