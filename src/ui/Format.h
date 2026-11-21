#pragma once

#include "core/Crystal.h"

#include <string>
#include <vector>

namespace cl {

std::wstring FormatNumber(double value, int decimals);
std::wstring AtomDisplayLabel(const Structure& structure, int atomIndex);
std::wstring MeasurementExpression(const Structure& structure, const Measurement& measurement);
std::wstring MeasurementValueText(const Measurement& measurement);
std::wstring MeasurementTypeText(const Measurement& measurement);
std::wstring BuildStructureSummary(const Structure& structure, const std::vector<Measurement>& measurements);
std::wstring FormatCellLengths(const Structure& structure);
std::wstring FormatCellAngles(const Structure& structure);
std::wstring FormatVolume(const Structure& structure);
std::wstring FormatFormulaText(const Structure& structure);
std::wstring FormatFileStem(const std::wstring& path);

std::wstring Fmt(const wchar_t* format, ...);

} // namespace cl
