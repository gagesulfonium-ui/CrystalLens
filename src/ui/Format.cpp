#include "Format.h"

#include "Localization.h"

#include <cstdarg>
#include <cstdio>
#include <cwchar>
#include <filesystem>

namespace cl {

std::wstring Fmt(const wchar_t* format, ...) {
    wchar_t buffer[1024];
    va_list args;
    va_start(args, format);
    const int written = _vsnwprintf_s(buffer, _countof(buffer), _TRUNCATE, format, args);
    va_end(args);
    if (written <= 0) return {};
    return std::wstring(buffer, static_cast<size_t>(written));
}

std::wstring FormatNumber(double value, int decimals) {
    wchar_t buffer[64];
    swprintf_s(buffer, L"%.*f", decimals, value);
    return buffer;
}

std::wstring AtomDisplayLabel(const Structure& structure, int atomIndex) {
    if (atomIndex < 0 || atomIndex >= static_cast<int>(structure.atoms.size())) return L"?";
    const Atom& atom = structure.atoms[static_cast<size_t>(atomIndex)];
    if (!atom.label.empty()) return Utf8ToWide(atom.label);
    return Utf8ToWide(atom.element) + std::to_wstring(atomIndex + 1);
}

std::wstring MeasurementExpression(const Structure& structure, const Measurement& measurement) {
    if (measurement.kind == MeasurementKind::Distance) {
        return AtomDisplayLabel(structure, measurement.a) + L"–" + AtomDisplayLabel(structure, measurement.b);
    }
    return AtomDisplayLabel(structure, measurement.a) + L"–" + AtomDisplayLabel(structure, measurement.b) + L"–" +
           AtomDisplayLabel(structure, measurement.c);
}

std::wstring MeasurementValueText(const Measurement& measurement) {
    if (measurement.kind == MeasurementKind::Distance) {
        return FormatNumber(measurement.value, 3) + L" Å";
    }
    return FormatNumber(measurement.value, 2) + L"°";
}

std::wstring MeasurementTypeText(const Measurement& measurement) {
    return T(measurement.kind == MeasurementKind::Distance ? Str::MeasurementDistance : Str::MeasurementAngle);
}

std::wstring FormatCellLengths(const Structure& structure) {
    if (!structure.cell.valid) return L"—";
    return L"a " + FormatNumber(structure.cell.a, 4) + L"  " + L"b " + FormatNumber(structure.cell.b, 4) + L"  " +
           L"c " + FormatNumber(structure.cell.c, 4) + L" Å";
}

std::wstring FormatCellAngles(const Structure& structure) {
    if (!structure.cell.valid) return L"—";
    return L"α " + FormatNumber(structure.cell.alpha, 2) + L"°   β " + FormatNumber(structure.cell.beta, 2) +
           L"°   γ " + FormatNumber(structure.cell.gamma, 2) + L"°";
}

std::wstring FormatVolume(const Structure& structure) {
    if (!structure.cell.valid) return L"—";
    return FormatNumber(structure.cell.volume, 2) + L" Å³";
}

std::wstring FormatFormulaText(const Structure& structure) {
    std::wstring formula = Utf8ToWide(structure.formula);
    if (formula.empty()) formula = Utf8ToWide(structure.cellContents);
    if (formula.empty()) formula = L"—";
    return formula;
}

std::wstring FormatFileStem(const std::wstring& path) {
    if (path.empty()) return {};
    return std::filesystem::path(path).stem().wstring();
}

std::wstring BuildStructureSummary(const Structure& structure, const std::vector<Measurement>& measurements) {
    std::wstring text;
    text += L"CrystalLens v1.1\n";
    text += Utf8ToWide(structure.title) + L"\n";
    text += std::wstring(L"Format: ") + FormatDisplayName(structure.format) + L"\n";
    text += std::wstring(L"Formula: ") + FormatFormulaText(structure) + L"\n";
    if (!structure.spaceGroup.empty()) text += L"Space group: " + Utf8ToWide(structure.spaceGroup) + L"\n";
    if (structure.cell.valid) {
        text += L"Cell: a=" + FormatNumber(structure.cell.a, 5) + L", b=" + FormatNumber(structure.cell.b, 5) +
                L", c=" + FormatNumber(structure.cell.c, 5) + L", alpha=" + FormatNumber(structure.cell.alpha, 3) +
                L", beta=" + FormatNumber(structure.cell.beta, 3) + L", gamma=" + FormatNumber(structure.cell.gamma, 3) +
                L"\n";
        text += L"Volume: " + FormatNumber(structure.cell.volume, 3) + L" A^3\n";
    }
    text += L"Atoms: " + std::to_wstring(structure.atoms.size()) + L", bonds: " +
            std::to_wstring(structure.bonds.size()) + L"\n";
    if (!measurements.empty()) {
        text += L"Measurements:\n";
        for (size_t i = 0; i < measurements.size(); ++i) {
            const Measurement& m = measurements[i];
            text += L"  " + std::to_wstring(i + 1) + L". " + MeasurementExpression(structure, m) + L"  " +
                    MeasurementValueText(m) + L"\n";
        }
    }
    if (!structure.sourcePathUtf8.empty()) text += L"Source: " + Utf8ToWide(structure.sourcePathUtf8) + L"\n";
    return text;
}

} // namespace cl
