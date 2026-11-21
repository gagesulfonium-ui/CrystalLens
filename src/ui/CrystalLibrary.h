#pragma once

#include <windows.h>
#include <string>
#include <vector>

namespace cl {
std::wstring ExecutablePath();
std::vector<std::wstring> ChooseLibraryStructures(HWND owner);
} // namespace cl
