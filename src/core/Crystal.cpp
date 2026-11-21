#include "Crystal.h"

#include "CifParser.h"
#include "PeriodicTable.h"
#include "VestaParser.h"
#include "XyzParser.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <set>
#include <sstream>
#include <unordered_set>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace cl {

const wchar_t* FormatDisplayName(SourceFormat format) {
    switch (format) {
    case SourceFormat::Cif: return L"CIF";
    case SourceFormat::Xyz: return L"XYZ";
    case SourceFormat::Vesta: return L"VESTA";
    default: return L"未知";
    }
}

bool Cell::SetFromParameters(double a_, double b_, double c_, double alpha_, double beta_, double gamma_,
                             std::string* error) {
    if (!(a_ > 0.0) || !(b_ > 0.0) || !(c_ > 0.0) || !std::isfinite(a_) || !std::isfinite(b_) ||
        !std::isfinite(c_) || !std::isfinite(alpha_) || !std::isfinite(beta_) || !std::isfinite(gamma_)) {
        if (error) *error = "晶胞参数必须是正数";
        return false;
    }
    if (alpha_ <= 0.0 || alpha_ >= 180.0 || beta_ <= 0.0 || beta_ >= 180.0 || gamma_ <= 0.0 ||
        gamma_ >= 180.0) {
        if (error) *error = "晶胞角必须在 0° 与 180° 之间";
        return false;
    }
    const double ca = std::cos(alpha_ * kDegToRad);
    const double cb = std::cos(beta_ * kDegToRad);
    const double cg = std::cos(gamma_ * kDegToRad);
    const double sg = std::sin(gamma_ * kDegToRad);
    if (std::abs(sg) < 1e-10) {
        if (error) *error = "晶胞角组合退化";
        return false;
    }
    const double cx = c_ * cb;
    const double cy = c_ * (ca - cb * cg) / sg;
    const double cz2 = c_ * c_ - cx * cx - cy * cy;
    if (cz2 <= 1e-12) {
        if (error) *error = "晶胞参数不能构成有效晶胞";
        return false;
    }
    a = a_;
    b = b_;
    c = c_;
    alpha = alpha_;
    beta = beta_;
    gamma = gamma_;
    aVec = {a_, 0.0, 0.0};
    bVec = {b_ * cg, b_ * sg, 0.0};
    cVec = {cx, cy, std::sqrt(cz2)};
    volume = std::abs(Dot(aVec, Cross(bVec, cVec)));
    valid = std::isfinite(volume) && volume > 1e-9;
    if (!valid) {
        if (error) *error = "晶胞体积为零";
        return false;
    }
    return true;
}

Vec3 Cell::FractionalToCartesian(const Vec3& f) const {
    return aVec * f.x + bVec * f.y + cVec * f.z;
}

Vec3 Cell::CartesianToFractional(const Vec3& p) const {
    const double det = Dot(aVec, Cross(bVec, cVec));
    if (std::abs(det) < 1e-15) return {};
    return {Dot(p, Cross(bVec, cVec)) / det, Dot(aVec, Cross(p, cVec)) / det,
            Dot(aVec, Cross(bVec, p)) / det};
}

namespace {

// SetFromParameters constructs an upper triangular Cartesian basis. Slice the
// search sphere by lattice planes and rows, leaving only a 1-D interval in x.
// The visitor can shrink the sphere or stop when the bond budget is reached.
template<class Visitor>
void VisitImageRows(const Cell& cell, const Vec3& df, double& radiusSq, Visitor visit) {
    const double radius = std::sqrt(radiusSq);
    const auto zFirst = static_cast<int64_t>(std::ceil(-df.z - radius / cell.cVec.z));
    const auto zLast = static_cast<int64_t>(std::floor(-df.z + radius / cell.cVec.z));
    for (int64_t iz = zFirst; iz <= zLast; ++iz) {
        const double fz = df.z + iz;
        const double z = cell.cVec.z * fz;
        const double yzRoom = radiusSq - z * z;
        if (yzRoom < 0) continue;
        const double yCenter = -df.y - cell.cVec.y * fz / cell.bVec.y;
        const double yRadius = std::sqrt(yzRoom) / cell.bVec.y;
        const auto yLast = static_cast<int64_t>(std::floor(yCenter + yRadius));
        for (int64_t iy = static_cast<int64_t>(std::ceil(yCenter - yRadius)); iy <= yLast; ++iy) {
            const double fy = df.y + iy;
            const double y = cell.bVec.y * fy + cell.cVec.y * fz;
            const double room = radiusSq - z * z - y * y;
            if (room < 0) continue;
            const double xCenter = -df.x - (cell.bVec.x * fy + cell.cVec.x * fz) / cell.a;
            if (!visit(iy, iz, xCenter, std::sqrt(room) / cell.a)) return;
        }
    }
}

} // namespace

Vec3 Cell::MinimumFractionalDelta(const Vec3& delta) const {
    Vec3 best = WrapHalf(delta);
    if (!valid || (alpha == 90 && beta == 90 && gamma == 90)) return best;
    const Vec3 df = best;
    // Start with a nearby lattice point even for very oblique bases.
    Vec3 seed = df;
    seed.y -= std::round(seed.y + cVec.y * seed.z / bVec.y);
    seed.x -= std::round(seed.x + (bVec.x * seed.y + cVec.x * seed.z) / a);
    double radiusSq = LengthSq(FractionalToCartesian(best));
    const double seedSq = LengthSq(FractionalToCartesian(seed));
    if (seedSq < radiusSq) { best = seed; radiusSq = seedSq; }
    VisitImageRows(*this, df, radiusSq, [&](int64_t iy, int64_t iz, double xCenter, double) {
        const Vec3 candidate{df.x + std::round(xCenter), df.y + iy, df.z + iz};
        const double lengthSq = LengthSq(FractionalToCartesian(candidate));
        if (lengthSq < radiusSq) { best = candidate; radiusSq = lengthSq; }
        return true;
    });
    return best;
}

Vec3 Cell::MinimumImageVector(const Vec3& fromCart, const Vec3& toCart) const {
    if (!valid) return toCart - fromCart;
    const Vec3 df = MinimumFractionalDelta(CartesianToFractional(toCart - fromCart));
    return FractionalToCartesian(df);
}

Vec3 Cell::ImageOffset(const Vec3& fromCart, const Vec3& toCart) const {
    if (!valid) return {};
    return MinimumImageVector(fromCart, toCart) - (toCart - fromCart);
}

std::array<Vec3, 8> Cell::Corners() const {
    std::array<Vec3, 8> out{};
    int i = 0;
    for (int z = 0; z <= 1; ++z)
        for (int y = 0; y <= 1; ++y)
            for (int x = 0; x <= 1; ++x) out[i++] = FractionalToCartesian({double(x), double(y), double(z)});
    return out;
}

Vec3 SymmetryOp::Apply(const Vec3& f) const {
    return {m[0][0] * f.x + m[0][1] * f.y + m[0][2] * f.z + t.x,
            m[1][0] * f.x + m[1][1] * f.y + m[1][2] * f.z + t.y,
            m[2][0] * f.x + m[2][1] * f.y + m[2][2] * f.z + t.z};
}

namespace {

struct Linear {
    double c[3] = {0, 0, 0};
    double k = 0.0;
};

Linear Add(const Linear& a, const Linear& b) {
    return {{a.c[0] + b.c[0], a.c[1] + b.c[1], a.c[2] + b.c[2]}, a.k + b.k};
}
Linear Sub(const Linear& a, const Linear& b) {
    return {{a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]}, a.k - b.k};
}
bool IsConstant(const Linear& a) { return std::abs(a.c[0]) + std::abs(a.c[1]) + std::abs(a.c[2]) < 1e-12; }
Linear Scale(const Linear& a, double s) { return {{a.c[0] * s, a.c[1] * s, a.c[2] * s}, a.k * s}; }
Linear Mul(const Linear& a, const Linear& b) {
    if (IsConstant(a)) return Scale(b, a.k);
    if (IsConstant(b)) return Scale(a, b.k);
    return {};
}

class ExpressionParser {
public:
    ExpressionParser(std::string_view source, std::string* error) : s_(source), error_(error) {}

    bool Parse(Linear& out) {
        Skip();
        out = ParseExpr();
        Skip();
        if (failed_ || pos_ != s_.size()) {
            Fail("对称操作表达式无法解析");
            return false;
        }
        return true;
    }

private:
    std::string_view s_;
    size_t pos_ = 0;
    std::string* error_;
    bool failed_ = false;

    void Fail(const char* message) {
        if (!failed_ && error_) *error_ = message;
        failed_ = true;
    }

    void Skip() {
        while (pos_ < s_.size() && std::isspace(static_cast<unsigned char>(s_[pos_]))) ++pos_;
    }

    bool Eat(char c) {
        Skip();
        if (pos_ < s_.size() && s_[pos_] == c) {
            ++pos_;
            return true;
        }
        return false;
    }

    Linear ParseExpr() {
        Linear value = ParseTerm();
        for (;;) {
            Skip();
            if (pos_ >= s_.size()) break;
            if (s_[pos_] == '+') {
                ++pos_;
                value = Add(value, ParseTerm());
            } else if (s_[pos_] == '-') {
                ++pos_;
                value = Sub(value, ParseTerm());
            } else {
                break;
            }
        }
        return value;
    }

    Linear ParseTerm() {
        Linear value = ParseFactor();
        for (;;) {
            Skip();
            if (pos_ >= s_.size()) break;
            if (s_[pos_] == '*') {
                ++pos_;
                Linear rhs = ParseFactor();
                if (!IsConstant(value) && !IsConstant(rhs)) {
                    Fail("对称操作中出现非线性乘积");
                    return {};
                }
                value = Mul(value, rhs);
            } else if (s_[pos_] == '/') {
                ++pos_;
                Linear rhs = ParseFactor();
                if (!IsConstant(rhs) || std::abs(rhs.k) < 1e-12) {
                    Fail("对称操作中出现非法除法");
                    return {};
                }
                value = Scale(value, 1.0 / rhs.k);
            } else {
                break;
            }
        }
        return value;
    }

    Linear ParseFactor() {
        Skip();
        if (pos_ >= s_.size()) {
            Fail("对称操作表达式不完整");
            return {};
        }
        if (s_[pos_] == '+') {
            ++pos_;
            return ParseFactor();
        }
        if (s_[pos_] == '-') {
            ++pos_;
            return Scale(ParseFactor(), -1.0);
        }
        if (s_[pos_] == '(') {
            ++pos_;
            Linear inner = ParseExpr();
            if (!Eat(')')) Fail("对称操作中括号不匹配");
            return inner;
        }
        const char c = s_[pos_];
        const char lower = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (lower == 'x' || lower == 'y' || lower == 'z') {
            ++pos_;
            Linear out;
            out.c[lower == 'x' ? 0 : (lower == 'y' ? 1 : 2)] = 1.0;
            return out;
        }
        if (std::isdigit(static_cast<unsigned char>(c)) || c == '.') {
            const size_t start = pos_;
            bool dot = false;
            while (pos_ < s_.size()) {
                const char d = s_[pos_];
                if (std::isdigit(static_cast<unsigned char>(d))) {
                    ++pos_;
                } else if (d == '.' && !dot) {
                    dot = true;
                    ++pos_;
                } else {
                    break;
                }
            }
            std::string number(s_.substr(start, pos_ - start));
            if (number.empty() || number == ".") {
                Fail("对称操作中的数字无效");
                return {};
            }
            try {
                Linear out;
                out.k = std::stod(number);
                return out;
            } catch (...) {
                Fail("对称操作中的数字无效");
                return {};
            }
        }
        Fail("对称操作中出现未知字符");
        return {};
    }
};

std::string StripLeadingOperationNumber(std::string_view text) {
    size_t i = 0;
    while (i < text.size() && std::isspace(static_cast<unsigned char>(text[i]))) ++i;
    size_t j = i;
    while (j < text.size() && std::isdigit(static_cast<unsigned char>(text[j]))) ++j;
    if (j > i && j < text.size() && std::isspace(static_cast<unsigned char>(text[j]))) {
        while (j < text.size() && std::isspace(static_cast<unsigned char>(text[j]))) ++j;
        if (j < text.size() && (text[j] == 'x' || text[j] == 'y' || text[j] == 'z' || text[j] == '-' ||
                                text[j] == '+' || text[j] == '(' || std::isdigit(static_cast<unsigned char>(text[j])))) {
            return std::string(text.substr(j));
        }
    }
    return std::string(text);
}

} // namespace

bool ParseSymmetryOperation(std::string_view text, SymmetryOp& out, std::string* error) {
    std::string body = StripLeadingOperationNumber(text);
    while (!body.empty() && std::isspace(static_cast<unsigned char>(body.back()))) body.pop_back();
    if (body.empty()) {
        if (error) *error = "空的对称操作";
        return false;
    }
    std::vector<std::string> components;
    std::string current;
    int depth = 0;
    for (char c : body) {
        if (c == '(') ++depth;
        if (c == ')') --depth;
        if (c == ',' && depth == 0) {
            components.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    components.push_back(current);
    if (components.size() != 3) {
        if (error) *error = "对称操作必须包含 x,y,z 三个分量";
        return false;
    }
    SymmetryOp op;
    for (int i = 0; i < 3; ++i) {
        ExpressionParser parser(components[i], error);
        Linear linear;
        if (!parser.Parse(linear)) return false;
        for (int j = 0; j < 3; ++j) op.m[i][j] = linear.c[j];
        (&op.t.x)[i] = linear.k;
    }
    op.text = std::string(body);
    out = op;
    return true;
}

void Structure::ComputeBounds() {
    if (cell.valid) {
        center = (cell.aVec + cell.bVec + cell.cVec) * 0.5;
        double maxDist = 0.0;
        for (const Vec3& corner : cell.Corners()) maxDist = std::max(maxDist, Length(corner - center));
        for (const Atom& atom : atoms) maxDist = std::max(maxDist, Length(atom.cart - center));
        boundRadius = std::max(2.0, maxDist + 1.2);
        // A little extra room for bonds and labels crossing the cell boundary.
        boundRadius *= 1.06;
        return;
    }
    if (atoms.empty()) {
        center = {};
        boundRadius = 8.0;
        return;
    }
    Vec3 lo{std::numeric_limits<double>::max(), std::numeric_limits<double>::max(),
            std::numeric_limits<double>::max()};
    Vec3 hi{std::numeric_limits<double>::lowest(), std::numeric_limits<double>::lowest(),
            std::numeric_limits<double>::lowest()};
    for (const Atom& atom : atoms) {
        lo.x = std::min(lo.x, atom.cart.x);
        lo.y = std::min(lo.y, atom.cart.y);
        lo.z = std::min(lo.z, atom.cart.z);
        hi.x = std::max(hi.x, atom.cart.x);
        hi.y = std::max(hi.y, atom.cart.y);
        hi.z = std::max(hi.z, atom.cart.z);
    }
    center = (lo + hi) * 0.5;
    double maxDist = 0.0;
    for (const Atom& atom : atoms) maxDist = std::max(maxDist, Length(atom.cart - center));
    boundRadius = std::max({2.5, maxDist + 0.8, Length(hi - lo) * 0.5 + 0.8});
}

void Structure::ComputeContents() {
    elementCounts.clear();
    for (const Atom& atom : atoms) {
        elementCounts[atom.atomicNumber] += 1;
    }
    std::ostringstream oss;
    bool first = true;
    for (const auto& [z, count] : elementCounts) {
        if (!first) oss << ' ';
        first = false;
        oss << ElementByZ(z).symbol;
        if (count != 1) oss << count;
    }
    cellContents = oss.str();
    if (formula.empty()) formula = cellContents;
}

void ExpandAsymmetricUnit(Structure& structure, double tolerance) {
    if (!structure.cell.valid || structure.asymmetricAtoms.empty()) {
        structure.atoms = structure.asymmetricAtoms;
        for (size_t i = 0; i < structure.atoms.size(); ++i) {
            Atom& a = structure.atoms[i];
            if (a.baseLabel.empty()) a.baseLabel = a.label;
            a.siteIndex = static_cast<int>(i);
        }
        structure.symmetryExpanded = false;
        structure.truncated = false;
        return;
    }

    std::vector<SymmetryOp> ops = structure.symmetryOps;
    if (ops.empty()) ops.push_back(SymmetryOp{});
    else structure.symmetryExpanded = true;

    structure.atoms.clear();
    structure.atoms.reserve(std::min(kMaxDisplayAtoms, structure.asymmetricAtoms.size() * ops.size()));
    structure.truncated = false;

    for (size_t site = 0; site < structure.asymmetricAtoms.size(); ++site) {
        const Atom& source = structure.asymmetricAtoms[site];
        if (source.occupancy <= 0.0) continue;
        std::vector<Vec3> positions;
        std::vector<int> opIndices;
        positions.reserve(ops.size());
        opIndices.reserve(ops.size());
        for (size_t oi = 0; oi < ops.size(); ++oi) {
            Vec3 frac = Wrap01(ops[oi].Apply(source.frac));
            const Vec3 cart = structure.cell.FractionalToCartesian(frac);
            bool duplicate = false;
            for (const Vec3& existing : positions) {
                const Vec3 delta = structure.cell.MinimumFractionalDelta(frac - existing);
                const Vec3 deltaCart = structure.cell.FractionalToCartesian(delta);
                if (Length(deltaCart) < tolerance) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                positions.push_back(frac);
                opIndices.push_back(static_cast<int>(oi));
            }
        }
        if (positions.empty()) continue;
        for (size_t copy = 0; copy < positions.size(); ++copy) {
            if (structure.atoms.size() >= kMaxDisplayAtoms) {
                structure.truncated = true;
                break;
            }
            Atom atom = source;
            atom.frac = positions[copy];
            atom.cart = structure.cell.FractionalToCartesian(atom.frac);
            atom.siteIndex = static_cast<int>(site);
            atom.symmetryIndex = opIndices[copy];
            atom.symmetryGenerated = (opIndices[copy] != 0);
            if (atom.baseLabel.empty()) atom.baseLabel = atom.label;
            if (positions.size() > 1) atom.label = atom.baseLabel + "_" + std::to_string(copy + 1);
            else atom.label = atom.baseLabel;
            structure.atoms.push_back(std::move(atom));
        }
        if (structure.truncated) break;
    }
    if (structure.truncated) {
        structure.note += " 原子数超过 30,000，显示已截断。";
    }
    structure.symmetryOperatorCount = structure.symmetryOps.empty() ? 1 : static_cast<int>(structure.symmetryOps.size());
}

namespace {

double PairCutoff(const Atom& a, const Atom& b, double tolerance) {
    const auto knownGroup = [](const std::string& group) {
        return !group.empty() && group != "." && group != "?";
    };
    if (knownGroup(a.disorderGroup) && knownGroup(b.disorderGroup) &&
        a.disorderAssembly == b.disorderAssembly && a.disorderAssembly != "?" &&
        a.disorderGroup != b.disorderGroup) return 0.0;
    if (a.atomicNumber == 0 || b.atomicNumber == 0) return 0.0;
    return std::clamp(PairBondCutoff(a.atomicNumber, b.atomicNumber) * (tolerance / 1.20), 0.0, 6.0);
}

void ConsiderPair(const Structure& s, int i, int j, double tolerance, std::vector<Bond>& bonds,
                  bool& truncated) {
    const Atom& a = s.atoms[i];
    const Atom& b = s.atoms[j];
    const double cutoff = PairCutoff(a, b, tolerance);
    if (cutoff < 0.42) return;
    const Vec3 direct = b.cart - a.cart;
    auto add = [&](int tx, int ty, int tz) {
        // For a bond to another image of the same site, keep just one direction.
        if (i == j && std::array<int, 3>{tz, ty, tx} <= std::array<int, 3>{}) return;
        const Vec3 offset = s.cell.FractionalToCartesian({double(tx), double(ty), double(tz)});
        const double distSq = LengthSq(direct + offset);
        if (distSq < 0.42 * 0.42 || distSq > cutoff * cutoff + 1e-12) return;
        if (bonds.size() >= kMaxBonds) { truncated = true; return; }
        Bond bond;
        bond.a = i;
        bond.b = j;
        bond.shift = {tx, ty, tz};
        bond.imageOffset = offset;
        bond.length = std::sqrt(distSq);
        bond.periodic = s.cell.valid;
        bonds.push_back(bond);
    };
    if (!s.cell.valid) {
        if (i != j) add(0, 0, 0);
        return;
    }
    double radiusSq = cutoff * cutoff + 1e-12;
    VisitImageRows(s.cell, b.frac - a.frac, radiusSq,
                   [&](int64_t iy, int64_t iz, double center, double radius) {
        const auto last = static_cast<int64_t>(std::floor(center + radius));
        for (int64_t ix = static_cast<int64_t>(std::ceil(center - radius)); ix <= last; ++ix) {
            add(static_cast<int>(ix), static_cast<int>(iy), static_cast<int>(iz));
            if (truncated) return false;
        }
        return true;
    });
}

void BuildBondsBruteForce(const Structure& s, double tolerance, std::vector<Bond>& bonds, bool& truncated) {
    const size_t n = s.atoms.size();
    for (size_t i = 0; i < n; ++i) {
        for (size_t j = i; j < n; ++j) {
            ConsiderPair(s, static_cast<int>(i), static_cast<int>(j), tolerance, bonds, truncated);
            if (truncated) return;
        }
    }
}

void BuildBondsGrid(const Structure& s, double tolerance, std::vector<Bond>& bonds, bool& truncated) {
    const size_t n = s.atoms.size();
    // PairCutoff is capped at 6 Angstrom. In a skew cell the perpendicular
    // face spacings, rather than the edge lengths, bound fractional motion.
    constexpr double cellSize = 6.0;
    int bins[3] = {1, 1, 1};
    Vec3 origin;
    Vec3 extent;
    std::vector<int> binIndex(n, 0);

    if (s.cell.valid) {
        const Cell& c = s.cell;
        const double lengths[3] = {c.volume / Length(Cross(c.bVec, c.cVec)),
                                   c.volume / Length(Cross(c.aVec, c.cVec)),
                                   c.volume / Length(Cross(c.aVec, c.bVec))};
        for (int axis = 0; axis < 3; ++axis) {
            bins[axis] = std::clamp(static_cast<int>(std::floor(lengths[axis] / cellSize)), 1, 40);
        }
        for (size_t i = 0; i < n; ++i) {
            Vec3 f = Wrap01(s.atoms[i].frac);
            int x = std::min(bins[0] - 1, static_cast<int>(f.x * bins[0]));
            int y = std::min(bins[1] - 1, static_cast<int>(f.y * bins[1]));
            int z = std::min(bins[2] - 1, static_cast<int>(f.z * bins[2]));
            binIndex[i] = (z * bins[1] + y) * bins[0] + x;
        }
    } else {
        Vec3 lo{std::numeric_limits<double>::max(), std::numeric_limits<double>::max(),
                std::numeric_limits<double>::max()};
        Vec3 hi{std::numeric_limits<double>::lowest(), std::numeric_limits<double>::lowest(),
                std::numeric_limits<double>::lowest()};
        for (const Atom& atom : s.atoms) {
            lo.x = std::min(lo.x, atom.cart.x);
            lo.y = std::min(lo.y, atom.cart.y);
            lo.z = std::min(lo.z, atom.cart.z);
            hi.x = std::max(hi.x, atom.cart.x);
            hi.y = std::max(hi.y, atom.cart.y);
            hi.z = std::max(hi.z, atom.cart.z);
        }
        origin = lo;
        extent = hi - lo;
        for (int axis = 0; axis < 3; ++axis) {
            bins[axis] = std::clamp(static_cast<int>(std::floor(extent[axis] / cellSize)), 1, 48);
        }
        for (size_t i = 0; i < n; ++i) {
            const Vec3 local = s.atoms[i].cart - origin;
            int x = std::clamp(static_cast<int>(local.x / std::max(1e-9, extent.x) * bins[0]), 0, bins[0] - 1);
            int y = std::clamp(static_cast<int>(local.y / std::max(1e-9, extent.y) * bins[1]), 0, bins[1] - 1);
            int z = std::clamp(static_cast<int>(local.z / std::max(1e-9, extent.z) * bins[2]), 0, bins[2] - 1);
            binIndex[i] = (z * bins[1] + y) * bins[0] + x;
        }
    }

    const size_t totalBins = static_cast<size_t>(bins[0]) * bins[1] * bins[2];
    std::vector<std::vector<int>> cells(totalBins);
    for (size_t i = 0; i < n; ++i) cells[static_cast<size_t>(binIndex[i])].push_back(static_cast<int>(i));

    auto processNeighbor = [&](int i, int bin) {
        for (int j : cells[static_cast<size_t>(bin)]) {
            if (j < i) continue;
            ConsiderPair(s, i, j, tolerance, bonds, truncated);
            if (truncated) return true;
        }
        return false;
    };

    int first[3]{-1, -1, -1};
    int last[3]{1, 1, 1};
    if (s.cell.valid) {
        for (int axis = 0; axis < 3; ++axis) {
            if (bins[axis] <= 2) first[axis] = 0;
            if (bins[axis] == 1) last[axis] = 0;
        }
    }
    for (size_t i = 0; i < n; ++i) {
        int bx = binIndex[i] % bins[0];
        int by = (binIndex[i] / bins[0]) % bins[1];
        int bz = binIndex[i] / (bins[0] * bins[1]);
        for (int dz = first[2]; dz <= last[2]; ++dz) {
            for (int dy = first[1]; dy <= last[1]; ++dy) {
                for (int dx = first[0]; dx <= last[0]; ++dx) {
                    int x = bx + dx, y = by + dy, z = bz + dz;
                    if (s.cell.valid) {
                        x = (x + bins[0]) % bins[0];
                        y = (y + bins[1]) % bins[1];
                        z = (z + bins[2]) % bins[2];
                    } else if (x < 0 || y < 0 || z < 0 || x >= bins[0] || y >= bins[1] || z >= bins[2]) {
                        continue;
                    }
                    const int bin = (z * bins[1] + y) * bins[0] + x;
                    if (processNeighbor(static_cast<int>(i), bin)) return;
                }
            }
        }
    }
}

} // namespace

void BuildBonds(Structure& structure, double tolerance) {
    structure.bonds.clear();
    if (structure.atoms.empty()) return;
    bool truncated = false;
    structure.bonds.reserve(std::min<size_t>(structure.atoms.size() * 2, kMaxBonds));
    if (structure.atoms.size() < 1600) {
        BuildBondsBruteForce(structure, tolerance, structure.bonds, truncated);
    } else {
        BuildBondsGrid(structure, tolerance, structure.bonds, truncated);
    }
    if (truncated) {
        structure.truncated = true;
        structure.note += " 化学键数量过多，已截断显示。";
    }
    std::sort(structure.bonds.begin(), structure.bonds.end(), [](const Bond& a, const Bond& b) {
        if (a.a != b.a) return a.a < b.a;
        if (a.b != b.b) return a.b < b.b;
        return a.shift < b.shift;
    });
}

void FinalizeStructure(Structure& structure, bool expandSymmetry) {
    if (structure.cell.valid) {
        for (Atom& atom : structure.asymmetricAtoms) {
            if (atom.baseLabel.empty()) atom.baseLabel = atom.label;
            atom.cart = structure.cell.FractionalToCartesian(atom.frac);
        }
    }
    if (expandSymmetry) {
        ExpandAsymmetricUnit(structure);
    } else {
        structure.atoms = structure.asymmetricAtoms;
        for (size_t i = 0; i < structure.atoms.size(); ++i) {
            Atom& atom = structure.atoms[i];
            if (atom.baseLabel.empty()) atom.baseLabel = atom.label;
            atom.siteIndex = static_cast<int>(i);
        }
    }
    structure.periodic = structure.cell.valid;
    structure.asymmetricAtomCount = static_cast<int>(structure.asymmetricAtoms.size());
    structure.ComputeContents();
    structure.ComputeBounds();
    BuildBonds(structure);
}

namespace {

bool IsFiniteVec(const Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

std::string UniqueSiteLabel(const Structure& structure, const std::string& requested, const std::string& symbol) {
    std::set<std::string> used;
    for (const Atom& atom : structure.asymmetricAtoms) {
        used.insert(atom.baseLabel.empty() ? atom.label : atom.baseLabel);
    }
    std::string base = Trim(requested);
    if (base.empty()) {
        base = symbol;
        for (int i = 1; i < 10000; ++i) {
            const std::string candidate = base + std::to_string(i);
            if (used.find(candidate) == used.end()) return candidate;
        }
    }
    if (used.find(base) == used.end()) return base;
    for (int i = 2; i < 10000; ++i) {
        const std::string candidate = base + "_" + std::to_string(i);
        if (used.find(candidate) == used.end()) return candidate;
    }
    return base;
}

bool PrepareAtomForStructure(const Structure& structure, Atom& atom, std::string* error) {
    if (atom.atomicNumber <= 0 || atom.atomicNumber > 118) {
        if (error) *error = "原子元素无效";
        return false;
    }
    if (!std::isfinite(atom.occupancy) || atom.occupancy <= 0.0 || atom.occupancy > 1.0) {
        if (error) *error = "占位率必须在 0 与 1 之间（不含 0）";
        return false;
    }
    if (structure.cell.valid) {
        if (!IsFiniteVec(atom.frac)) {
            if (error) *error = "分数坐标必须是有效数字";
            return false;
        }
        atom.frac = Wrap01(atom.frac);
        atom.cart = structure.cell.FractionalToCartesian(atom.frac);
    } else {
        if (!IsFiniteVec(atom.cart)) {
            if (error) *error = "笛卡尔坐标必须是有效数字";
            return false;
        }
        atom.frac = {};
    }
    const Element& element = ElementByZ(atom.atomicNumber);
    atom.element = element.symbol;
    if (Trim(atom.label).empty()) {
        atom.label = UniqueSiteLabel(structure, "", element.symbol);
    } else {
        atom.label = Trim(atom.label);
    }
    atom.baseLabel = atom.label;
    return true;
}

std::string CifQuote(std::string_view text) {
    std::string value;
    value.reserve(text.size() + 2);
    for (char c : text) {
        if (c == '\r' || c == '\n' || c == '\t') value.push_back(' ');
        else value.push_back(c);
    }
    for (char quote : {'\'', '"'}) {
        bool safe = true;
        for (size_t i = 0; i + 1 < value.size(); ++i)
            if (value[i] == quote && std::isspace(static_cast<unsigned char>(value[i+1]))) safe = false;
        if (safe) return quote + value + quote;
    }
    return "\n;\n" + value + "\n;\n";
}

std::string CifAtomLabel(const Atom& atom, size_t index, std::set<std::string>& used) {
    std::string label = atom.baseLabel.empty() ? atom.label : atom.baseLabel;
    if (label.empty()) label = ElementByZ(atom.atomicNumber).symbol + std::to_string(index + 1);
    std::string unique = label;
    for (int n = 2; used.count(unique); ++n) unique = label + "_" + std::to_string(n);
    used.insert(unique);
    return CifQuote(unique);
}

bool WriteTextFile(const std::wstring& path, const std::string& content, std::string* error) {
    std::ofstream stream(std::filesystem::path(path), std::ios::binary | std::ios::trunc);
    if (!stream) {
        if (error) *error = "无法创建文件：" + WideToUtf8(path);
        return false;
    }
    stream.write(content.data(), static_cast<std::streamsize>(content.size()));
    if (!stream) {
        if (error) *error = "写入文件失败：" + WideToUtf8(path);
        return false;
    }
    return true;
}

} // namespace

bool ElementFromInput(std::string_view text, int& z, std::string& symbol, std::string* error) {
    z = 0;
    symbol.clear();
    if (error) error->clear();
    const std::string trimmed = Trim(text);
    if (trimmed.empty()) {
        if (error) *error = "元素不能为空";
        return false;
    }
    char* end = nullptr;
    errno = 0;
    const long number = std::strtol(trimmed.c_str(), &end, 10);
    if (end != trimmed.c_str() && *end == '\0' && errno == 0) {
        if (number >= 1 && number <= 118) {
            const Element& element = ElementByZ(static_cast<int>(number));
            z = element.z;
            symbol = element.symbol;
            return true;
        }
        if (error) *error = "原子序数必须在 1 与 118 之间";
        return false;
    }
    const Element& element = ElementBySymbol(NormalizeElementSymbol(trimmed));
    if (element.z <= 0) {
        if (error) *error = "未知元素：" + trimmed;
        return false;
    }
    z = element.z;
    symbol = element.symbol;
    return true;
}

bool SetCellParameters(Structure& structure, double a, double b, double c, double alpha, double beta,
                       double gamma, std::string* error) {
    if (error) error->clear();
    if (structure.asymmetricAtoms.empty()) {
        if (error) *error = "结构中没有原子";
        return false;
    }
    Cell candidate;
    if (!candidate.SetFromParameters(a, b, c, alpha, beta, gamma, error)) return false;
    std::vector<Atom> updated = structure.asymmetricAtoms;
    if (!structure.cell.valid) {
        for (Atom& atom : updated) {
            if (!IsFiniteVec(atom.cart)) {
                if (error) *error = "现有原子坐标无效，无法转换为分数坐标";
                return false;
            }
            atom.frac = Wrap01(candidate.CartesianToFractional(atom.cart));
        }
    }
    structure.cell = candidate;
    structure.periodic = true;
    structure.asymmetricAtoms = std::move(updated);
    FinalizeStructure(structure, true);
    return true;
}

int AddAtomSite(Structure& structure, const Atom& source, std::string* error) {
    if (error) error->clear();
    Atom atom = source;
    if (!PrepareAtomForStructure(structure, atom, error)) return -1;
    structure.asymmetricAtoms.push_back(std::move(atom));
    FinalizeStructure(structure, true);
    return static_cast<int>(structure.asymmetricAtoms.size()) - 1;
}

bool UpdateAtomSite(Structure& structure, int siteIndex, const Atom& source, std::string* error) {
    if (error) error->clear();
    if (siteIndex < 0 || siteIndex >= static_cast<int>(structure.asymmetricAtoms.size())) {
        if (error) *error = "原子索引无效";
        return false;
    }
    Atom atom = structure.asymmetricAtoms[static_cast<size_t>(siteIndex)];
    atom.atomicNumber = source.atomicNumber;
    atom.label = source.label;
    atom.occupancy = source.occupancy;
    atom.frac = source.frac;
    atom.cart = source.cart;
    if (!PrepareAtomForStructure(structure, atom, error)) return false;
    structure.asymmetricAtoms[static_cast<size_t>(siteIndex)] = std::move(atom);
    FinalizeStructure(structure, true);
    return true;
}

bool DeleteAtomSite(Structure& structure, int siteIndex, std::string* error) {
    if (error) error->clear();
    if (siteIndex < 0 || siteIndex >= static_cast<int>(structure.asymmetricAtoms.size())) {
        if (error) *error = "原子索引无效";
        return false;
    }
    if (structure.asymmetricAtoms.size() <= 1) {
        if (error) *error = "结构中至少需要保留一个原子";
        return false;
    }
    structure.asymmetricAtoms.erase(structure.asymmetricAtoms.begin() + siteIndex);
    FinalizeStructure(structure, true);
    return true;
}

bool ExportStructureToCif(const Structure& structure, const std::wstring& path, std::string* error) {
    if (error) error->clear();
    if (!structure.cell.valid) {
        if (error) *error = "CIF 导出需要晶胞参数，请改用 XYZ 格式";
        return false;
    }
    if (structure.asymmetricAtoms.empty()) {
        if (error) *error = "结构中没有原子";
        return false;
    }
    std::ostringstream out;
    out << std::fixed << std::setprecision(8);
    out << "data_crystallens_export\n";
    const std::string title = Trim(structure.title);
    if (!title.empty()) out << "_chemical_name_common      " << CifQuote(title) << "\n";
    const std::string formula = Trim(structure.formula);
    if (!formula.empty()) out << "_chemical_formula_sum      " << CifQuote(formula) << "\n";
    out << "_cell_length_a             " << structure.cell.a << "\n";
    out << "_cell_length_b             " << structure.cell.b << "\n";
    out << "_cell_length_c             " << structure.cell.c << "\n";
    out << "_cell_angle_alpha          " << structure.cell.alpha << "\n";
    out << "_cell_angle_beta           " << structure.cell.beta << "\n";
    out << "_cell_angle_gamma          " << structure.cell.gamma << "\n";
    out << "_cell_volume               " << structure.cell.volume << "\n";
    const std::string spaceGroup = Trim(structure.spaceGroup);
    if (!spaceGroup.empty()) {
        if (spaceGroup.front() == '#' && spaceGroup.size() > 1 &&
            spaceGroup.find_first_not_of("0123456789", 1) == std::string::npos)
            out << "_space_group_IT_number " << spaceGroup.substr(1) << "\n";
        else out << "_symmetry_space_group_name_H-M " << CifQuote(spaceGroup) << "\n";
    }
    if (!structure.symmetryOps.empty()) {
        out << "\nloop_\n_symmetry_equiv_pos_site_id\n_symmetry_equiv_pos_as_xyz\n";
        for (size_t i = 0; i < structure.symmetryOps.size(); ++i) {
            const std::string text = Trim(structure.symmetryOps[i].text);
            out << (i + 1) << " " << CifQuote(text.empty() ? std::string("x,y,z") : text) << "\n";
        }
    }
    const bool anyDisorder = std::any_of(structure.asymmetricAtoms.begin(), structure.asymmetricAtoms.end(),
        [](const Atom& a) { return !a.disorderGroup.empty() || !a.disorderAssembly.empty(); });
    bool anyUiso = false;
    for (const Atom& atom : structure.asymmetricAtoms) anyUiso = anyUiso || atom.hasUiso;
    out << "\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n"
           "_atom_site_fract_z\n_atom_site_occupancy\n";
    if (anyDisorder) out << "_atom_site_disorder_assembly\n_atom_site_disorder_group\n";
    if (anyUiso) out << "_atom_site_U_iso_or_equiv\n";
    std::set<std::string> usedLabels;
    for (size_t i = 0; i < structure.asymmetricAtoms.size(); ++i) {
        const Atom& atom = structure.asymmetricAtoms[i];
        const std::string label = CifAtomLabel(atom, i, usedLabels);
        const std::string symbol = ElementByZ(atom.atomicNumber).symbol;
        out << label << " " << symbol << " " << atom.frac.x << " " << atom.frac.y << " " << atom.frac.z << " "
            << atom.occupancy;
        if (anyDisorder) {
            out << " " << (atom.disorderAssembly.empty() ? "." : CifQuote(atom.disorderAssembly))
                << " " << (atom.disorderGroup.empty() ? "." : CifQuote(atom.disorderGroup));
        }
        if (anyUiso) {
            if (atom.hasUiso) out << " " << atom.uiso;
            else out << " ?";
        }
        out << "\n";
    }
    if (!WriteTextFile(path, out.str(), error)) return false;
    return true;
}

bool ExportStructureToXyz(const Structure& structure, const std::wstring& path, std::string* error) {
    if (error) error->clear();
    if (structure.atoms.empty()) {
        if (error) *error = "结构中没有原子";
        return false;
    }
    std::ostringstream out;
    out << structure.atoms.size() << "\n";
    std::string comment = Trim(structure.title);
    for (char& c : comment) {
        if (c == '\r' || c == '\n') c = ' ';
    }
    if (comment.empty()) comment = "CrystalLens export";
    out << comment << "\n";
    out << std::fixed << std::setprecision(8);
    for (const Atom& atom : structure.atoms) {
        const std::string symbol = ElementByZ(atom.atomicNumber).symbol;
        out << symbol << " " << atom.cart.x << " " << atom.cart.y << " " << atom.cart.z << "\n";
    }
    if (!WriteTextFile(path, out.str(), error)) return false;
    return true;
}

double MeasureDistance(const Structure& s, int a, int b, Vec3* offsetA, Vec3* offsetB) {
    if (a < 0 || b < 0 || a >= static_cast<int>(s.atoms.size()) || b >= static_cast<int>(s.atoms.size())) return 0.0;
    const Vec3& pa = s.atoms[static_cast<size_t>(a)].cart;
    const Vec3& pb = s.atoms[static_cast<size_t>(b)].cart;
    Vec3 offset{};
    Vec3 delta = pb - pa;
    if (s.cell.valid) {
        delta = s.cell.MinimumImageVector(pa, pb);
        offset = delta - (pb - pa);
    }
    if (offsetA) *offsetA = {};
    if (offsetB) *offsetB = offset;
    return Length(delta);
}

bool MeasureAngle(const Structure& s, int a, int b, int c, double& degrees, Vec3* armA, Vec3* armC) {
    if (a < 0 || b < 0 || c < 0 || a >= static_cast<int>(s.atoms.size()) ||
        b >= static_cast<int>(s.atoms.size()) || c >= static_cast<int>(s.atoms.size()))
        return false;
    const Vec3& pa = s.atoms[static_cast<size_t>(a)].cart;
    const Vec3& pb = s.atoms[static_cast<size_t>(b)].cart;
    const Vec3& pc = s.atoms[static_cast<size_t>(c)].cart;
    Vec3 va = pa - pb;
    Vec3 vc = pc - pb;
    Vec3 oa{}, oc{};
    if (s.cell.valid) {
        va = s.cell.MinimumImageVector(pb, pa);
        vc = s.cell.MinimumImageVector(pb, pc);
        oa = va - (pa - pb);
        oc = vc - (pc - pb);
    }
    const double la = Length(va);
    const double lc = Length(vc);
    if (la < 1e-9 || lc < 1e-9) return false;
    const double cosine = Clamp(Dot(va, vc) / (la * lc), -1.0, 1.0);
    degrees = std::acos(cosine) * kRadToDeg;
    if (armA) *armA = oa;
    if (armC) *armC = oc;
    return true;
}

Measurement MakeDistanceMeasurement(const Structure& s, int a, int b) {
    Measurement m;
    m.kind = MeasurementKind::Distance;
    m.a = a;
    m.b = b;
    m.value = MeasureDistance(s, a, b, nullptr, &m.offsetB);
    return m;
}

Measurement MakeAngleMeasurement(const Structure& s, int a, int b, int c) {
    Measurement m;
    m.kind = MeasurementKind::Angle;
    m.a = a;
    m.b = b;
    m.c = c;
    double degrees = 0.0;
    MeasureAngle(s, a, b, c, degrees, &m.offsetA, &m.offsetC);
    m.value = degrees;
    return m;
}

namespace {

std::string ReadTextFile(const std::wstring& path, ParseError& error) {
    namespace fs = std::filesystem;
    std::error_code ec;
    const auto size = fs::file_size(fs::path(path), ec);
    if (ec) {
        error.message = "无法读取文件：" + WideToUtf8(path);
        return {};
    }
    if (size > 128ull * 1024ull * 1024ull) {
        error.message = "文件超过 128 MB，已拒绝载入";
        return {};
    }
    std::ifstream stream(fs::path(path), std::ios::binary);
    if (!stream) {
        error.message = "无法打开文件：" + WideToUtf8(path);
        return {};
    }
    std::string bytes;
    bytes.resize(static_cast<size_t>(size));
    if (!bytes.empty()) stream.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!stream && !stream.eof()) {
        error.message = "读取文件失败：" + WideToUtf8(path);
        return {};
    }
    // Normalize source encodings to UTF-8. CIF/VESTA files are normally ASCII
    // or UTF-8, but older Windows exports may be in the active code page.
    if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xEF &&
        static_cast<unsigned char>(bytes[1]) == 0xBB && static_cast<unsigned char>(bytes[2]) == 0xBF) {
        bytes.erase(0, 3);
    }
    if (!bytes.empty()) {
        const int wideLen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(),
                                                static_cast<int>(bytes.size()), nullptr, 0);
        if (wideLen <= 0) {
            const int acpLen = MultiByteToWideChar(CP_ACP, 0, bytes.data(), static_cast<int>(bytes.size()),
                                                   nullptr, 0);
            if (acpLen > 0) {
                std::wstring wide(static_cast<size_t>(acpLen), L'\0');
                MultiByteToWideChar(CP_ACP, 0, bytes.data(), static_cast<int>(bytes.size()), wide.data(),
                                    acpLen);
                bytes = WideToUtf8(wide);
            }
        }
    }
    return bytes;
}

std::string LowerAscii(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) out.push_back(static_cast<char>(std::tolower(c)));
    return out;
}

bool LooksLikeXyz(std::string_view text) {
    size_t pos = 0;
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
    const size_t start = pos;
    while (pos < text.size() && std::isdigit(static_cast<unsigned char>(text[pos]))) ++pos;
    if (pos == start) return false;
    while (pos < text.size() && text[pos] != '\n') ++pos;
    if (pos >= text.size()) return false;
    ++pos;
    const size_t secondStart = pos;
    while (pos < text.size() && text[pos] != '\n') ++pos;
    const std::string second = Trim(text.substr(secondStart, pos - secondStart));
    if (second.empty()) return true;
    // Second line is normally a comment; make sure it is not a data_ header.
    return second.rfind("data_", 0) != 0;
}

SourceFormat DetectFormat(const std::wstring& path, std::string_view text) {
    std::wstring ext = std::filesystem::path(path).extension().wstring();
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    if (ext == L".cif" || ext == L".mcif") return SourceFormat::Cif;
    if (ext == L".xyz") return SourceFormat::Xyz;
    if (ext == L".vesta") return SourceFormat::Vesta;
    size_t pos = 0;
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
    const std::string head(text.substr(pos, std::min<size_t>(text.size() - pos, 64)));
    if (head.rfind("#VESTA_FORMAT_VERSION", 0) == 0 || head.rfind("VESTA_FORMAT_VERSION", 0) == 0)
        return SourceFormat::Vesta;
    if (head.rfind("data_", 0) == 0 || head.rfind("_cell_", 0) == 0 || head.rfind("_atom_site", 0) == 0)
        return SourceFormat::Cif;
    if (LooksLikeXyz(text)) return SourceFormat::Xyz;
    return SourceFormat::Cif;
}

} // namespace

bool LoadStructureFile(const std::wstring& path, Structure& out, ParseError& error) {
    error = {};
    const std::string bytes = ReadTextFile(path, error);
    if (bytes.empty() && !error.message.empty()) return false;
    if (Trim(bytes).empty()) {
        error.message = "文件为空";
        return false;
    }
    const SourceFormat format = DetectFormat(path, bytes);
    bool ok = false;
    switch (format) {
    case SourceFormat::Cif: ok = ParseCifText(bytes, out, error); break;
    case SourceFormat::Xyz: ok = ParseXyzText(bytes, out, error); break;
    case SourceFormat::Vesta: ok = ParseVestaText(bytes, out, error); break;
    default: break;
    }
    if (!ok) {
        if (error.message.empty()) error.message = "无法识别或解析文件";
        return false;
    }
    out.format = format;
    out.sourcePathUtf8 = WideToUtf8(path);
    if (out.title.empty()) {
        out.title = WideToUtf8(std::filesystem::path(path).stem().wstring());
    }
    const bool expand = format != SourceFormat::Xyz;
    FinalizeStructure(out, expand);
    if (out.atoms.empty()) {
        error.message = "未解析到任何原子";
        return false;
    }
    out.formula = Trim(out.formula);
    return true;
}

std::string Trim(std::string_view text) {
    size_t begin = 0;
    while (begin < text.size() && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
    size_t end = text.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
    return std::string(text.substr(begin, end - begin));
}

std::wstring Utf8ToWide(std::string_view text) {
    if (text.empty()) return {};
    const int needed = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (needed > 0) {
        std::wstring out(static_cast<size_t>(needed), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), needed);
        return out;
    }
    const int fallback = MultiByteToWideChar(CP_ACP, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (fallback > 0) {
        std::wstring out(static_cast<size_t>(fallback), L'\0');
        MultiByteToWideChar(CP_ACP, 0, text.data(), static_cast<int>(text.size()), out.data(), fallback);
        return out;
    }
    std::wstring out;
    out.reserve(text.size());
    for (unsigned char c : text) out.push_back(static_cast<wchar_t>(c));
    return out;
}

std::string WideToUtf8(std::wstring_view text) {
    if (text.empty()) return {};
    const int needed = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    if (needed <= 0) return {};
    std::string out(static_cast<size_t>(needed), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), needed, nullptr, nullptr);
    return out;
}

std::string FormatDouble(double value, int decimals) {
    if (!std::isfinite(value)) return "—";
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%.*f", decimals, value);
    return buffer;
}

} // namespace cl
