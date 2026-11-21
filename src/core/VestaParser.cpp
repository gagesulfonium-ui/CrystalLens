#include "VestaParser.h"

#include "PeriodicTable.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <sstream>
#include <vector>

namespace cl {
namespace {

std::vector<std::string> SplitLines(std::string_view text) {
    std::vector<std::string> lines;
    std::string current;
    size_t i = 0;
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF)
        i = 3;
    for (; i < text.size(); ++i) {
        if (text[i] == '\n') {
            if (!current.empty() && current.back() == '\r') current.pop_back();
            lines.push_back(current);
            current.clear();
        } else {
            current.push_back(text[i]);
        }
    }
    if (!current.empty()) {
        if (current.back() == '\r') current.pop_back();
        lines.push_back(current);
    }
    return lines;
}

std::string TrimCopy(std::string_view text) {
    size_t begin = 0;
    while (begin < text.size() && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
    size_t end = text.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
    return std::string(text.substr(begin, end - begin));
}

std::vector<std::string> SplitTokens(std::string_view line) {
    std::vector<std::string> out;
    std::istringstream stream{std::string(line)};
    std::string token;
    while (stream >> token) out.push_back(token);
    return out;
}

bool ParseDouble(std::string_view token, double& value) {
    std::string s = TrimCopy(token);
    if (s.empty()) return false;
    char* end = nullptr;
    errno = 0;
    const double v = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || !std::isfinite(v)) return false;
    while (*end && std::isspace(static_cast<unsigned char>(*end))) ++end;
    if (*end != '\0') return false;
    value = v;
    return true;
}

bool ParseInt(std::string_view token, int& value) {
    std::string s = TrimCopy(token);
    if (s.empty()) return false;
    char* end = nullptr;
    const long v = std::strtol(s.c_str(), &end, 10);
    if (end == s.c_str()) return false;
    while (*end && std::isspace(static_cast<unsigned char>(*end))) ++end;
    if (*end != '\0') return false;
    value = static_cast<int>(v);
    return true;
}

bool LooksLikeSection(std::string_view line) {
    const std::string trimmed = TrimCopy(line);
    if (trimmed.empty()) return false;
    if (!std::isupper(static_cast<unsigned char>(trimmed[0]))) return false;
    for (char c : trimmed) {
        if (std::islower(static_cast<unsigned char>(c))) return false;
    }
    return true;
}

bool AllZero(const std::vector<std::string>& tokens) {
    for (const std::string& token : tokens) {
        double v = 0;
        if (!ParseDouble(token, v) || std::abs(v) > 1e-12) return false;
    }
    return !tokens.empty();
}

} // namespace

bool ParseVestaText(std::string_view text, Structure& out, ParseError& error) {
    error = {};
    std::vector<std::string> lines = SplitLines(text);
    if (lines.empty()) {
        error.message = "VESTA 文件为空";
        return false;
    }
    out = Structure{};
    out.format = SourceFormat::Vesta;
    double a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
    bool haveCell = false;
    int crystalCount = 0;
    std::string groupLine;

    for (size_t i = 0; i < lines.size(); ++i) {
        const std::string line = TrimCopy(lines[i]);
        if (line.empty()) continue;
        if (line == "CRYSTAL") {
            ++crystalCount;
            if (crystalCount > 1 && haveCell) break;
            continue;
        }
        if (line.rfind("#VESTA_FORMAT_VERSION", 0) == 0 || line.rfind("VESTA_FORMAT_VERSION", 0) == 0) {
            continue;
        }
        if (line == "TITLE") {
            for (size_t j = i + 1; j < lines.size(); ++j) {
                const std::string candidate = TrimCopy(lines[j]);
                if (!candidate.empty()) {
                    out.title = candidate;
                    i = j;
                    break;
                }
            }
            continue;
        }
        if (line == "CELLP") {
            for (size_t j = i + 1; j < lines.size(); ++j) {
                const std::vector<std::string> tokens = SplitTokens(lines[j]);
                if (tokens.size() < 6) continue;
                if (!ParseDouble(tokens[0], a) || !ParseDouble(tokens[1], b) || !ParseDouble(tokens[2], c) ||
                    !ParseDouble(tokens[3], alpha) || !ParseDouble(tokens[4], beta) ||
                    !ParseDouble(tokens[5], gamma)) {
                    continue;
                }
                std::string cellError;
                if (!out.cell.SetFromParameters(a, b, c, alpha, beta, gamma, &cellError)) {
                    error.line = static_cast<int>(j + 1);
                    error.message = "VESTA 晶胞参数无效：" + cellError;
                    return false;
                }
                haveCell = true;
                i = j;
                break;
            }
            continue;
        }
        if (line == "GROUP") {
            for (size_t j = i + 1; j < lines.size(); ++j) {
                const std::string candidate = TrimCopy(lines[j]);
                if (candidate.empty()) continue;
                groupLine = candidate;
                i = j;
                break;
            }
            continue;
        }
        if (line == "SYMOP") {
            for (size_t j = i + 1; j < lines.size(); ++j) {
                const std::string candidate = TrimCopy(lines[j]);
                if (candidate.empty()) continue;
                if (LooksLikeSection(candidate)) break;
                const std::vector<std::string> tokens = SplitTokens(candidate);
                if (tokens.size() < 12) break;
                double vals[12]{};
                bool ok = true;
                for (int k = 0; k < 12; ++k) {
                    if (!ParseDouble(tokens[static_cast<size_t>(k)], vals[k])) {
                        ok = false;
                        break;
                    }
                }
                if (!ok) break;
                SymmetryOp op;
                op.t = {vals[0], vals[1], vals[2]};
                for (int r = 0; r < 3; ++r)
                    for (int col = 0; col < 3; ++col) op.m[r][col] = vals[3 + r * 3 + col];
                bool zeroRotation = true;
                for (int r = 0; r < 3; ++r)
                    for (int col = 0; col < 3; ++col)
                        if (std::abs(op.m[r][col]) > 1e-12) zeroRotation = false;
                if (!zeroRotation) {
                    std::ostringstream xyz;
                    xyz << std::fixed << std::setprecision(12);
                    for (int r = 0; r < 3; ++r) {
                        if (r) xyz << ',';
                        bool term = false;
                        for (int col = 0; col < 3; ++col) {
                            const double k = op.m[r][col];
                            if (k == 0.0) continue;
                            if (k < 0) xyz << '-';
                            else if (term) xyz << '+';
                            if (std::abs(k) != 1.0) xyz << std::abs(k) << '*';
                            xyz << "xyz"[col];
                            term = true;
                        }
                        if (op.t[r] != 0.0 || !term) {
                            if (term && op.t[r] > 0) xyz << '+';
                            xyz << op.t[r];
                        }
                    }
                    op.text = xyz.str();
                    out.symmetryOps.push_back(std::move(op));
                }
                i = j;
            }
            continue;
        }
        if (line == "STRUC") {
            for (size_t j = i + 1; j < lines.size(); ++j) {
                const std::string candidate = TrimCopy(lines[j]);
                if (candidate.empty()) continue;
                if (LooksLikeSection(candidate)) break;
                const std::vector<std::string> tokens = SplitTokens(candidate);
                if (tokens.size() < 7) continue;
                if (AllZero(tokens) && tokens.size() >= 7) break;
                int index = 0;
                if (!ParseInt(tokens[0], index)) continue;
                if (tokens[1].empty() || !std::isalpha(static_cast<unsigned char>(tokens[1][0]))) continue;
                double occupancy = 1.0;
                double x = 0, y = 0, z = 0;
                if (!ParseDouble(tokens[3], occupancy) || !ParseDouble(tokens[4], x) ||
                    !ParseDouble(tokens[5], y) || !ParseDouble(tokens[6], z))
                    continue;
                Atom atom;
                atom.element = NormalizeElementSymbol(tokens[1]);
                atom.atomicNumber = ElementBySymbol(atom.element).z;
                atom.element = ElementByZ(atom.atomicNumber).symbol;
                atom.label = tokens[2].empty() ? atom.element + std::to_string(index) : tokens[2];
                atom.baseLabel = atom.label;
                atom.occupancy = occupancy;
                atom.frac = {x, y, z};
                atom.siteIndex = index > 0 ? index - 1 : 0;
                if (out.cell.valid) atom.cart = out.cell.FractionalToCartesian(atom.frac);
                out.asymmetricAtoms.push_back(std::move(atom));
                i = j;
            }
            continue;
        }
    }

    if (!haveCell || !out.cell.valid) {
        error.message = "VESTA 文件中缺少有效的 CELLP 晶胞参数";
        return false;
    }
    if (out.asymmetricAtoms.empty()) {
        error.message = "VESTA 文件中没有可读取的 STRUC 原子";
        return false;
    }
    if (!groupLine.empty()) {
        std::istringstream fields(groupLine);
        int number, setting;
        if (fields >> number >> setting && number >= 1 && number <= 230) {
            std::string name;
            std::getline(fields, name);
            out.spaceGroup = Trim(name);
            if (out.spaceGroup.empty()) out.spaceGroup = "#" + std::to_string(number);
        } else out.spaceGroup = groupLine;
    }
    out.periodic = true;
    out.title = out.title.empty() ? "VESTA structure" : out.title;
    out.symmetryOperatorCount = static_cast<int>(out.symmetryOps.size());
    if (out.symmetryOps.empty()) {
        out.note += " VESTA 文件未包含 SYMOP 对称操作，仅显示不对称单元。";
    }
    return true;
}

} // namespace cl
