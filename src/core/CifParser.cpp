#include "CifParser.h"

#include "PeriodicTable.h"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <map>
#include <set>
#include <sstream>
#include <unordered_map>
#include <vector>

namespace cl {
namespace {

struct Token {
    std::string text;
    int line = 0;
    bool quoted = false;
};

struct CifLoop {
    std::vector<std::string> headers;
    std::vector<std::string> values;
    std::vector<int> rowLines;
    int line = 0;
    size_t RowCount() const { return headers.empty() ? 0 : values.size() / headers.size(); }
    std::string Get(size_t row, size_t column) const {
        const size_t index = row * headers.size() + column;
        return index < values.size() ? values[index] : std::string{};
    }
};

struct CifItem {
    std::string value;
    int line = 0;
};

struct CifBlock {
    std::string name;
    std::unordered_map<std::string, CifItem> items;
    std::vector<CifLoop> loops;
};

std::string Lower(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    for (unsigned char c : text) out.push_back(static_cast<char>(std::tolower(c)));
    return out;
}

std::string NormKey(std::string_view text) {
    std::string out = Lower(text);
    for (char& c : out) {
        if (c == '.' || c == ':') c = '_';
    }
    return out;
}

bool StartsWith(std::string_view text, std::string_view prefix) {
    return text.size() >= prefix.size() && text.substr(0, prefix.size()) == prefix;
}

std::string CleanText(std::string_view text) {
    std::string out;
    out.reserve(text.size());
    bool lastSpace = true;
    for (char c : text) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!lastSpace) out.push_back(' ');
            lastSpace = true;
        } else {
            out.push_back(c);
            lastSpace = false;
        }
    }
    while (!out.empty() && out.back() == ' ') out.pop_back();
    return out;
}

bool IsControlWord(const std::string& lower) {
    return lower == "loop_" || lower == "stop_" || lower == "global_" || StartsWith(lower, "data_") ||
           StartsWith(lower, "save_");
}

bool IsSymmetryOperationKey(const std::string& key) {
    if (key.find("equiv_pos_as_xyz") != std::string::npos) return true;
    if (key.find("symop") != std::string::npos && key.find("xyz") != std::string::npos) return true;
    return key.find("operation_xyz") != std::string::npos;
}

bool LooksLikeSymmetryExpression(std::string_view text) {
    int commas = 0;
    bool hasVariable = false;
    for (char c : text) {
        if (c == ',') {
            ++commas;
        } else if (c == 'x' || c == 'X' || c == 'y' || c == 'Y' || c == 'z' || c == 'Z') {
            hasVariable = true;
        } else if (std::isdigit(static_cast<unsigned char>(c)) || c == '+' || c == '-' || c == '*' ||
                   c == '/' || c == '.' || c == '(' || c == ')' || std::isspace(static_cast<unsigned char>(c))) {
            continue;
        } else {
            return false;
        }
    }
    return commas == 2 && hasVariable;
}

// Accept spaced unquoted operators only in symmetry fields. CIF loop rows
// may otherwise span lines or share a line with unrelated values.
std::string ReadOperation(const std::vector<Token>& tokens, size_t& i) {
    const Token& start = tokens[i++];
    std::string op = start.text;
    if (start.quoted || (LooksLikeSymmetryExpression(op) && op.back() != ',')) return op;
    size_t end = i;
    while (end < tokens.size() && tokens[end].line == start.line && !tokens[end].quoted) {
        const std::string& part = tokens[end].text;
        if (part.find_first_not_of("xXyYzZ0123456789+-*/.(),") != std::string::npos) break;
        op += " " + part;
        ++end;
        if (LooksLikeSymmetryExpression(op) && op.back() != ',') {
            // A manually spaced final component may continue with a separate '+' or '-'.
            if (end < tokens.size() && tokens[end].line == start.line &&
                (tokens[end].text == "+" || tokens[end].text == "-")) continue;
            if (op.back() == '+' || op.back() == '-') continue;
            i = end;
            return op;
        }
    }
    return start.text;
}

bool Tokenize(std::string_view text, std::vector<Token>& tokens, ParseError& error) {
    size_t i = 0;
    int line = 1;
    bool atLineStart = true;
    if (text.size() >= 3 && static_cast<unsigned char>(text[0]) == 0xEF &&
        static_cast<unsigned char>(text[1]) == 0xBB && static_cast<unsigned char>(text[2]) == 0xBF) {
        i = 3;
    }
    while (i < text.size()) {
        const char c = text[i];
        if (c == '\r') {
            ++i;
            continue;
        }
        if (c == '\n') {
            ++line;
            ++i;
            atLineStart = true;
            continue;
        }
        if (std::isspace(static_cast<unsigned char>(c))) {
            ++i;
            atLineStart = false;
            continue;
        }
        if (c == '#') {
            while (i < text.size() && text[i] != '\n') ++i;
            continue;
        }
        if (c == ';' && atLineStart) {
            const int startLine = line;
            ++i;
            if (i < text.size() && text[i] == '\r') ++i;
            if (i < text.size() && text[i] == '\n') {
                ++line;
                ++i;
            }
            const size_t fieldStart = i;
            size_t end = std::string::npos;
            while (i < text.size()) {
                if (text[i] == ';' && (i == fieldStart || text[i - 1] == '\n')) {
                    end = i;
                    break;
                }
                if (text[i] == '\n') ++line;
                ++i;
            }
            if (end == std::string::npos) {
                error.line = startLine;
                error.message = "分号文本字段缺少结束分号";
                return false;
            }
            Token token;
            token.text = CleanText(text.substr(fieldStart, end - fieldStart));
            token.line = startLine;
            token.quoted = true;
            tokens.push_back(std::move(token));
            i = end + 1;
            while (i < text.size() && text[i] != '\n') ++i;
            if (i < text.size()) {
                ++line;
                ++i;
            }
            atLineStart = true;
            continue;
        }
        if (c == '\'' || c == '"') {
            const char quote = c;
            const int startLine = line;
            ++i;
            const size_t start = i;
            bool closed = false;
            while (i < text.size()) {
                if (text[i] == quote && (i + 1 == text.size() || std::isspace(static_cast<unsigned char>(text[i + 1])))) {
                    closed = true;
                    break;
                }
                if (text[i] == '\n' || text[i] == '\r') break;
                ++i;
            }
            if (!closed) {
                error.line = startLine;
                error.message = "引号字段缺少结束引号";
                return false;
            }
            Token token;
            token.text = std::string(text.substr(start, i - start));
            token.line = startLine;
            token.quoted = true;
            tokens.push_back(std::move(token));
            ++i;
            atLineStart = false;
            continue;
        }
        const int startLine = line;
        const size_t start = i;
        while (i < text.size()) {
            const char d = text[i];
            if (std::isspace(static_cast<unsigned char>(d))) break;
            ++i;
        }
        Token token;
        token.text = std::string(text.substr(start, i - start));
        token.line = startLine;
        token.quoted = false;
        tokens.push_back(std::move(token));
        atLineStart = false;
    }
    return true;
}

const CifItem* FindItem(const CifBlock& block, std::initializer_list<const char*> keys) {
    for (const char* key : keys) {
        auto it = block.items.find(NormKey(key));
        if (it != block.items.end()) return &it->second;
    }
    return nullptr;
}

int FindColumn(const CifLoop& loop, std::initializer_list<const char*> keys) {
    for (const char* key : keys) {
        const std::string wanted = NormKey(key);
        for (size_t i = 0; i < loop.headers.size(); ++i) {
            if (NormKey(loop.headers[i]) == wanted) return static_cast<int>(i);
        }
    }
    return -1;
}

bool ParseCifNumber(std::string_view input, double& out) {
    std::string s = CleanText(input);
    if (s.empty() || s == "?" || s == ".") return false;
    const size_t slash = s.find('/');
    if (slash != std::string::npos) {
        double a, b;
        if (s.find('/', slash + 1) != std::string::npos ||
            !ParseCifNumber(s.substr(0, slash), a) || !ParseCifNumber(s.substr(slash + 1), b) || b == 0)
            return false;
        out = a / b;
        return std::isfinite(out);
    }
    // Keep the exponent when a standard uncertainty follows the mantissa.
    const size_t open = s.find('(');
    if (open != std::string::npos) {
        const size_t close = s.find(')', open + 1);
        if (open == 0 || !std::isdigit(static_cast<unsigned char>(s[open - 1])) ||
            close == std::string::npos || close == open + 1 ||
            s.find_first_not_of("0123456789", open + 1) != close) return false;
        if (close + 1 != s.size() && s[close + 1] != 'e' && s[close + 1] != 'E') return false;
        s.erase(open, close - open + 1);
    }
    char* end = nullptr;
    const double value = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || *end != '\0' || !std::isfinite(value)) return false;
    out = value;
    return true;
}

bool GetNumberItem(const CifBlock& block, std::initializer_list<const char*> keys, double& out,
                   int* line = nullptr) {
    const CifItem* item = FindItem(block, keys);
    if (!item) return false;
    if (!ParseCifNumber(item->value, out)) return false;
    if (line) *line = item->line;
    return true;
}

std::string GetTextItem(const CifBlock& block, std::initializer_list<const char*> keys) {
    if (const CifItem* item = FindItem(block, keys)) return CleanText(item->value);
    return {};
}

const CifLoop* FindAtomLoop(const CifBlock& block) {
    const CifLoop* best = nullptr;
    size_t bestRows = 0;
    for (const CifLoop& loop : block.loops) {
        const bool hasFrac = FindColumn(loop, {"_atom_site_fract_x"}) >= 0 &&
                             FindColumn(loop, {"_atom_site_fract_y"}) >= 0 &&
                             FindColumn(loop, {"_atom_site_fract_z"}) >= 0;
        const bool hasCart = FindColumn(loop, {"_atom_site_cartn_x"}) >= 0 &&
                             FindColumn(loop, {"_atom_site_cartn_y"}) >= 0 &&
                             FindColumn(loop, {"_atom_site_cartn_z"}) >= 0;
        if (!hasFrac && !hasCart) continue;
        if (FindColumn(loop, {"_atom_site_label", "_atom_site_label_atom_id", "_atom_site_id"}) < 0 && FindColumn(loop, {"_atom_site_type_symbol"}) < 0)
            continue;
        if (loop.RowCount() > bestRows) {
            bestRows = loop.RowCount();
            best = &loop;
        }
    }
    return best;
}

const CifLoop* FindSymmetryLoop(const CifBlock& block, int& xyzColumn) {
    for (const CifLoop& loop : block.loops) {
        for (size_t c = 0; c < loop.headers.size(); ++c) {
            const std::string key = NormKey(loop.headers[c]);
            if (key.find("symop") != std::string::npos && key.find("xyz") != std::string::npos) {
                xyzColumn = static_cast<int>(c);
                return &loop;
            }
            if (key.find("equiv_pos_as_xyz") != std::string::npos) {
                xyzColumn = static_cast<int>(c);
                return &loop;
            }
        }
    }
    for (const CifLoop& loop : block.loops) {
        for (size_t c = 0; c < loop.headers.size(); ++c) {
            if (NormKey(loop.headers[c]).find("operation_xyz") != std::string::npos) {
                xyzColumn = static_cast<int>(c);
                return &loop;
            }
        }
    }
    xyzColumn = -1;
    return nullptr;
}

struct BlockScore {
    int atoms = 0;
    bool cell = false;
    bool hasSymmetry = false;
    bool hasCoordinates = false;
};

BlockScore ScoreBlock(const CifBlock& block) {
    BlockScore score;
    double a = 0, b = 0, c = 0;
    score.cell = GetNumberItem(block, {"_cell_length_a"}, a) &&
                 GetNumberItem(block, {"_cell_length_b"}, b) &&
                 GetNumberItem(block, {"_cell_length_c"}, c);
    if (const CifLoop* atoms = FindAtomLoop(block)) {
        score.atoms = static_cast<int>(atoms->RowCount());
        score.hasCoordinates = score.atoms > 0;
    }
    int col = -1;
    score.hasSymmetry = FindSymmetryLoop(block, col) != nullptr;
    return score;
}

} // namespace

bool ParseCifText(std::string_view text, Structure& out, ParseError& error) {
    error = {};
    std::vector<Token> tokens;
    if (!Tokenize(text, tokens, error)) return false;
    if (tokens.empty()) {
        error.message = "CIF 文件为空";
        return false;
    }

    std::vector<CifBlock> blocks;
    CifBlock* current = nullptr;
    size_t i = 0;
    while (i < tokens.size()) {
        const Token& token = tokens[i];
        const std::string lower = token.quoted ? std::string{} : Lower(token.text);
        if (!token.quoted && StartsWith(lower, "data_")) {
            CifBlock block;
            block.name = token.text.substr(5);
            blocks.push_back(std::move(block));
            current = &blocks.back();
            ++i;
            continue;
        }
        if (!current) {
            CifBlock block;
            block.name = "CIF";
            blocks.push_back(std::move(block));
            current = &blocks.back();
        }
        if (!token.quoted && lower == "loop_") {
            CifLoop loop;
            loop.line = token.line;
            ++i;
            while (i < tokens.size() && !tokens[i].quoted && tokens[i].text.size() > 1 &&
                   tokens[i].text.front() == '_') {
                loop.headers.push_back(tokens[i].text);
                ++i;
            }
            if (loop.headers.empty()) {
                error.line = token.line;
                error.message = "loop_ 之后缺少数据列名";
                return false;
            }
            const size_t ncols = loop.headers.size();
            std::vector<bool> operationColumn;
            for (const auto& header : loop.headers) operationColumn.push_back(IsSymmetryOperationKey(NormKey(header)));
            while (i < tokens.size()) {
                const Token& value = tokens[i];
                if (!value.quoted) {
                    const std::string valueLower = Lower(value.text);
                    if (valueLower == "loop_" || valueLower == "stop_" || valueLower == "global_" ||
                        StartsWith(valueLower, "data_") || StartsWith(valueLower, "save_")) {
                        break;
                    }
                    if (!value.text.empty() && value.text.front() == '_') {
                        break;
                    }
                }
                const size_t column = loop.values.size() % ncols;
                if (column == 0) loop.rowLines.push_back(value.line);
                if (operationColumn[column]) loop.values.push_back(ReadOperation(tokens, i));
                else loop.values.push_back(tokens[i++].text);
            }
            if (!loop.values.empty() && loop.values.size() % ncols != 0) {
                error.line = token.line;
                error.message = "loop_ 数据项数量与列数不匹配（第 " + std::to_string(loop.line) + " 行）";
                return false;
            }
            current->loops.push_back(std::move(loop));
            continue;
        }
        if (!token.quoted && token.text.size() > 1 && token.text.front() == '_') {
            const std::string key = NormKey(token.text);
            ++i;
            if (i >= tokens.size() || (!tokens[i].quoted && (IsControlWord(Lower(tokens[i].text)) || tokens[i].text.front() == '_'))) {
                error.line = token.line;
                error.message = "数据项 " + token.text + " 缺少值";
                return false;
            }
            if (IsSymmetryOperationKey(key)) {
                CifLoop loop;
                loop.line = tokens[i].line;
                loop.headers.push_back(token.text);
                do {
                    loop.rowLines.push_back(tokens[i].line);
                    loop.values.push_back(ReadOperation(tokens, i));
                } while (i < tokens.size() && (LooksLikeSymmetryExpression(tokens[i].text) ||
                                            tokens[i].text.find(',') != std::string::npos));
                current->loops.push_back(std::move(loop));
                continue;
            }
            CifItem item;
            item.value = tokens[i].text;
            item.line = tokens[i].line;
            current->items[key] = std::move(item);
            ++i;
            continue;
        }
        ++i;
    }

    for (CifBlock& block : blocks) {
        CifLoop site;
        for (const auto& [key, item] : block.items) {
            if (!StartsWith(key, "_atom_site_")) continue;
            site.headers.push_back(key);
            site.values.push_back(item.value);
            if (site.line == 0 || item.line < site.line) site.line = item.line;
        }
        if (!site.headers.empty()) {
            site.rowLines.push_back(site.line);
            block.loops.push_back(std::move(site));
        }
    }

    if (blocks.empty()) {
        error.message = "CIF 中没有 data_ 数据块";
        return false;
    }

    int bestIndex = -1;
    BlockScore bestScore;
    for (size_t bi = 0; bi < blocks.size(); ++bi) {
        const BlockScore score = ScoreBlock(blocks[bi]);
        if (!score.hasCoordinates) continue;
        const int quality = (score.cell ? 1000 : 0) + std::min(score.atoms, 1000) * 2 +
                            (score.hasSymmetry ? 20 : 0);
        const int bestQuality = (bestScore.cell ? 1000 : 0) + std::min(bestScore.atoms, 1000) * 2 +
                                (bestScore.hasSymmetry ? 20 : 0);
        if (bestIndex < 0 || quality > bestQuality) {
            bestIndex = static_cast<int>(bi);
            bestScore = score;
        }
    }
    if (bestIndex < 0) {
        error.message = "CIF 中未找到包含坐标的原子表";
        return false;
    }
    const CifBlock& block = blocks[static_cast<size_t>(bestIndex)];
    out = Structure{};
    out.format = SourceFormat::Cif;
    out.blockName = block.name;
    out.title = GetTextItem(block, {"_chemical_name_common", "_chemical_name_mineral",
                                    "_chemical_name_systematic", "_struct_title"});
    if (out.title.empty()) out.title = block.name.empty() ? "CIF structure" : block.name;
    out.formula = GetTextItem(block, {"_chemical_formula_sum", "_chemical_formula_moiety"});
    out.spaceGroup = GetTextItem(block, {"_space_group_name_h-m_alt", "_symmetry_space_group_name_h-m",
                                         "_space_group_name_h-m", "_symmetry_space_group_name_h-m_alt",
                                         "_space_group_name_hall", "_symmetry_space_group_name_hall"});
    if (out.spaceGroup.empty()) {
        const CifItem* it = FindItem(block, {"_space_group_it_number", "_symmetry_int_tables_number"});
        if (it) out.spaceGroup = "#" + CleanText(it->value);
    }

    double a = 0, b = 0, c = 0, alpha = 90, beta = 90, gamma = 90;
    const bool haveA = GetNumberItem(block, {"_cell_length_a"}, a);
    const bool haveB = GetNumberItem(block, {"_cell_length_b"}, b);
    const bool haveC = GetNumberItem(block, {"_cell_length_c"}, c);
    const bool anyCell = FindItem(block, {"_cell_length_a", "_cell_length_b", "_cell_length_c"}) || FindItem(block, {"_cell_angle_alpha"}) ||
                         FindItem(block, {"_cell_angle_beta"}) || FindItem(block, {"_cell_angle_gamma"});
    if (haveA && haveB && haveC) {
        int line = 0;
        auto angle = [&](const char* key, double& result) {
            const auto* item = FindItem(block, {key});
            if (!item) return true; // Preserve the orthogonal default for omitted angles.
            line = item->line;
            if (ParseCifNumber(item->value, result)) return true;
            error.line = line;
            error.message = std::string(key) + " 晶胞角无效";
            return false;
        };
        if (!angle("_cell_angle_alpha", alpha) || !angle("_cell_angle_beta", beta) ||
            !angle("_cell_angle_gamma", gamma)) return false;
        std::string cellError;
        if (!out.cell.SetFromParameters(a, b, c, alpha, beta, gamma, &cellError)) {
            error.line = line;
            error.message = "无效晶胞参数：" + cellError;
            return false;
        }
    } else if (anyCell) {
        error.message = "晶胞参数不完整（需要 a、b、c）";
        return false;
    }

    const CifLoop* atomLoop = FindAtomLoop(block);
    if (!atomLoop) {
        error.message = "CIF 中没有可读取的 _atom_site 坐标循环";
        return false;
    }
    const int labelCol = FindColumn(*atomLoop, {"_atom_site_label", "_atom_site_label_atom_id", "_atom_site_id"});
    const int typeCol = FindColumn(*atomLoop, {"_atom_site_type_symbol"});
    const int fxCol = FindColumn(*atomLoop, {"_atom_site_fract_x"});
    const int fyCol = FindColumn(*atomLoop, {"_atom_site_fract_y"});
    const int fzCol = FindColumn(*atomLoop, {"_atom_site_fract_z"});
    const int cxCol = FindColumn(*atomLoop, {"_atom_site_cartn_x"});
    const int cyCol = FindColumn(*atomLoop, {"_atom_site_cartn_y"});
    const int czCol = FindColumn(*atomLoop, {"_atom_site_cartn_z"});
    const int occCol = FindColumn(*atomLoop, {"_atom_site_occupancy"});
    const int uisoCol = FindColumn(*atomLoop, {"_atom_site_u_iso_or_equiv"});
    const int groupCol = FindColumn(*atomLoop, {"_atom_site_disorder_group"});
    const int assemblyCol = FindColumn(*atomLoop, {"_atom_site_disorder_assembly"});
    const bool useFrac = fxCol >= 0 && fyCol >= 0 && fzCol >= 0;
    const bool useCart = cxCol >= 0 && cyCol >= 0 && czCol >= 0;
    if (!useFrac && !useCart) {
        error.message = "原子表缺少完整的分数坐标或笛卡尔坐标列";
        return false;
    }
    if (useFrac && !useCart && !out.cell.valid) {
        error.message = "原子使用分数坐标，但 CIF 缺少晶胞参数";
        return false;
    }

    const int modelCol = FindColumn(*atomLoop, {"_atom_site_pdbx_pdb_model_num"});
    const std::string model = modelCol >= 0 ? atomLoop->Get(0, modelCol) : "";
    bool multipleModels = false;
    out.asymmetricAtoms.reserve(atomLoop->RowCount());
    for (size_t row = 0; row < atomLoop->RowCount(); ++row) {
        if (modelCol >= 0 && atomLoop->Get(row, modelCol) != model) {
            multipleModels = true;
            continue;
        }
        Atom atom;
        if (labelCol >= 0) atom.label = CleanText(atomLoop->Get(row, static_cast<size_t>(labelCol)));
        const std::string type = typeCol >= 0 ? atomLoop->Get(row, typeCol) : "";
        const bool hasType = !type.empty() && type != "." && type != "?";
        atom.element = NormalizeElementSymbol(hasType ? type : atom.label);
        atom.atomicNumber = ElementBySymbol(atom.element).z;
        atom.element = ElementByZ(atom.atomicNumber).symbol;
        if (atom.label.empty()) atom.label = atom.element + std::to_string(row + 1);
        atom.baseLabel = atom.label;

        auto coordinates = [&](int x, int y, int z, Vec3& point) {
            return ParseCifNumber(atomLoop->Get(row, x), point.x) &&
                   ParseCifNumber(atomLoop->Get(row, y), point.y) &&
                   ParseCifNumber(atomLoop->Get(row, z), point.z);
        };
        if (useFrac && out.cell.valid && coordinates(fxCol, fyCol, fzCol, atom.frac)) {
            atom.cart = out.cell.FractionalToCartesian(atom.frac);
        } else if (useCart && coordinates(cxCol, cyCol, czCol, atom.cart)) {
            if (out.cell.valid) atom.frac = out.cell.CartesianToFractional(atom.cart);
        } else {
            error.line = atomLoop->rowLines[row];
            error.message = "原子 " + atom.label + " 缺少有效的完整坐标";
            return false;
        }
        if (groupCol >= 0) atom.disorderGroup = atomLoop->Get(row, groupCol);
        if (assemblyCol >= 0) atom.disorderAssembly = atomLoop->Get(row, assemblyCol);
        if (occCol >= 0) {
            double occ = 1.0;
            if (ParseCifNumber(atomLoop->Get(row, static_cast<size_t>(occCol)), occ)) atom.occupancy = occ;
        }
        if (uisoCol >= 0) {
            double u = 0.0;
            if (ParseCifNumber(atomLoop->Get(row, static_cast<size_t>(uisoCol)), u)) {
                atom.uiso = u;
                atom.hasUiso = true;
            }
        }
        out.asymmetricAtoms.push_back(std::move(atom));
    }

    if (multipleModels) out.note += " 文件包含多个模型，已载入首个模型 " + model + "。";
    if (out.asymmetricAtoms.empty()) {
        error.message = "CIF 原子表为空";
        return false;
    }
    if (!out.cell.valid) out.note += "未发现完整晶胞参数，按非周期性分子结构显示。";

    int xyzColumn = -1;
    if (const CifLoop* symLoop = FindSymmetryLoop(block, xyzColumn)) {
        std::set<std::string> seen;
        for (size_t row = 0; row < symLoop->RowCount(); ++row) {
            const std::string value = Trim(symLoop->Get(row, static_cast<size_t>(xyzColumn)));
            if (value.empty() || value == "." || value == "?") continue;
            SymmetryOp op;
            std::string opError;
            if (!ParseSymmetryOperation(value, op, &opError)) {
                out.note += " 有一个对称操作无法解析，已跳过：" + opError + "。";
                continue;
            }
            const std::string canonical = Lower(op.text);
            if (seen.insert(canonical).second) out.symmetryOps.push_back(std::move(op));
        }
    } else {
        const CifItem* opItem = FindItem(block, {"_space_group_symop_operation_xyz",
                                                 "_symmetry_equiv_pos_as_xyz"});
        if (opItem) {
            SymmetryOp op;
            std::string opError;
            if (ParseSymmetryOperation(opItem->value, op, &opError)) {
                out.symmetryOps.push_back(std::move(op));
            } else {
                out.note += " 对称操作无法解析，已忽略：" + opError + "。";
            }
        }
    }
    out.symmetryOperatorCount = static_cast<int>(out.symmetryOps.size());
    if (out.cell.valid && out.symmetryOps.empty()) {
        out.note += " CIF 未提供对称操作，仅显示不对称单元。";
    }

    int coordinateBlocks = 0;
    for (const CifBlock& candidate : blocks) {
        if (ScoreBlock(candidate).hasCoordinates) ++coordinateBlocks;
    }
    if (coordinateBlocks > 1) out.note += " CIF 包含多个结构数据块，已载入原子数最多的块。";

    return true;
}

} // namespace cl
