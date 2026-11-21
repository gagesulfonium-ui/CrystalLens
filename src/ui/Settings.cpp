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

// Several document processes share the same INI. Hold the lock for an entire
// settings snapshot so a reader sees all three supercell repetitions together.
class ProfileLock {
public:
    ProfileLock() {
        if (handle_) {
            const DWORD result = WaitForSingleObject(handle_, INFINITE);
            owned_ = result == WAIT_OBJECT_0 || result == WAIT_ABANDONED;
        }
    }
    ~ProfileLock() {
        if (owned_) ReleaseMutex(handle_);
        if (handle_) CloseHandle(handle_);
    }
    ProfileLock(const ProfileLock&) = delete;
    ProfileLock& operator=(const ProfileLock&) = delete;
private:
    HANDLE handle_ = CreateMutexW(nullptr, FALSE, L"Local\\CrystalLens.Settings");
    bool owned_ = false;
};

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
    const ProfileLock lock;
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

void Settings::Save(const AppSettings& settings, const AppSettings& previous) {
    const ProfileLock lock;
    const std::wstring path = SettingsPath();
    const bool initialize = ReadInt(path, L"SettingsVersion", 0) < 4;
    // Only update preferences changed by this window. Other windows may have
    // changed different preferences since this document opened.
    auto store = [&](const wchar_t* key, auto before, auto after) {
        if (initialize || before != after) WriteInt(path, key, static_cast<int>(after));
    };
    store(L"Language", previous.language, settings.language);
    store(L"LeftPanel", previous.leftPanel, settings.leftPanel);
    store(L"RightPanel", previous.rightPanel, settings.rightPanel);
    store(L"ShowCell", previous.showCell, settings.showCell);
    store(L"ShowBonds", previous.showBonds, settings.showBonds);
    store(L"ShowLabels", previous.showLabels, settings.showLabels);
    store(L"ShowImages", previous.showImages, settings.showImages);
    store(L"ShowAxes", previous.showAxes, settings.showAxes);
    store(L"Orthographic", previous.orthographic, settings.orthographic);
    store(L"AtomStyle", previous.atomStyle, settings.atomStyle);
    store(L"PolyTransparency", previous.polyTransparency, settings.polyTransparency);
    store(L"PolyEdgeColor", previous.polyEdgeColor, settings.polyEdgeColor);
    store(L"CellColor", previous.cellColor, settings.cellColor);
    store(L"BackgroundColor", previous.backgroundColor, settings.backgroundColor);
    store(L"PolyEdgeTenths", std::lround(10 * previous.polyEdgeWidth), std::lround(10 * settings.polyEdgeWidth));
    if (initialize || settings.supercellX != previous.supercellX || settings.supercellY != previous.supercellY ||
        settings.supercellZ != previous.supercellZ) {
        WriteInt(path, L"SupercellX", settings.supercellX);
        WriteInt(path, L"SupercellY", settings.supercellY);
        WriteInt(path, L"SupercellZ", settings.supercellZ);
    }
    auto storeFloat = [&](const wchar_t* key, float before, float after) {
        if (initialize || before != after) {
            WritePrivateProfileStringW(L"CrystalLens", key, std::to_wstring(after).c_str(), path.c_str());
        }
    };
    storeFloat(L"CellWidth", previous.cellLineWidth, settings.cellLineWidth);
    storeFloat(L"AtomScale", previous.atomScale, settings.atomScale);
    if (initialize) WriteInt(path, L"SettingsVersion", 4);
}

} // namespace cl
