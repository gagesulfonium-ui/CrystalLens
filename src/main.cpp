#include "ui/Localization.h"
#include "ui/MainWindow.h"
#include "ui/Settings.h"
#include "ui/UiDraw.h"

#include <windows.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <shellapi.h>

#include <cwctype>
#include <string>
#include <vector>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

namespace {

void EnableHighDpi() {
    if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
        SetProcessDPIAware();
    }
}

std::wstring InitialFileFromCommandLine() {
    int count = 0;
    LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return {};
    std::wstring file;
    for (int i = 1; i < count; ++i) {
        std::wstring arg = args[i];
        if (arg.empty() || arg[0] == L'-') continue;
        const std::wstring lower = [&] {
            std::wstring s = arg;
            for (wchar_t& c : s) c = static_cast<wchar_t>(std::towlower(c));
            return s;
        }();
        if (lower.size() >= 4 && (lower.substr(lower.size() - 4) == L".cif" ||
                                  lower.substr(lower.size() - 4) == L".xyz")) {
            file = arg;
            break;
        }
        if (lower.size() >= 6 && lower.substr(lower.size() - 6) == L".vesta") {
            file = arg;
            break;
        }
        if (file.empty()) file = arg;
    }
    LocalFree(args);
    return file;
}

int RunApplication(HINSTANCE instance, int showCommand) {
    const cl::AppSettings settings = cl::Settings::Load();
    cl::I18n::SetLanguage(settings.language);

    cl::MainWindow window(settings);
    if (!window.Create(instance)) {
        MessageBoxW(nullptr, L"无法创建 CrystalLens 主窗口。", L"CrystalLens", MB_ICONERROR | MB_OK);
        return 2;
    }
    window.Show(showCommand);

    const std::wstring initialFile = InitialFileFromCommandLine();
    if (!initialFile.empty()) window.OpenPath(initialFile);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (!TranslateAcceleratorW(window.Hwnd(), window.Accelerators(), &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    return static_cast<int>(message.wParam);
}

} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int showCommand) {
    EnableHighDpi();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);

    Gdiplus::GdiplusStartupInput gdiplusInput;
    ULONG_PTR gdiplusToken = 0;
    if (Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusInput, nullptr) != Gdiplus::Ok) {
        MessageBoxW(nullptr, L"无法初始化 GDI+ 图形库。", L"CrystalLens", MB_ICONERROR | MB_OK);
        CoUninitialize();
        return 1;
    }

    const int result = RunApplication(instance, showCommand);
    cl::ReleaseUiFonts();
    Gdiplus::GdiplusShutdown(gdiplusToken);
    CoUninitialize();
    return result;
}
