#include "XyzParser.h"

#include "PeriodicTable.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <sstream>
#include <vector>

namespace cl {
namespace {

std::vector<std::string> SplitLines(std::string_view text) {
    std::vector<std::string> lines;
    std::string current;
    size_t i = 0;
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF) {
        i = 3;
    }
    for (; i < text.size(); ++i) {
        const char c = text[i];
        if (c == '\n') {
            if (!current.empty() && current.back() == '\r') current.pop_back();
            lines.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) {
        if (current.back() == '\r') current.pop_back();
        lines.push_back(current);
    }
    return lines;
}

bool IsBlank(std::string_view line) {
    for (unsigned char c : line) {
        if (!std::isspace(c)) return false;
    }
    return true;
}

std::string TrimCopy(std::string_view text) {
    size_t begin = 0;
    while (begin < text.size() && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
    size_t end = text.size();
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) --end;
    return std::string(text.substr(begin, end - begin));
}

bool ParseDoubleToken(std::string_view token, double& value) {
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

} // namespace

bool ParseXyzText(std::string_view text, Structure& out, ParseError& error) {
    error = {};
    std::vector<std::string> lines = SplitLines(text);
    size_t cursor = 0;
    while (cursor < lines.size() && IsBlank(lines[cursor])) ++cursor;
    if (cursor >= lines.size()) {
        error.message = "XYZ 文件为空";
        return false;
    }
    int declaredCount = 0;
    {
        const std::string countText = TrimCopy(lines[cursor]);
        char* end = nullptr;
        const long value = std::strtol(countText.c_str(), &end, 10);
        if (end == countText.c_str() || value < 0 || value > 1000000) {
            error.line = static_cast<int>(cursor + 1);
            error.message = "XYZ 第一行必须是原子数";
            return false;
        }
        while (*end && std::isspace(static_cast<unsigned char>(*end))) ++end;
        if (*end != '\0') {
            error.line = static_cast<int>(cursor + 1);
            error.message = "XYZ 第一行必须是原子数";
            return false;
        }
        declaredCount = static_cast<int>(value);
    }
    ++cursor;
    std::string comment;
    if (cursor < lines.size()) {
        comment = TrimCopy(lines[cursor]);
        ++cursor;
    }

    out = Structure{};
    out.format = SourceFormat::Xyz;
    out.title = comment.empty() ? "XYZ molecule" : comment;
    out.periodic = false;
    out.cell.valid = false;

    int parsed = 0;
    for (; cursor < lines.size() && parsed < declaredCount; ++cursor) {
        std::string line = lines[cursor];
        const size_t hash = line.find('#');
        if (hash != std::string::npos) line = line.substr(0, hash);
        if (IsBlank(line)) continue;
        std::istringstream stream(line);
        std::string element;
        if (!(stream >> element)) continue;
        std::string sx, sy, sz;
        if (!(stream >> sx >> sy >> sz)) {
            error.line = static_cast<int>(cursor + 1);
            error.message = "XYZ 原子行需要元素符号和三个坐标";
            return false;
        }
        double x = 0, y = 0, z = 0;
        if (!ParseDoubleToken(sx, x) || !ParseDoubleToken(sy, y) || !ParseDoubleToken(sz, z)) {
            error.line = static_cast<int>(cursor + 1);
            error.message = "XYZ 坐标不是有效数字";
            return false;
        }
        Atom atom;
        atom.label = element;
        atom.baseLabel = element;
        if (!ElementFromInput(element, atom.atomicNumber, atom.element)) atom.element = "X";
        atom.cart = {x, y, z};
        out.asymmetricAtoms.push_back(std::move(atom));
        ++parsed;
    }

    if (out.asymmetricAtoms.empty()) {
        error.message = "XYZ 文件中没有可读取的原子";
        return false;
    }
    if (parsed != declaredCount) {
        out.note += "XYZ 声明了 " + std::to_string(declaredCount) + " 个原子，实际读取 " +
                    std::to_string(parsed) + " 个。";
    }
    if (out.asymmetricAtoms.size() > kMaxDisplayAtoms) {
        out.asymmetricAtoms.resize(kMaxDisplayAtoms);
        out.truncated = true;
        out.note += " 原子数超过限制，显示已截断。";
    }
    out.atoms = out.asymmetricAtoms;
    return true;
}

} // namespace cl
