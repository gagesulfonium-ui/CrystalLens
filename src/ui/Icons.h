#pragma once

#include "UiDraw.h"

namespace cl {

enum class Icon {
    Open,
    Reload,
    Camera,
    Reset,
    Fit,
    Cube,
    Cell,
    Bond,
    Label,
    Ruler,
    Angle,
    Trash,
    PanelLeft,
    PanelRight,
    Info,
    Check,
    Close,
    ChevronLeft,
    ChevronRight,
    ChevronDown
};

void DrawIcon(Gdiplus::Graphics& graphics, Icon icon, const UiRect& box, const UiColor& color,
              float strokeScale = 1.0f);
void DrawLogo(Gdiplus::Graphics& graphics, const UiRect& box, bool detailed = true);

} // namespace cl
