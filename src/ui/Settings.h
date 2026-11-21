#pragma once

#include "render/Appearance.h"

#include "Localization.h"

#include <cstdint>
#include <string>

namespace cl {

struct AppSettings : AppearanceState {
    Language language = Language::Chinese;
    bool leftPanel = true;
    bool rightPanel = true;
    bool showCell = true;
    bool showBonds = true;
    bool showLabels = false;
    bool showImages = true;
    bool showAxes = true;
    bool orthographic = false;
    int atomStyle = 0;
    float atomScale = 0.30f;
    int supercellX = 1;
    int supercellY = 1;
    int supercellZ = 1;
};

class Settings {
public:
    static AppSettings Load();
    static void Save(const AppSettings& settings, const AppSettings& previous);
    static std::wstring SettingsPath();
};

} // namespace cl
