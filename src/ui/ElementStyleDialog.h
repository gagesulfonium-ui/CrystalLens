#pragma once

#include "render/Appearance.h"
#include <windows.h>
#include <map>

namespace cl {

bool EditElementStyles(HWND owner, const std::map<int, int>& counts, int preferred, ElementStyles& styles);

} // namespace cl
