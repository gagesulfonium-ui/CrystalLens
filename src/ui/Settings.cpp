#include "Settings.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cwchar>
#include <filesystem>

namespace cl {
namespace {

std::wstring AppDataDirectory() {
    wchar_t path[MAX_PATH]{};
    DWORD length = GetEnvironmentVariableW(L"APPDATA", path, MAX_PATH);
    if (length > 0 && length < MAX_PATH) return std::wstring(path, length);
    return L".";
}

int ReadInt(const std::wstring& path, const wchar_t* key, int fallback) {
    return static_cast<int>(GetPrivateProfileIntW(L"CrystalLens", key, fallback, path.c_str()));
}

void WriteInt(const std::wstring& path, const wchar_t* key, int value) {
    const std::wstring text = std::to_wstring(value);
    WritePrivateProfileStringW(L"CrystalLens", key, text.c_str(), path.c_str());
}

bool ReadBool(const std::wstring& path, const wchar_t* key, bool fallback) {
    return ReadInt(path, key, fallback ? 1 : 0) != 0;
}

void WriteBool(const std::wstring& path, const wchar_t* key, bool value) {
    WriteInt(path, key, value ? 1 : 0);
}

} // namespace

std::wstring Settings::SettingsPath() {
    std::wstring dir = AppDataDirectory();
    if (dir.empty()) dir = L".";
    const std::wstring folder = dir + L"\\CrystalLens";
    CreateDirectoryW(folder.c_str(), nullptr);
    return folder + L"\\settings.ini";
}

AppSettings Settings::Load() {
    AppSettings settings;
    const std::wstring path = SettingsPath();
    if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) return settings;
    settings.language = ReadInt(path, L"Language", 0) == 1 ? Language::English : Language::Chinese;
    settings.leftPanel = ReadBool(path, L"LeftPanel", settings.leftPanel);
    settings.rightPanel = ReadBool(path, L"RightPanel", settings.rightPanel);
    settings.showCell = ReadBool(path, L"ShowCell", settings.showCell);
    settings.showBonds = ReadBool(path, L"ShowBonds", settings.showBonds);
    settings.showLabels = ReadBool(path, L"ShowLabels", settings.showLabels);
    settings.showImages = ReadBool(path, L"ShowImages", settings.showImages);
    settings.showAxes = ReadBool(path, L"ShowAxes", settings.showAxes);
    settings.orthographic = ReadBool(path, L"Orthographic", settings.orthographic);
    settings.atomStyle = std::clamp(ReadInt(path, L"AtomStyle", 0), 0, 2);
    settings.supercellX = std::clamp(ReadInt(path, L"SupercellX", 1), 1, kMaxCellRepeats);
    settings.supercellY = std::clamp(ReadInt(path, L"SupercellY", 1), 1, kMaxCellRepeats);
    settings.supercellZ = std::clamp(ReadInt(path, L"SupercellZ", 1), 1, kMaxCellRepeats);
    settings.polyTransparency = std::clamp(ReadInt(path, L"PolyTransparency", settings.polyTransparency), 0, 100);
    settings.polyEdgeWidth = 0.1f * std::clamp(ReadInt(path, L"PolyEdgeTenths", 12), 0, 40);
    settings.polyEdgeColor = ReadInt(path, L"PolyEdgeColor", settings.polyEdgeColor) & 0xFFFFFF;
    settings.cellColor = static_cast<uint32_t>(ReadInt(path, L"CellColor", 0xD6DEE9));
    settings.backgroundColor = static_cast<uint32_t>(ReadInt(path, L"BackgroundColor", 0x020305));
    wchar_t cellWidthText[64]{};
    GetPrivateProfileStringW(L"CrystalLens", L"CellWidth", L"1.0", cellWidthText, 64, path.c_str());
    wchar_t* widthEnd = nullptr;
    const double cellWidth = std::wcstod(cellWidthText, &widthEnd);
    if (widthEnd != cellWidthText && cellWidth >= 0.5 && cellWidth <= 4.0) {
        settings.cellLineWidth = static_cast<float>(cellWidth);
    }
    wchar_t scaleText[64]{};
    GetPrivateProfileStringW(L"CrystalLens", L"AtomScale", L"0.30", scaleText, 64, path.c_str());
    wchar_t* end = nullptr;
    const double scale = std::wcstod(scaleText, &end);
    if (end != scaleText && scale >= 0.15 && scale <= 0.85) settings.atomScale = static_cast<float>(scale);
    // v0.2/v0.3 defaults were tuned for a cell-only view. Upgrade existing
    // profiles once to the v0.4 boundary view and its larger atom scale.
    if (ReadInt(path, L"SettingsVersion", 1) < 4) {
        settings.atomScale = 0.30f;
        settings.showImages = true;
    }
    return settings;
}

void Settings::Save(const AppSettings& settings) {
    const std::wstring path = SettingsPath();
    WriteInt(path, L"SettingsVersion", 4);
    WriteInt(path, L"Language", static_cast<int>(settings.language));
    WriteBool(path, L"LeftPanel", settings.leftPanel);
    WriteBool(path, L"RightPanel", settings.rightPanel);
    WriteBool(path, L"ShowCell", settings.showCell);
    WriteBool(path, L"ShowBonds", settings.showBonds);
    WriteBool(path, L"ShowLabels", settings.showLabels);
    WriteBool(path, L"ShowImages", settings.showImages);
    WriteBool(path, L"ShowAxes", settings.showAxes);
    WriteBool(path, L"Orthographic", settings.orthographic);
    WriteInt(path, L"AtomStyle", settings.atomStyle);
    WriteInt(path, L"PolyTransparency", settings.polyTransparency);
    WriteInt(path, L"PolyEdgeTenths", static_cast<int>(std::lround(10 * settings.polyEdgeWidth)));
    WriteInt(path, L"PolyEdgeColor", settings.polyEdgeColor);
    WriteInt(path, L"SupercellX", settings.supercellX);
    WriteInt(path, L"SupercellY", settings.supercellY);
    WriteInt(path, L"SupercellZ", settings.supercellZ);
    WriteInt(path, L"CellColor", static_cast<int>(settings.cellColor));
    WriteInt(path, L"BackgroundColor", static_cast<int>(settings.backgroundColor));
    const std::wstring cellWidth = std::to_wstring(settings.cellLineWidth);
    WritePrivateProfileStringW(L"CrystalLens", L"CellWidth", cellWidth.c_str(), path.c_str());
    const std::wstring scale = std::to_wstring(settings.atomScale);
    WritePrivateProfileStringW(L"CrystalLens", L"AtomScale", scale.c_str(), path.c_str());
}

} // namespace cl
