#include "ui/Localization.h"
#include "ui/MainWindow.h"
#include "ui/Settings.h"
#include "ui/UiDraw.h"

#include <windows.h>
#include <objidl.h>
#include <propidl.h>
#include <gdiplus.h>
#include <shellapi.h>

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

std::vector<std::wstring> InitialFilesFromCommandLine() {
    int count = 0;
    LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
    std::vector<std::wstring> files;
    if (args) {
        for (int i = 1; i < count; ++i) {
            if (args[i][0] && args[i][0] != L'-') files.emplace_back(args[i]);
        }
        LocalFree(args);
    }
    return files;
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

    for (const auto& path : InitialFilesFromCommandLine()) window.OpenDocument(path);

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
