#include "MainWindow.h"

#include "Format.h"
#include "CrystalLibrary.h"
#include "Icons.h"
#include "Localization.h"
#include "core/PeriodicTable.h"

#include <commdlg.h>
#include <dwmapi.h>
#include <knownfolders.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <windowsx.h>

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <iterator>
#include <string>
#include <vector>

namespace cl {
namespace {

constexpr int kTooltipTimer = 2;
constexpr int kTooltipDelayMs = 550;
constexpr wchar_t kMainClass[] = L"CrystalLensMainWindow";

constexpr DWORD kDwmUseDarkMode = 20;
constexpr DWORD kDwmBorderColor = 34;
constexpr DWORD kDwmCaptionColor = 35;
constexpr DWORD kDwmTextColor = 36;

UiRect RectOf(const RECT& rect) {
    return UiRect(static_cast<float>(rect.left), static_cast<float>(rect.top),
                  static_cast<float>(rect.right - rect.left), static_cast<float>(rect.bottom - rect.top));
}

RECT MakeRect(float x, float y, float w, float h) {
    RECT r;
    r.left = static_cast<LONG>(std::lround(x));
    r.top = static_cast<LONG>(std::lround(y));
    r.right = static_cast<LONG>(std::lround(x + w));
    r.bottom = static_cast<LONG>(std::lround(y + h));
    return r;
}

RECT WorkAreaForWindow(HWND hwnd) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    HMONITOR monitor = MonitorFromWindow(hwnd ? hwnd : GetForegroundWindow(), MONITOR_DEFAULTTONEAREST);
    if (monitor && GetMonitorInfoW(monitor, &info)) return info.rcWork;
    RECT fallback{0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
    return fallback;
}

std::wstring EllipsizeText(Painter& painter, const std::wstring& text, float size, float maxWidth, bool bold = false) {
    if (text.empty() || painter.MeasureText(text, size, bold) <= maxWidth) return text;
    const std::wstring suffix = L"…";
    for (size_t count = text.size(); count > 0; --count) {
        std::wstring candidate = text.substr(0, count - 1) + suffix;
        if (painter.MeasureText(candidate, size, bold) <= maxWidth) return candidate;
    }
    return suffix;
}

std::wstring ElementSymbolText(int atomicNumber) {
    return Utf8ToWide(ElementByZ(atomicNumber).symbol);
}

std::wstring CoordinateText(const Vec3& v, int decimals) {
    return L"x " + FormatNumber(v.x, decimals) + L"   y " + FormatNumber(v.y, decimals) + L"   z " +
           FormatNumber(v.z, decimals);
}

std::wstring FormatPercent(float value) {
    wchar_t buffer[32];
    swprintf_s(buffer, L"%d%%", static_cast<int>(std::lround(value * 100.0f)));
    return buffer;
}

bool ParseNumberToken(const std::wstring& text, double& value) {
    std::wstring trimmed = text;
    while (!trimmed.empty() && std::iswspace(trimmed.front())) trimmed.erase(trimmed.begin());
    while (!trimmed.empty() && std::iswspace(trimmed.back())) trimmed.pop_back();
    if (trimmed.empty()) return false;
    wchar_t* end = nullptr;
    errno = 0;
    const double parsed = std::wcstod(trimmed.c_str(), &end);
    if (end == trimmed.c_str() || errno == ERANGE || !std::isfinite(parsed)) return false;
    while (*end && std::iswspace(*end)) ++end;
    if (*end != L'\0') return false;
    value = parsed;
    return true;
}

int FindDisplayedSite(const Structure& structure, int siteIndex) {
    for (size_t i = 0; i < structure.atoms.size(); ++i) {
        if (structure.atoms[i].siteIndex == siteIndex) return static_cast<int>(i);
    }
    return -1;
}

bool WriteClipboardText(HWND owner, const std::wstring& text) {
    if (!OpenClipboard(owner)) return false;
    EmptyClipboard();
    const SIZE_T bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (!memory) {
        CloseClipboard();
        return false;
    }
    void* data = GlobalLock(memory);
    if (!data) {
        GlobalFree(memory);
        CloseClipboard();
        return false;
    }
    memcpy(data, text.c_str(), bytes);
    GlobalUnlock(memory);
    if (!SetClipboardData(CF_UNICODETEXT, memory)) {
        GlobalFree(memory);
        CloseClipboard();
        return false;
    }
    CloseClipboard();
    return true;
}

bool ShowSaveStructureDialog(HWND owner, const std::wstring& suggested, bool allowCif, bool& cif,
                             std::wstring& path) {
    std::vector<wchar_t> buffer(32768, L'\0');
    if (!suggested.empty()) wcsncpy_s(buffer.data(), buffer.size(), suggested.c_str(), _TRUNCATE);
    std::wstring filters;
    if (allowCif) {
        filters += T(Str::FileFilterCif);
        filters.push_back(L'\0');
        filters += L"*.cif";
        filters.push_back(L'\0');
    }
    filters += T(Str::FileFilterXyz);
    filters.push_back(L'\0');
    filters += L"*.xyz";
    filters.push_back(L'\0');
    filters.push_back(L'\0');
    OPENFILENAMEW ofn{};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = filters.c_str();
    ofn.nFilterIndex = allowCif ? (cif ? 1 : 2) : 1;
    ofn.lpstrFile = buffer.data();
    ofn.nMaxFile = static_cast<DWORD>(buffer.size());
    ofn.lpstrTitle = T(Str::SaveStructureTitle);
    ofn.lpstrDefExt = allowCif ? (cif ? L"cif" : L"xyz") : L"xyz";
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
    if (!GetSaveFileNameW(&ofn)) return false;
    path = buffer.data();
    std::wstring extension = std::filesystem::path(path).extension().wstring();
    std::transform(extension.begin(), extension.end(), extension.begin(),
                   [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    if (extension == L".xyz") {
        cif = false;
    } else if (extension == L".cif" || extension == L".mcif") {
        cif = true;
    } else {
        cif = allowCif && ofn.nFilterIndex == 1;
        path += cif ? L".cif" : L".xyz";
    }
    return true;
}

bool ShowOpenDialog(HWND owner, std::vector<std::wstring>& paths) {
    IFileOpenDialog* dialog = nullptr;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) {
        return false;
    }
    DWORD options = 0;
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_ALLOWMULTISELECT | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST);
    dialog->SetTitle(T(Str::OpenDialogTitle));
    const COMDLG_FILTERSPEC filters[] = {
        {T(Str::AllSupportedFiles), L"*.cif;*.mcif;*.vesta;*.xyz"},
        {T(Str::FileFilterCif), L"*.cif;*.mcif"},
        {T(Str::FileFilterVesta), L"*.vesta"},
        {T(Str::FileFilterXyz), L"*.xyz"},
    };
    dialog->SetFileTypes(static_cast<UINT>(std::size(filters)), filters);
    dialog->SetFileTypeIndex(1);
    HRESULT result = dialog->Show(owner);
    if (FAILED(result)) {
        dialog->Release();
        return false;
    }
    IShellItemArray* items = nullptr;
    if (SUCCEEDED(dialog->GetResults(&items))) {
        DWORD count = 0;
        items->GetCount(&count);
        for (DWORD i = 0; i < count; ++i) {
            IShellItem* item = nullptr;
            if (FAILED(items->GetItemAt(i, &item))) continue;
            PWSTR value = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &value))) {
                paths.emplace_back(value);
                CoTaskMemFree(value);
            }
            item->Release();
        }
        items->Release();
    }
    dialog->Release();
    return !paths.empty();
}

std::wstring PicturesDirectory() {
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Pictures, KF_FLAG_CREATE, nullptr, &path)) && path) {
        std::wstring result(path);
        CoTaskMemFree(path);
        return result;
    }
    wchar_t fallback[MAX_PATH]{};
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_MYPICTURES | CSIDL_FLAG_CREATE, nullptr, SHGFP_TYPE_CURRENT,
                                   fallback))) {
        return fallback;
    }
    return L".";
}

} // namespace

MainWindow::MainWindow(const AppSettings& settings) : viewport_(this), savedSettings_(settings) {
    leftVisible_ = settings.leftPanel;
    rightVisible_ = settings.rightPanel;
    options_.showCell = settings.showCell;
    options_.showBonds = settings.showBonds;
    options_.showLabels = settings.showLabels;
    options_.showImages = settings.showImages;
    options_.showAxes = settings.showAxes;
    options_.supercellX = settings.supercellX;
    options_.supercellY = settings.supercellY;
    options_.supercellZ = settings.supercellZ;
    static_cast<AppearanceState&>(options_) = settings;
    options_.atomScale = std::clamp(settings.atomScale, 0.15f, 0.85f);
    options_.style = settings.atomStyle == 2   ? AtomStyle::Polyhedral
                     : settings.atomStyle == 1 ? AtomStyle::SpaceFill
                                               : AtomStyle::BallAndStick;
    statusMessage_ = T(Str::StatusReadyHint);
}

MainWindow::~MainWindow() {
    if (hwnd_) DestroyWindow(hwnd_);
}

bool MainWindow::Create(HINSTANCE instance) {
    instance_ = instance;
    const HICON icon = LoadIconW(instance, MAKEINTRESOURCEW(101));
    const HICON smallIcon = icon ? icon : LoadIconW(nullptr, IDI_APPLICATION);

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = StaticWndProc;
    wc.hInstance = instance;
    wc.hIcon = smallIcon;
    wc.hIconSm = smallIcon;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = kMainClass;
    if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;

    hwnd_ = CreateWindowExW(0, kMainClass, L"CrystalLens", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                            CW_USEDEFAULT, CW_USEDEFAULT, 1280, 800, nullptr, nullptr, instance, this);
    if (!hwnd_) return false;

    dpi_ = GetDpiForWindow(hwnd_);
    if (dpi_ == 0) dpi_ = 96;
    scale_ = static_cast<float>(dpi_) / 96.0f;
    InitDarkTitleBar();
    DragAcceptFiles(hwnd_, TRUE);

    RECT work = WorkAreaForWindow(hwnd_);
    const int desiredWidth = static_cast<int>(std::lround(1360.0f * scale_));
    const int desiredHeight = static_cast<int>(std::lround(830.0f * scale_));
    const int width = std::min(desiredWidth, static_cast<int>((work.right - work.left) * 0.94f));
    const int height = std::min(desiredHeight, static_cast<int>((work.bottom - work.top) * 0.92f));
    const int x = work.left + ((work.right - work.left) - width) / 2;
    const int y = work.top + ((work.bottom - work.top) - height) / 2;
    SetWindowPos(hwnd_, nullptr, x, y, width, height, SWP_NOZORDER | SWP_NOACTIVATE);

    if (!viewport_.Create(hwnd_, 100, scale_)) {
        statusMessage_ = T(Str::RendererError);
    }
    viewport_.SetOptions(options_);
    viewport_.SetOrthographic(savedSettings_.orthographic);

    menu_.Create(hwnd_);
    tooltip_.Create(hwnd_);
    toast_.Create(hwnd_);
    help_.Create(hwnd_);
    form_.Create(hwnd_);
    appearance_.Create(hwnd_);

    ACCEL commands[] = {
        {FVIRTKEY | FCONTROL, 'O', CmdOpen},
        {FVIRTKEY | FCONTROL, 'L', CmdLibrary},
        {FVIRTKEY | FCONTROL, 'R', CmdReload},
        {FVIRTKEY | FCONTROL, 'S', CmdSaveStructure},
        {FVIRTKEY | FCONTROL | FSHIFT, 'S', CmdScreenshot},
        {FVIRTKEY | FCONTROL, 'C', CmdCopySummary},
        {FVIRTKEY | FCONTROL, 'Z', CmdUndo},
        {FVIRTKEY | FCONTROL, 'Y', CmdRedo},
        {FVIRTKEY | FCONTROL, 'E', CmdEditCell},
        {FVIRTKEY | FCONTROL | FSHIFT, 'A', CmdAddAtom},
        {FVIRTKEY, VK_F2, CmdEditAtom},
        {FVIRTKEY, VK_DELETE, CmdDeleteAtom},
        {FVIRTKEY, VK_F1, CmdHelp},
    };
    accelerators_ = CreateAcceleratorTableW(commands, static_cast<int>(std::size(commands)));

    UpdateTitle();
    Relayout();
    return true;
}

void MainWindow::Show(int commandShow) {
    ShowWindow(hwnd_, commandShow);
    UpdateWindow(hwnd_);
    SetForegroundWindow(hwnd_);
    if (viewport_.Hwnd()) SetFocus(viewport_.Hwnd());
}

void MainWindow::InitDarkTitleBar() {
    const BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd_, kDwmUseDarkMode, &dark, sizeof(dark));
    const COLORREF caption = RGB(10, 14, 22);
    const COLORREF textColor = RGB(233, 239, 248);
    const COLORREF border = RGB(40, 51, 69);
    DwmSetWindowAttribute(hwnd_, kDwmCaptionColor, &caption, sizeof(caption));
    DwmSetWindowAttribute(hwnd_, kDwmTextColor, &textColor, sizeof(textColor));
    DwmSetWindowAttribute(hwnd_, kDwmBorderColor, &border, sizeof(border));
}

void MainWindow::Relayout() {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    clientWidth_ = rc.right - rc.left;
    clientHeight_ = rc.bottom - rc.top;
    const auto S = [&](float dip) { return static_cast<int>(std::lround(dip * scale_)); };

    menuBarRect_ = {0, 0, clientWidth_, S(38.0f)};
    toolbarRect_ = {0, menuBarRect_.bottom, clientWidth_, S(52.0f)};
    statusRect_ = {0, clientHeight_ - S(30.0f), clientWidth_, clientHeight_};
    const int contentTop = toolbarRect_.bottom + S(8.0f);
    const int contentBottom = std::max(contentTop + S(100.0f), static_cast<int>(statusRect_.top) - S(8.0f));
    const int margin = S(12.0f);
    const int gap = S(10.0f);
    const int leftWidth = leftVisible_ ? S(262.0f) : 0;
    const int rightWidth = rightVisible_ ? S(296.0f) : 0;

    leftPanelRect_ = {};
    rightPanelRect_ = {};
    if (leftWidth > 0) leftPanelRect_ = {margin, contentTop, margin + leftWidth, contentBottom};
    if (rightWidth > 0)
        rightPanelRect_ = {clientWidth_ - margin - rightWidth, contentTop, clientWidth_ - margin, contentBottom};

    const int centralLeft = margin + (leftWidth > 0 ? leftWidth + gap : 0);
    const int centralRight = clientWidth_ - margin - (rightWidth > 0 ? rightWidth + gap : 0);
    viewportFrameRect_ = {centralLeft, contentTop, std::max(centralLeft + 40, centralRight), contentBottom};
    UpdateViewportBounds();
}

void MainWindow::UpdateViewportBounds() {
    if (!viewport_.Hwnd()) return;
    const int inset = static_cast<int>(std::lround(scale_));
    RECT child = viewportFrameRect_;
    child.left += inset;
    child.top += inset;
    child.right -= inset;
    child.bottom -= inset;
    if (child.right <= child.left || child.bottom <= child.top) return;
    viewportChildRect_ = child;
    viewportChildValid_ = true;
    SetWindowPos(viewport_.Hwnd(), nullptr, child.left, child.top, child.right - child.left,
                 child.bottom - child.top, SWP_NOZORDER | SWP_NOACTIVATE);
}

LRESULT CALLBACK MainWindow::StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
    MainWindow* self = reinterpret_cast<MainWindow*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = static_cast<MainWindow*>(create->lpCreateParams);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        if (self) self->hwnd_ = hwnd;
    }
    if (self) return self->WndProc(message, wParam, lParam);
    return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT MainWindow::WndProc(UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_NCCREATE:
        return TRUE;
    case WM_CREATE:
        return 0;
    case WM_SIZE: {
        Relayout();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    }
    case WM_GETMINMAXINFO: {
        auto* info = reinterpret_cast<MINMAXINFO*>(lParam);
        info->ptMinTrackSize.x = static_cast<LONG>(std::lround(900.0f * scale_));
        info->ptMinTrackSize.y = static_cast<LONG>(std::lround(560.0f * scale_));
        return 0;
    }
    case WM_DPICHANGED: {
        dpi_ = HIWORD(wParam);
        scale_ = static_cast<float>(dpi_) / 96.0f;
        auto* suggested = reinterpret_cast<RECT*>(lParam);
        SetWindowPos(hwnd_, nullptr, suggested->left, suggested->top, suggested->right - suggested->left,
                     suggested->bottom - suggested->top, SWP_NOZORDER | SWP_NOACTIVATE);
        viewport_.SetDpi(scale_);
        ResetHover();
        Relayout();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    }
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT:
        Paint();
        return 0;
    case WM_MOUSEMOVE: {
        if (!trackingLeave_) {
            TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, hwnd_, 0};
            TrackMouseEvent(&track);
            trackingLeave_ = true;
        }
        const int x = GET_X_LPARAM(lParam);
        const int y = GET_Y_LPARAM(lParam);
        if (sliderDragging_) {
            UpdateSliderFromX(x);
            return 0;
        }
        UpdateHover(x, y);
        return 0;
    }
    case WM_MOUSELEAVE:
        trackingLeave_ = false;
        ResetHover();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    case WM_LBUTTONDOWN: {
        SetFocus(hwnd_);
        const int index = FindHotspot(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
        if (index < 0) return 0;
        const Hotspot& hotspot = hotspots_[static_cast<size_t>(index)];
        if (!hotspot.enabled) return 0;
        HideTooltip();
        if (hotspot.kind == HotspotKind::OpenMenu) {
            OpenMenu(hotspot.value);
            return 0;
        }
        if (hotspot.kind == HotspotKind::Slider) {
            sliderDragging_ = true;
            SetCapture(hwnd_);
            UpdateSliderFromX(GET_X_LPARAM(lParam));
            return 0;
        }
        pressed_ = true;
        pressedKind_ = hotspot.kind;
        pressedValue_ = hotspot.value;
        SetCapture(hwnd_);
        return 0;
    }
    case WM_LBUTTONUP: {
        if (sliderDragging_) {
            sliderDragging_ = false;
            if (GetCapture() == hwnd_) ReleaseCapture();
            ApplyOptions(true);
            return 0;
        }
        if (pressed_) {
            const int index = FindHotspot(GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam));
            if (index >= 0) {
                const Hotspot hotspot = hotspots_[static_cast<size_t>(index)];
                if (hotspot.enabled && hotspot.kind == pressedKind_ && hotspot.value == pressedValue_) {
                    ExecuteHotspot(hotspot);
                }
            }
            pressed_ = false;
            if (GetCapture() == hwnd_) ReleaseCapture();
        }
        return 0;
    }
    case WM_CAPTURECHANGED:
        sliderDragging_ = false;
        pressed_ = false;
        return 0;
    case WM_MOUSEWHEEL: {
        POINT pt{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
        ScreenToClient(hwnd_, &pt);
        const int delta = GET_WHEEL_DELTA_WPARAM(wParam);
        if (PtInRect(&leftPanelRect_, pt)) {
            ScrollPanel(true, delta);
            return 0;
        }
        if (PtInRect(&rightPanelRect_, pt)) {
            ScrollPanel(false, delta);
            return 0;
        }
        return 0;
    }
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT) {
            POINT pt{};
            GetCursorPos(&pt);
            ScreenToClient(hwnd_, &pt);
            int index = FindHotspot(pt.x, pt.y);
            bool hand = false;
            bool resize = false;
            if (sliderDragging_) {
                resize = true;
            } else if (index >= 0) {
                const Hotspot& hotspot = hotspots_[static_cast<size_t>(index)];
                if (hotspot.kind == HotspotKind::Slider) resize = true;
                else if (hotspot.enabled) hand = true;
            }
            SetCursor(LoadCursorW(nullptr, resize ? IDC_SIZEWE : (hand ? IDC_HAND : IDC_ARROW)));
            return TRUE;
        }
        break;
    case WM_KEYDOWN: {
        if (GetKeyState(VK_CONTROL) & 0x8000) break;
        switch (wParam) {
        case VK_F1:
            ExecuteCommand(CmdHelp);
            return 0;
        case VK_ESCAPE:
            if (help_.IsVisible()) {
                help_.Hide();
            } else if (viewport_.Mode() != MeasureMode::None) {
                viewport_.CancelMeasure();
            }
            return 0;
        case 'F':
            viewport_.FitView();
            return 0;
        case VK_HOME:
            viewport_.ResetView();
            return 0;
        case 'D':
            ExecuteCommand(CmdMeasureDistance);
            return 0;
        case 'A':
            ExecuteCommand(CmdMeasureAngle);
            return 0;
        case 'C':
            ExecuteCommand(CmdToggleCell);
            return 0;
        case 'B':
            ExecuteCommand(CmdToggleBonds);
            return 0;
        case 'L':
            ExecuteCommand(CmdToggleLabels);
            return 0;
        case 'P':
            ExecuteCommand(viewport_.Orthographic() ? CmdPerspective : CmdOrthographic);
            return 0;
        default:
            break;
        }
        break;
    }
    case WM_TIMER:
        if (wParam == kTooltipTimer && tooltipPending_) {
            KillTimer(hwnd_, kTooltipTimer);
            tooltipPending_ = false;
            POINT cursor{};
            GetCursorPos(&cursor);
            POINT client = cursor;
            ScreenToClient(hwnd_, &client);
            const int index = FindHotspot(client.x, client.y);
            if (index >= 0) ShowTooltipForHotspot(index);
            return 0;
        }
        break;
    case WM_COMMAND:
        ExecuteCommand(LOWORD(wParam));
        return 0;
    case WM_CL_MENU_CLOSED:
        openMenu_ = -1;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return 0;
    case WM_DROPFILES: {
        HDROP drop = reinterpret_cast<HDROP>(wParam);
        const UINT count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
        for (UINT i = 0; i < count; ++i) {
            const UINT length = DragQueryFileW(drop, i, nullptr, 0);
            std::wstring path(length + 1, L'\0');
            if (DragQueryFileW(drop, i, path.data(), length + 1)) {
                path.resize(length);
                OpenDocument(path);
            }
        }
        DragFinish(drop);
        return 0;
    }
    case WM_ACTIVATEAPP:
        if (wParam == FALSE) {
            HideTooltip();
            ResetHover();
        }
        return 0;
    case WM_CLOSE:
        if (form_.IsVisible()) form_.Hide();
        if (!ConfirmDiscardChanges()) return 0;
        help_.Hide();
        SaveSettingsNow();
        DestroyWindow(hwnd_);
        return 0;
    case WM_DESTROY:
        HideTooltip();
        viewport_.Destroy();
        toast_.Hide();
        help_.Hide();
        if (accelerators_) {
            DestroyAcceleratorTable(accelerators_);
            accelerators_ = nullptr;
        }
        PostQuitMessage(0);
        return 0;
    case WM_NCDESTROY: {
        const HWND window = hwnd_;
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        hwnd_ = nullptr;
        return DefWindowProcW(window, message, wParam, lParam);
    }
    default:
        break;
    }
    return DefWindowProcW(hwnd_, message, wParam, lParam);
}

void MainWindow::Paint() {
    PAINTSTRUCT ps{};
    HDC dc = BeginPaint(hwnd_, &ps);
    RECT client{};
    GetClientRect(hwnd_, &client);
    const int width = client.right - client.left;
    const int height = client.bottom - client.top;
    if (width > 0 && height > 0) {
        hotspots_.clear();
        Gdiplus::Bitmap buffer(width, height, PixelFormat32bppPARGB);
        Gdiplus::Graphics graphics(&buffer);
        Painter painter(graphics, scale_);
        PaintBackground(painter);
        PaintViewportFrame(painter);
        PaintLeftPanel(painter);
        PaintRightPanel(painter);
        PaintMenuBar(painter);
        PaintToolbar(painter);
        PaintStatusBar(painter);
        Gdiplus::Graphics screen(dc);
        screen.DrawImage(&buffer, 0, 0);
    }
    EndPaint(hwnd_, &ps);
}

void MainWindow::PaintBackground(Painter& painter) {
    const auto S = [&](float dip) { return dip * scale_; };
    Gdiplus::LinearGradientBrush background(UiRect(0, 0, static_cast<float>(clientWidth_),
                                                   static_cast<float>(clientHeight_)),
                                            UiColor(255, 12, 17, 26), UiColor(255, 7, 10, 16),
                                            Gdiplus::LinearGradientModeVertical);
    painter.Graphics().FillRectangle(&background, 0, 0, clientWidth_, clientHeight_);
    painter.GlowEllipse(UiRect(-S(180), -S(220), S(640), S(580)), UiColor(17, 46, 87, 176),
                        UiColor(0, 46, 87, 176));
    painter.GlowEllipse(UiRect(clientWidth_ - S(380), clientHeight_ - S(280), S(560), S(470)),
                        UiColor(10, 24, 85, 62), UiColor(0, 24, 85, 62));
}

void MainWindow::PaintViewportFrame(Painter& painter) {
    const auto S = [&](float dip) { return dip * scale_; };
    painter.Shadow(RectOf(viewportFrameRect_), S(13.0f), UiColor(4, 0, 0, 0), S(5.0f));
    painter.FillRoundRectGradient(RectOf(viewportFrameRect_), S(13.0f), UiColor(255, 17, 23, 34),
                                  UiColor(255, 9, 13, 20));
    painter.StrokeRoundRect(RectOf(viewportFrameRect_), S(13.0f), UiColor(255, 39, 50, 68), S(1.0f));
}

void MainWindow::PaintSectionLabel(Painter& painter, float x, float y, const std::wstring& text) {
    const auto S = [&](float dip) { return dip * scale_; };
    painter.FillRoundRect(UiRect(x, y - S(6.0f), S(3.0f), S(12.0f)), S(1.5f), Theme::kAccent);
    painter.Text(text, UiRect(x + S(9.0f), y - S(9.0f), S(240.0f), S(18.0f)), S(9.2f),
                 UiColor(255, 116, 131, 154), UiTextAlign::Left, UiTextVAlign::Middle, true);
}

void MainWindow::PaintSwitch(Painter& painter, float right, float centerY, bool on, bool enabled) {
    const auto S = [&](float dip) { return dip * scale_; };
    const float width = S(32.0f);
    const float height = S(17.0f);
    const UiRect track(right - width, centerY - height * 0.5f, width, height);
    const UiColor fill = enabled ? (on ? Theme::kAccent : UiColor(255, 38, 48, 65))
                                 : UiColor(255, 30, 38, 51);
    painter.FillRoundRect(track, height * 0.5f, fill);
    if (!on || !enabled) painter.StrokeRoundRect(track, height * 0.5f, UiColor(255, 54, 67, 88), 1.0f);
    const float knobSize = S(13.0f);
    const float knobX = on ? right - knobSize - S(2.0f) : track.X + S(2.0f);
    painter.FillRoundRect(UiRect(knobX, centerY - knobSize * 0.5f, knobSize, knobSize), knobSize * 0.5f,
                          enabled && on ? UiColor(255, 255, 255, 255) : UiColor(255, 151, 163, 181));
}

void MainWindow::PaintToolButton(Painter& painter, const UiRect& rect, Icon icon, const std::wstring& label,
                                 int command, const std::wstring& tooltip, bool active, bool enabled,
                                 const UiColor& accent) {
    const auto S = [&](float dip) { return dip * scale_; };
    const bool hover = HotspotHovered(HotspotKind::Command, command);
    if (active) {
        const UiColor fill(38, accent.GetR(), accent.GetG(), accent.GetB());
        painter.FillRoundRect(rect, S(8.0f), fill);
        painter.StrokeRoundRect(rect, S(8.0f), UiColor(90, accent.GetR(), accent.GetG(), accent.GetB()), S(1.0f));
    } else if (hover && enabled) {
        painter.FillRoundRect(rect, S(8.0f), UiColor(255, 29, 38, 55));
    }
    const UiColor iconColor = !enabled ? UiColor(255, 75, 88, 108)
                              : active ? accent
                              : hover ? Theme::kText
                                      : Theme::kTextSecondary;
    const float iconSize = S(18.0f);
    if (label.empty()) {
        DrawIcon(painter.Graphics(), icon,
                 UiRect(rect.X + (rect.Width - iconSize) * 0.5f, rect.Y + (rect.Height - iconSize) * 0.5f,
                        iconSize, iconSize),
                 iconColor);
    } else {
        const float iconBox = S(16.0f);
        DrawIcon(painter.Graphics(), icon,
                 UiRect(rect.X + S(9.0f), rect.Y + (rect.Height - iconBox) * 0.5f, iconBox, iconBox),
                 iconColor);
        const UiColor textColor = !enabled ? UiColor(255, 75, 88, 108)
                                  : active ? accent
                                  : hover ? Theme::kText
                                          : UiColor(255, 183, 195, 213);
        painter.Text(label, UiRect(rect.X + S(31.0f), rect.Y, rect.Width - S(34.0f), rect.Height),
                     S(10.5f), textColor, UiTextAlign::Left, UiTextVAlign::Middle, active);
    }
    AddHotspot(HotspotKind::Command, MakeRect(rect.X, rect.Y, rect.Width, rect.Height), command, enabled,
               tooltip);
}

void MainWindow::PaintMenuBar(Painter& painter) {
    const auto S = [&](float dip) { return dip * scale_; };
    const float top = static_cast<float>(menuBarRect_.top);
    const float height = static_cast<float>(menuBarRect_.bottom - menuBarRect_.top);
    painter.FillRect(RectOf(menuBarRect_), UiColor(224, 10, 14, 22));
    painter.Divider(0.0f, static_cast<float>(clientWidth_), static_cast<float>(menuBarRect_.bottom) - 1.0f,
                    UiColor(255, 30, 39, 54));

    const float logoSize = S(24.0f);
    const UiRect logo(S(16.0f), top + (height - logoSize) * 0.5f, logoSize, logoSize);
    DrawLogo(painter.Graphics(), logo, true);
    const std::wstring appName = T(Str::AppName);
    const float nameSize = S(13.5f);
    const float nameX = logo.X + logo.Width + S(10.0f);
    painter.Text(appName, UiRect(nameX, top, S(160.0f), height), nameSize, Theme::kText, UiTextAlign::Left,
                 UiTextVAlign::Middle, true);
    float cursorX = nameX + painter.MeasureText(appName, nameSize, true) + S(8.0f);
    const std::wstring versionText = T(Str::VersionPrefix);
    const float versionWidth = painter.MeasureText(versionText, S(8.2f)) + S(14.0f);
    const UiRect versionRect(cursorX, top + (height - S(17.0f)) * 0.5f, versionWidth, S(17.0f));
    painter.FillRoundRect(versionRect, S(8.0f), UiColor(255, 25, 33, 47));
    painter.StrokeRoundRect(versionRect, S(8.0f), UiColor(255, 42, 53, 71), S(1.0f));
    painter.Text(versionText, versionRect, S(8.2f), UiColor(255, 126, 142, 167), UiTextAlign::Center,
                 UiTextVAlign::Middle, false, true);
    cursorX = versionRect.X + versionRect.Width + S(22.0f);

    const Str menuNames[5] = {Str::FileMenu, Str::EditMenu, Str::ViewMenu, Str::MeasureMenu, Str::HelpMenu};
    const float menuSize = S(11.8f);
    for (int i = 0; i < 5; ++i) {
        const std::wstring label = T(menuNames[i]);
        const float width = painter.MeasureText(label, menuSize) + S(22.0f);
        const UiRect rect(cursorX, top + S(6.0f), width, S(26.0f));
        if (openMenu_ == i || HotspotHovered(HotspotKind::OpenMenu, i)) {
            painter.FillRoundRect(rect, S(7.0f), UiColor(255, 29, 38, 54));
        }
        if (openMenu_ == i) {
            painter.FillRoundRect(UiRect(rect.X + S(9.0f), rect.Y + rect.Height - S(2.0f),
                                         rect.Width - S(18.0f), S(2.0f)),
                                  S(1.0f), Theme::kAccent);
        }
        painter.Text(label, rect, menuSize,
                     openMenu_ == i ? Theme::kText : Theme::kTextSecondary, UiTextAlign::Center,
                     UiTextVAlign::Middle);
        menuRects_[i] = MakeRect(rect.X, rect.Y, rect.Width, rect.Height);
        AddHotspot(HotspotKind::OpenMenu, menuRects_[i], i, true);
        cursorX += width + S(2.0f);
    }

    const float helpSize = S(31.0f);
    const float helpX = static_cast<float>(clientWidth_) - S(14.0f) - helpSize;
    const UiRect helpRect(helpX, top + (height - helpSize) * 0.5f, helpSize, helpSize);
    const bool helpHover = HotspotHovered(HotspotKind::Command, CmdHelp);
    if (helpHover) painter.FillRoundRect(helpRect, S(8.0f), UiColor(255, 29, 38, 54));
    DrawIcon(painter.Graphics(), Icon::Info,
             UiRect(helpRect.X + S(7.0f), helpRect.Y + S(7.0f), S(17.0f), S(17.0f)),
             helpHover ? Theme::kText : Theme::kTextSecondary);
    AddHotspot(HotspotKind::Command, MakeRect(helpRect.X, helpRect.Y, helpRect.Width, helpRect.Height), CmdHelp,
               true, T(Str::TipAbout));

    const bool chinese = I18n::IsChinese();
    const std::wstring languageText = T(chinese ? Str::LanguageChinese : Str::LanguageEnglish);
    const float langWidth = painter.MeasureText(languageText, S(9.8f)) + S(20.0f);
    const UiRect langRect(helpX - S(10.0f) - langWidth, top + (height - S(24.0f)) * 0.5f, langWidth, S(24.0f));
    const bool langHover = HotspotHovered(HotspotKind::Command, chinese ? CmdLanguageEnglish : CmdLanguageChinese);
    painter.FillRoundRect(langRect, S(8.0f), langHover ? UiColor(255, 31, 41, 58) : UiColor(255, 22, 29, 42));
    painter.StrokeRoundRect(langRect, S(8.0f), UiColor(255, 42, 53, 72), S(1.0f));
    painter.Text(languageText, langRect, S(9.8f), UiColor(255, 157, 173, 198), UiTextAlign::Center,
                 UiTextVAlign::Middle);
    AddHotspot(HotspotKind::Command, MakeRect(langRect.X, langRect.Y, langRect.Width, langRect.Height),
               chinese ? CmdLanguageEnglish : CmdLanguageChinese, true, T(Str::TipLanguage));
}

void MainWindow::PaintToolbar(Painter& painter) {
    const auto S = [&](float dip) { return dip * scale_; };
    const float top = static_cast<float>(toolbarRect_.top);
    const float height = static_cast<float>(toolbarRect_.bottom - toolbarRect_.top);
    painter.FillRect(RectOf(toolbarRect_), UiColor(178, 10, 14, 21));
    painter.Divider(0.0f, static_cast<float>(clientWidth_), static_cast<float>(toolbarRect_.bottom) - 1.0f,
                    UiColor(255, 28, 37, 52));

    const float buttonSize = S(36.0f);
    float x = S(12.0f);
    const float buttonY = top + (height - buttonSize) * 0.5f;

    auto iconButton = [&](Icon icon, int command, const std::wstring& tooltip, bool active, bool enabled,
                          const UiColor& accent = Theme::kAccent) {
        const UiRect rect(x, buttonY, buttonSize, buttonSize);
        PaintToolButton(painter, rect, icon, L"", command, tooltip, active, enabled, accent);
        x += buttonSize + S(4.0f);
    };
    auto separator = [&]() {
        painter.VerticalDivider(x + S(5.0f), top + S(13.0f), top + height - S(13.0f), UiColor(255, 34, 44, 60));
        x += S(13.0f);
    };

    const bool loaded = static_cast<bool>(structure_);
    const bool hasCell = structure_ && structure_->cell.valid;
    iconButton(Icon::Open, CmdOpen, T(Str::TipOpen), false, true);
    iconButton(Icon::Reload, CmdReload, T(Str::TipReload), false, !currentPath_.empty());
    iconButton(Icon::Camera, CmdScreenshot, T(Str::TipScreenshot), false, loaded);
    separator();
    iconButton(Icon::Reset, CmdResetView, T(Str::TipReset), false, loaded);
    iconButton(Icon::Fit, CmdFitView, T(Str::TipFit), false, loaded);
    iconButton(Icon::Cube, viewport_.Orthographic() ? CmdPerspective : CmdOrthographic, T(Str::TipProjection),
               false, loaded);
    separator();
    iconButton(Icon::Cell, CmdToggleCell, T(Str::TipCell), options_.showCell && hasCell, hasCell);
    iconButton(Icon::Bond, CmdToggleBonds, T(Str::TipBonds), options_.showBonds, loaded);
    iconButton(Icon::Label, CmdToggleLabels, T(Str::TipLabels), options_.showLabels, loaded);
    separator();

    const MeasureMode mode = viewport_.Mode();
    const float labelSize = S(10.5f);
    auto measurementButton = [&](Icon icon, int command, Str labelId, const std::wstring& tooltip, bool active,
                                 const UiColor& accent) {
        const std::wstring label = T(labelId);
        const float width = std::max(buttonSize, painter.MeasureText(label, labelSize) + S(42.0f));
        const UiRect rect(x, buttonY, width, buttonSize);
        PaintToolButton(painter, rect, icon, label, command, tooltip, active, loaded, accent);
        x += width + S(4.0f);
    };
    measurementButton(Icon::Ruler, CmdMeasureDistance, Str::MeasureDistance, T(Str::TipDistance),
                      mode == MeasureMode::Distance, Theme::kGold);
    measurementButton(Icon::Angle, CmdMeasureAngle, Str::MeasureAngle, T(Str::TipAngle),
                      mode == MeasureMode::Angle, Theme::kCyan);
    iconButton(Icon::Trash, CmdClearMeasurements, T(Str::TipClearMeasure), false,
               structure_ && !viewport_.Measurements().empty());

    const float rightSize = buttonSize;
    const float rightStart = static_cast<float>(clientWidth_) - S(12.0f) - rightSize * 2.0f - S(4.0f);
    if (rightStart > x + S(20.0f)) {
        painter.VerticalDivider(rightStart - S(8.0f), top + S(13.0f), top + height - S(13.0f),
                                UiColor(255, 34, 44, 60));
    }
    float rx = rightStart;
    auto rightButton = [&](Icon icon, int command, const std::wstring& tooltip, bool active) {
        const UiRect rect(rx, buttonY, rightSize, rightSize);
        PaintToolButton(painter, rect, icon, L"", command, tooltip, active, true, Theme::kAccent);
        rx += rightSize + S(4.0f);
    };
    rightButton(Icon::PanelLeft, CmdToggleLeftPanel, T(Str::TipLeftPanel), leftVisible_);
    rightButton(Icon::PanelRight, CmdToggleRightPanel, T(Str::TipRightPanel), rightVisible_);
}

void MainWindow::PaintLeftPanel(Painter& painter) {
    if (!leftVisible_) return;
    const auto S = [&](float dip) { return dip * scale_; };
    const UiRect panel = RectOf(leftPanelRect_);
    painter.Shadow(panel, S(13.0f), UiColor(5, 0, 0, 0), S(4.0f));
    painter.FillRoundRectGradient(panel, S(13.0f), UiColor(255, 19, 26, 38), UiColor(255, 14, 19, 29));
    painter.StrokeRoundRect(panel, S(13.0f), UiColor(255, 37, 48, 65), S(1.0f));

    RECT inner = leftPanelRect_;
    inner.left += static_cast<LONG>(std::lround(S(16.0f)));
    inner.top += static_cast<LONG>(std::lround(S(14.0f)));
    inner.right -= static_cast<LONG>(std::lround(S(16.0f)));
    inner.bottom -= static_cast<LONG>(std::lround(S(14.0f)));
    leftPanelInner_ = inner;
    const float innerH = static_cast<float>(inner.bottom - inner.top);
    if (leftContentHeight_ > innerH) {
        leftScroll_ = std::clamp(leftScroll_, 0.0f, leftContentHeight_ - innerH);
    } else {
        leftScroll_ = 0.0f;
    }

    const float contentX = static_cast<float>(inner.left);
    const float contentW = static_cast<float>(inner.right - inner.left) - S(6.0f);
    Gdiplus::GraphicsState state = painter.Graphics().Save();
    painter.Graphics().SetClip(RectOf(inner));
    float y = static_cast<float>(inner.top) - leftScroll_;

    auto addHotspotVisible = [&](HotspotKind kind, const RECT& rect, int value, bool enabled,
                                 const std::wstring& tooltip = L"") {
        RECT clipped{};
        if (IntersectRect(&clipped, &rect, &inner) && clipped.right > clipped.left && clipped.bottom > clipped.top) {
            hotspots_.push_back({kind, clipped, value, enabled, tooltip});
        }
    };

    if (!structure_) {
        PaintSectionLabel(painter, contentX, y + S(12.0f), T(Str::StructureSection));
        y += S(28.0f);
        const float cardH = S(196.0f);
        painter.FillRoundRect(UiRect(contentX, y, contentW, cardH), S(11.0f), UiColor(255, 15, 21, 31));
        painter.StrokeRoundRect(UiRect(contentX, y, contentW, cardH), S(11.0f), UiColor(255, 34, 45, 62), S(1.0f));
        DrawLogo(painter.Graphics(), UiRect(contentX + (contentW - S(48.0f)) * 0.5f, y + S(24.0f), S(48.0f), S(48.0f)),
                 true);
        painter.Text(T(Str::NoStructureHint),
                     UiRect(contentX + S(18.0f), y + S(84.0f), contentW - S(36.0f), S(44.0f)), S(11.0f),
                     UiColor(255, 145, 159, 182), UiTextAlign::Center, UiTextVAlign::Top, false, false, true);
        const std::wstring openText = T(Str::OpenButton);
        const float openW = std::max(S(138.0f), painter.MeasureText(openText, S(10.5f), true) + S(34.0f));
        const UiRect openRect(contentX + (contentW - openW) * 0.5f, y + S(142.0f), openW, S(34.0f));
        const bool openHover = HotspotHovered(HotspotKind::Command, CmdOpen);
        painter.FillRoundRect(openRect, S(8.0f), openHover ? Theme::kAccentLight : Theme::kAccent);
        painter.Text(openText, openRect, S(10.5f), UiColor(255, 255, 255, 255), UiTextAlign::Center,
                     UiTextVAlign::Middle, true);
        addHotspotVisible(HotspotKind::Command,
                          MakeRect(openRect.X, openRect.Y, openRect.Width, openRect.Height), CmdOpen, true);
        y += cardH + S(12.0f);
        leftContentHeight_ = y + leftScroll_ - inner.top;
        painter.Graphics().Restore(state);
        return;
    }

    const Structure& s = *structure_;
    const bool hasCell = s.cell.valid;
    const bool loaded = true;

    PaintSectionLabel(painter, contentX, y + S(12.0f), T(Str::StructureSection));
    y += S(27.0f);
    std::wstring title = Utf8ToWide(s.title);
    if (title.empty()) title = T(Str::AppName);
    painter.Text(title, UiRect(contentX, y, contentW, S(26.0f)), S(14.5f), Theme::kText, UiTextAlign::Left,
                 UiTextVAlign::Top, true, false, false, true);
    y += S(33.0f);
    const std::wstring formula = FormatFormulaText(s);
    painter.Text(formula, UiRect(contentX, y, contentW, S(18.0f)), S(10.5f), Theme::kAccentLight,
                 UiTextAlign::Left, UiTextVAlign::Middle);
    y += S(24.0f);

    float badgeX = contentX;
    auto drawBadge = [&](const std::wstring& text, const UiColor& color) {
        const float width = painter.MeasureText(text, S(8.2f), true) + S(16.0f);
        const UiRect badge(badgeX, y, width, S(19.0f));
        painter.FillRoundRect(badge, S(8.0f), UiColor(34, color.GetR(), color.GetG(), color.GetB()));
        painter.StrokeRoundRect(badge, S(8.0f), UiColor(80, color.GetR(), color.GetG(), color.GetB()), S(0.8f));
        painter.Text(text, badge, S(8.2f), color, UiTextAlign::Center, UiTextVAlign::Middle, true);
        badgeX += width + S(6.0f);
    };
    drawBadge(FormatDisplayName(s.format), Theme::kCyan);
    drawBadge(T(hasCell ? Str::PeriodicChip : Str::MoleculeChip), hasCell ? Theme::kTeal : Theme::kTextSecondary);
    y += S(30.0f);
    painter.Divider(contentX, contentX + contentW, y, UiColor(255, 32, 42, 58));
    y += S(12.0f);

    PaintSectionLabel(painter, contentX, y + S(11.0f), T(Str::CellParameters));
    if (hasCell) {
        const float linkW = painter.MeasureText(T(Str::EditCellButton), S(8.8f)) + S(14.0f);
        const UiRect link(contentX + contentW - linkW, y + S(4.0f), linkW, S(20.0f));
        const bool hover = HotspotHovered(HotspotKind::Command, CmdEditCell);
        painter.Text(T(Str::EditCellButton), link, S(8.8f), hover ? Theme::kAccentLight : Theme::kTextMuted,
                     UiTextAlign::Right, UiTextVAlign::Middle);
        addHotspotVisible(HotspotKind::Command, MakeRect(link.X, link.Y, link.Width, link.Height), CmdEditCell,
                          true);

        const std::wstring supercell = std::wstring(T(Str::SupercellLink)) + L"  " +
                                       std::to_wstring(options_.supercellX) +
                                       L"×" + std::to_wstring(options_.supercellY) + L"×" +
                                       std::to_wstring(options_.supercellZ);
        const float superW = painter.MeasureText(supercell, S(8.4f)) + S(12.0f);
        if (link.X - superW > contentX + S(40.0f)) {
            const UiRect superLink(link.X - superW - S(4.0f), y + S(4.0f), superW, S(20.0f));
            const bool superHover = HotspotHovered(HotspotKind::Command, CmdSupercell);
            painter.Text(supercell, superLink, S(8.4f),
                         superHover ? Theme::kAccentLight : UiColor(255, 122, 139, 165), UiTextAlign::Right,
                         UiTextVAlign::Middle);
            addHotspotVisible(HotspotKind::Command,
                              MakeRect(superLink.X, superLink.Y, superLink.Width, superLink.Height), CmdSupercell,
                              true);
        }
    }
    y += S(26.0f);
    const float cellH = S(92.0f);
    const UiRect cellCard(contentX, y, contentW, cellH);
    painter.FillRoundRect(cellCard, S(9.0f), UiColor(255, 12, 17, 26));
    painter.StrokeRoundRect(cellCard, S(9.0f), UiColor(255, 31, 41, 56), S(0.9f));
    if (hasCell) {
        const float colW = contentW / 3.0f;
        const wchar_t* labels[3] = {L"a", L"b", L"c"};
        const double values[3] = {s.cell.a, s.cell.b, s.cell.c};
        for (int i = 0; i < 3; ++i) {
            const float cx = contentX + S(12.0f) + colW * static_cast<float>(i);
            painter.Text(labels[i], UiRect(cx, y + S(10.0f), colW, S(14.0f)), S(8.5f), Theme::kTextMuted,
                         UiTextAlign::Left, UiTextVAlign::Middle);
            painter.Text(FormatNumber(values[i], 4) + L" Å",
                         UiRect(cx, y + S(25.0f), colW - S(8.0f), S(18.0f)), S(9.4f), Theme::kText,
                         UiTextAlign::Left, UiTextVAlign::Middle, false, true);
        }
        painter.Text(L"α " + FormatNumber(s.cell.alpha, 2) + L"°    β " + FormatNumber(s.cell.beta, 2) +
                         L"°    γ " + FormatNumber(s.cell.gamma, 2) + L"°",
                     UiRect(contentX + S(12.0f), y + S(48.0f), contentW - S(16.0f), S(16.0f)), S(8.8f),
                     UiColor(255, 150, 163, 184), UiTextAlign::Left, UiTextVAlign::Middle, false, true);
        painter.Text(std::wstring(T(Str::Volume)) + L"  " + FormatNumber(s.cell.volume, 2) + L" Å³",
                     UiRect(contentX + S(12.0f), y + S(68.0f), contentW - S(16.0f), S(16.0f)), S(8.8f),
                     UiColor(255, 127, 141, 164), UiTextAlign::Left, UiTextVAlign::Middle);
    } else {
        painter.Text(T(Str::MoleculeChip), UiRect(contentX + S(12.0f), y + S(16.0f), contentW - S(24.0f), S(24.0f)),
                     S(10.0f), Theme::kTextSecondary, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(std::wstring(T(Str::Volume)) + L"  —", UiRect(contentX + S(12.0f), y + S(48.0f), contentW - S(24.0f), S(20.0f)),
                     S(9.0f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);
    }
    y += cellH + S(10.0f);

    struct InfoRow {
        Str label;
        std::wstring value;
    };
    const std::wstring spaceGroup = s.spaceGroup.empty() ? std::wstring(T(Str::None)) : Utf8ToWide(s.spaceGroup);
    const InfoRow infoRows[] = {
        {Str::SpaceGroup, spaceGroup},
        {Str::SymmetryOps, std::to_wstring(s.symmetryOps.empty() ? 1 : s.symmetryOps.size())},
        {Str::AsymAtoms, std::to_wstring(s.asymmetricAtoms.size())},
        {Str::CellContents, Utf8ToWide(s.cellContents)},
    };
    for (const InfoRow& row : infoRows) {
        painter.Text(T(row.label), UiRect(contentX, y, contentW * 0.46f, S(21.0f)), S(9.6f), Theme::kTextMuted,
                     UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(EllipsizeText(painter, row.value, S(9.6f), contentW * 0.54f),
                     UiRect(contentX + contentW * 0.46f, y, contentW * 0.54f, S(21.0f)), S(9.6f),
                     UiColor(255, 182, 195, 214), UiTextAlign::Right, UiTextVAlign::Middle, false, true);
        y += S(21.0f);
    }
    y += S(6.0f);
    painter.Divider(contentX, contentX + contentW, y, UiColor(255, 32, 42, 58));
    y += S(12.0f);

    PaintSectionLabel(painter, contentX, y + S(11.0f), T(Str::DisplaySection));
    y += S(26.0f);
    const float toggleH = S(28.0f);
    const float toggleGap = S(8.0f);
    const float toggleW = (contentW - toggleGap) * 0.5f;
    auto toggleAt = [&](float x, float rowY, Str label, int command, bool* value, bool enabled) {
        const bool hover = enabled && HotspotHovered(HotspotKind::Command, command);
        if (hover) {
            painter.FillRoundRect(UiRect(x - S(4.0f), rowY + S(1.0f), toggleW + S(8.0f), toggleH - S(2.0f)),
                                  S(6.0f), UiColor(255, 27, 36, 51));
        }
        painter.Text(T(label), UiRect(x, rowY, toggleW - S(40.0f), toggleH), S(9.2f),
                     enabled ? UiColor(255, 192, 203, 220) : UiColor(255, 86, 99, 119), UiTextAlign::Left,
                     UiTextVAlign::Middle);
        PaintSwitch(painter, x + toggleW, rowY + toggleH * 0.5f, *value, enabled);
        if (enabled) addHotspotVisible(HotspotKind::Command, MakeRect(x, rowY, toggleW, toggleH), command, true);
    };
    toggleAt(contentX, y, Str::DisplayCell, CmdToggleCell, &options_.showCell, hasCell);
    toggleAt(contentX + toggleW + toggleGap, y, Str::DisplayBonds, CmdToggleBonds, &options_.showBonds, loaded);
    y += toggleH;
    toggleAt(contentX, y, Str::DisplayLabels, CmdToggleLabels, &options_.showLabels, loaded);
    toggleAt(contentX + toggleW + toggleGap, y, Str::DisplayImages, CmdToggleImages, &options_.showImages,
             loaded && hasCell);
    y += toggleH;
    toggleAt(contentX, y, Str::DisplayAxes, CmdToggleAxes, &options_.showAxes, loaded);
    y += toggleH;
    y += S(4.0f);
    painter.Divider(contentX, contentX + contentW, y, UiColor(255, 32, 42, 58));
    y += S(12.0f);

    PaintSectionLabel(painter, contentX, y + S(11.0f), T(Str::AppearanceSection));
    {
        const float settingsW = painter.MeasureText(T(Str::AppearanceButton), S(8.6f)) + S(12.0f);
        const UiRect settingsLink(contentX + contentW - settingsW, y + S(4.0f), settingsW, S(20.0f));
        const bool hover = HotspotHovered(HotspotKind::Command, CmdAppearance);
        painter.Text(T(Str::AppearanceButton), settingsLink, S(8.6f),
                     hover ? Theme::kAccentLight : Theme::kTextMuted, UiTextAlign::Right, UiTextVAlign::Middle);
        addHotspotVisible(HotspotKind::Command,
                          MakeRect(settingsLink.X, settingsLink.Y, settingsLink.Width, settingsLink.Height),
                          CmdAppearance, true);
    }
    y += S(26.0f);
    const float segH = S(32.0f);
    const UiRect segRect(contentX, y, contentW, segH);
    painter.FillRoundRect(segRect, S(8.0f), UiColor(255, 11, 16, 24));
    painter.StrokeRoundRect(segRect, S(8.0f), UiColor(255, 33, 43, 59), S(0.9f));
    const float segW = contentW / 3.0f;
    const bool ball = options_.style == AtomStyle::BallAndStick;
    const bool poly = options_.style == AtomStyle::Polyhedral;
    auto styleSegment = [&](bool active, float segX, const std::wstring& label, int command) {
        const UiRect seg(segX + S(2.0f), y + S(2.0f), segW - S(4.0f), segH - S(4.0f));
        if (active) {
            painter.FillRoundRect(seg, S(6.0f), UiColor(255, 31, 44, 67));
            painter.StrokeRoundRect(seg, S(6.0f), UiColor(255, 69, 96, 139), S(0.8f));
        }
        painter.Text(label, seg, S(8.8f), active ? Theme::kText : Theme::kTextMuted, UiTextAlign::Center,
                     UiTextVAlign::Middle, active);
        addHotspotVisible(HotspotKind::Command, MakeRect(seg.X, seg.Y, seg.Width, seg.Height), command, true);
    };
    styleSegment(ball, contentX, T(Str::BallAndStick), CmdBallStick);
    styleSegment(!ball && !poly, contentX + segW, T(Str::SpaceFill), CmdSpaceFill);
    styleSegment(poly, contentX + segW * 2.0f, T(Str::StylePolyhedral), CmdPolyhedral);
    y += segH + S(12.0f);

    painter.Text(T(Str::AtomSize), UiRect(contentX, y, contentW * 0.7f, S(16.0f)), S(9.6f), Theme::kTextMuted,
                 UiTextAlign::Left, UiTextVAlign::Middle);
    painter.Text(FormatPercent(options_.atomScale), UiRect(contentX + contentW * 0.7f, y, contentW * 0.3f, S(16.0f)),
                 S(9.4f), Theme::kTextSecondary, UiTextAlign::Right, UiTextVAlign::Middle, false, true);
    y += S(18.0f);
    const float trackY = y + S(6.0f);
    painter.FillRoundRect(UiRect(contentX, trackY, contentW, S(4.0f)), S(2.0f), UiColor(255, 34, 45, 62));
    const float t = (options_.atomScale - 0.15f) / 0.65f;
    painter.FillRoundRect(UiRect(contentX, trackY, contentW * t, S(4.0f)), S(2.0f), Theme::kAccent);
    painter.FillRoundRect(UiRect(contentX + contentW * t - S(6.0f), trackY - S(4.0f), S(12.0f), S(12.0f)),
                          S(6.0f), UiColor(255, 222, 231, 245));
    atomSliderTrack_ = MakeRect(contentX, trackY - S(9.0f), contentW, S(26.0f));
    if (options_.style != AtomStyle::SpaceFill) {
        addHotspotVisible(HotspotKind::Slider, atomSliderTrack_, 0, true);
    }
    y += S(30.0f);
    painter.Divider(contentX, contentX + contentW, y, UiColor(255, 32, 42, 58));
    y += S(12.0f);

    PaintSectionLabel(painter, contentX, y + S(11.0f), T(Str::ElementLegend));
    y += S(26.0f);
    std::vector<std::pair<int, int>> counts;
    for (const auto& [z, count] : s.elementCounts) counts.emplace_back(z, count);
    std::sort(counts.begin(), counts.end(), [](const auto& a, const auto& b) {
        if (a.second != b.second) return a.second > b.second;
        return a.first < b.first;
    });
    float chipX = contentX;
    float chipY = y;
    const float chipH = S(23.0f);
    int drawn = 0;
    for (const auto& [z, count] : counts) {
        if (drawn >= 14) break;
        const Element& element = ElementByZ(z);
        const std::wstring text = Utf8ToWide(element.symbol) + L" " + std::to_wstring(count);
        const float chipW = painter.MeasureText(text, S(8.8f), true) + S(25.0f);
        if (chipX + chipW > contentX + contentW && chipX > contentX) {
            chipX = contentX;
            chipY += chipH + S(5.0f);
        }
        const UiRect chip(chipX, chipY, chipW, chipH);
        painter.FillRoundRect(chip, S(6.0f), UiColor(255, 20, 27, 39));
        painter.StrokeRoundRect(chip, S(6.0f), UiColor(255, 32, 42, 57), S(0.7f));
        painter.FillRoundRect(UiRect(chipX + S(7.0f), chipY + chipH * 0.5f - S(3.0f), S(6.0f), S(6.0f)),
                              S(3.0f), UiColor(255, static_cast<BYTE>((element.color >> 16) & 0xFF),
                                               static_cast<BYTE>((element.color >> 8) & 0xFF),
                                               static_cast<BYTE>(element.color & 0xFF)));
        painter.Text(text, UiRect(chipX + S(17.0f), chipY, chipW - S(20.0f), chipH), S(8.8f),
                     UiColor(255, 186, 199, 217), UiTextAlign::Left, UiTextVAlign::Middle, true);
        chipX += chipW + S(5.0f);
        ++drawn;
    }
    y = chipY + chipH + S(8.0f);

    if (counts.size() > 14) {
        painter.Text(Fmt(T(Str::MoreElementsFmt), static_cast<int>(counts.size()) - 14),
                     UiRect(contentX, y, contentW, S(18.0f)), S(8.6f), Theme::kTextMuted, UiTextAlign::Left,
                     UiTextVAlign::Middle);
        y += S(18.0f);
    }

    const float contentHeight = y + leftScroll_ - static_cast<float>(inner.top) + S(8.0f);
    leftContentHeight_ = contentHeight;
    painter.Graphics().Restore(state);

    if (leftContentHeight_ > innerH) {
        const float trackX = static_cast<float>(leftPanelRect_.right) - S(8.0f);
        const float trackY = static_cast<float>(inner.top);
        painter.FillRoundRect(UiRect(trackX, trackY, S(3.0f), innerH), S(1.5f), UiColor(255, 27, 35, 48));
        const float thumbH = std::max(S(28.0f), innerH * innerH / leftContentHeight_);
        const float maxScroll = leftContentHeight_ - innerH;
        const float thumbY = trackY + (innerH - thumbH) * (leftScroll_ / std::max(1.0f, maxScroll));
        painter.FillRoundRect(UiRect(trackX, thumbY, S(3.0f), thumbH), S(1.5f), UiColor(255, 68, 87, 116));
    }
}

void MainWindow::PaintRightPanel(Painter& painter) {
    if (!rightVisible_) return;
    const auto S = [&](float dip) { return dip * scale_; };
    const UiRect panel = RectOf(rightPanelRect_);
    painter.Shadow(panel, S(13.0f), UiColor(5, 0, 0, 0), S(4.0f));
    painter.FillRoundRectGradient(panel, S(13.0f), UiColor(255, 19, 26, 38), UiColor(255, 14, 19, 29));
    painter.StrokeRoundRect(panel, S(13.0f), UiColor(255, 37, 48, 65), S(1.0f));

    RECT inner = rightPanelRect_;
    inner.left += static_cast<LONG>(std::lround(S(16.0f)));
    inner.top += static_cast<LONG>(std::lround(S(14.0f)));
    inner.right -= static_cast<LONG>(std::lround(S(16.0f)));
    inner.bottom -= static_cast<LONG>(std::lround(S(14.0f)));
    rightPanelInner_ = inner;
    const float innerH = static_cast<float>(inner.bottom - inner.top);
    if (rightContentHeight_ > innerH) {
        rightScroll_ = std::clamp(rightScroll_, 0.0f, rightContentHeight_ - innerH);
    } else {
        rightScroll_ = 0.0f;
    }

    const float contentX = static_cast<float>(inner.left);
    const float contentW = static_cast<float>(inner.right - inner.left) - S(6.0f);
    Gdiplus::GraphicsState state = painter.Graphics().Save();
    painter.Graphics().SetClip(RectOf(inner));
    float y = static_cast<float>(inner.top) - rightScroll_;

    auto addHotspotVisible = [&](HotspotKind kind, const RECT& rect, int value, bool enabled,
                                 const std::wstring& tooltip = L"") {
        RECT clipped{};
        if (IntersectRect(&clipped, &rect, &inner) && clipped.right > clipped.left && clipped.bottom > clipped.top) {
            hotspots_.push_back({kind, clipped, value, enabled, tooltip});
        }
    };

    PaintSectionLabel(painter, contentX, y + S(12.0f), T(Str::SelectionSection));
    y += S(27.0f);

    const bool hasStructure = static_cast<bool>(structure_);
    const bool hasSelection = hasStructure && selectedAtom_ >= 0 &&
                              selectedAtom_ < static_cast<int>(structure_->atoms.size());
    if (!hasStructure) {
        const UiRect card(contentX, y, contentW, S(58.0f));
        painter.FillRoundRect(card, S(9.0f), UiColor(255, 13, 18, 27));
        painter.StrokeRoundRect(card, S(9.0f), UiColor(255, 31, 41, 56), S(0.9f));
        painter.Text(T(Str::SelectHint), UiRect(card.X + S(12.0f), card.Y, card.Width - S(24.0f), card.Height),
                     S(9.8f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle, false, false, true);
        y += card.Height + S(10.0f);
    } else if (!hasSelection) {
        const UiRect card(contentX, y, contentW, S(58.0f));
        painter.FillRoundRect(card, S(9.0f), UiColor(255, 13, 18, 27));
        painter.StrokeRoundRect(card, S(9.0f), UiColor(255, 31, 41, 56), S(0.9f));
        painter.Text(T(Str::NoAtomSelected), UiRect(card.X + S(12.0f), card.Y + S(10.0f), card.Width - S(24.0f), S(16.0f)),
                     S(10.2f), Theme::kTextSecondary, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(T(Str::SelectHint), UiRect(card.X + S(12.0f), card.Y + S(28.0f), card.Width - S(24.0f), S(18.0f)),
                     S(8.8f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle, false, false, true);
        y += card.Height + S(10.0f);
    } else {
        const Atom& atom = structure_->atoms[static_cast<size_t>(selectedAtom_)];
        const Element& element = ElementByZ(atom.atomicNumber);
        const float cardH = S(190.0f);
        const UiRect card(contentX, y, contentW, cardH);
        painter.FillRoundRect(card, S(9.0f), UiColor(255, 13, 18, 27));
        painter.StrokeRoundRect(card, S(9.0f), UiColor(255, 33, 43, 59), S(0.9f));
        const UiColor elementColor(255, static_cast<BYTE>((element.color >> 16) & 0xFF),
                                   static_cast<BYTE>((element.color >> 8) & 0xFF),
                                   static_cast<BYTE>(element.color & 0xFF));
        painter.FillRoundRect(UiRect(contentX + S(12.0f), y + S(12.0f), S(34.0f), S(34.0f)), S(17.0f),
                              UiColor(210, elementColor.GetR(), elementColor.GetG(), elementColor.GetB()));
        painter.Text(Utf8ToWide(element.symbol),
                     UiRect(contentX + S(12.0f), y + S(12.0f), S(34.0f), S(34.0f)), S(12.5f),
                     UiColor(255, 20, 24, 30), UiTextAlign::Center, UiTextVAlign::Middle, true);
        painter.Text(Utf8ToWide(atom.label), UiRect(contentX + S(55.0f), y + S(13.0f), contentW - S(66.0f), S(22.0f)),
                     S(12.5f), Theme::kText, UiTextAlign::Left, UiTextVAlign::Middle, true);
        const std::wstring sub = ElementSymbolText(atom.atomicNumber) + L"   ·   Z=" +
                                 std::to_wstring(atom.atomicNumber) + L"   ·   " + T(Str::SiteField) +
                                 L" " + std::to_wstring(atom.siteIndex + 1);
        painter.Text(sub, UiRect(contentX + S(55.0f), y + S(34.0f), contentW - S(66.0f), S(15.0f)), S(8.5f),
                     Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);

        painter.Text(T(Str::FractionalCoords), UiRect(contentX + S(12.0f), y + S(57.0f), contentW - S(24.0f), S(14.0f)),
                     S(8.2f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(CoordinateText(atom.frac, 4),
                     UiRect(contentX + S(12.0f), y + S(70.0f), contentW - S(24.0f), S(16.0f)), S(8.7f),
                     UiColor(255, 170, 184, 205), UiTextAlign::Left, UiTextVAlign::Middle, false, true);
        painter.Text(T(Str::CartesianCoords), UiRect(contentX + S(12.0f), y + S(88.0f), contentW - S(24.0f), S(14.0f)),
                     S(8.2f), Theme::kTextMuted, UiTextAlign::Left, UiTextVAlign::Middle);
        painter.Text(CoordinateText(atom.cart, 3),
                     UiRect(contentX + S(12.0f), y + S(101.0f), contentW - S(24.0f), S(16.0f)), S(8.7f),
                     UiColor(255, 170, 184, 205), UiTextAlign::Left, UiTextVAlign::Middle, false, true);
        std::wstring meta = std::wstring(T(Str::OccupancyField)) + L"  " + FormatNumber(atom.occupancy, 2);
        if (atom.hasUiso) meta += L"      Uiso  " + FormatNumber(atom.uiso, 4);
        if (atom.symmetryGenerated)
            meta += L"      " + std::wstring(T(Str::SymmetryCopyField)) + L" #" +
                    std::to_wstring(atom.symmetryIndex + 1);
        painter.Text(meta, UiRect(contentX + S(12.0f), y + S(124.0f), contentW - S(24.0f), S(16.0f)), S(8.5f),
                     UiColor(255, 137, 151, 172), UiTextAlign::Left, UiTextVAlign::Middle, false, true);
        const float actionGap = S(8.0f);
        const float actionW = (contentW - S(24.0f) - actionGap) * 0.5f;
        auto atomAction = [&](float bx, int command, Str label, bool danger) {
            const UiRect rect(contentX + S(12.0f) + bx, y + S(148.0f), actionW, S(30.0f));
            const bool hover = HotspotHovered(HotspotKind::Command, command);
            const UiColor accent = danger ? Theme::kRed : Theme::kAccentLight;
            painter.FillRoundRect(rect, S(7.0f),
                                  hover ? UiColor(38, accent.GetR(), accent.GetG(), accent.GetB())
                                        : UiColor(255, 18, 24, 35));
            painter.StrokeRoundRect(rect, S(7.0f), UiColor(70, accent.GetR(), accent.GetG(), accent.GetB()),
                                    S(0.9f));
            painter.Text(T(label), rect, S(9.2f),
                         hover ? accent : UiColor(255, 175, 188, 208), UiTextAlign::Center,
                         UiTextVAlign::Middle, true);
            addHotspotVisible(HotspotKind::Command, MakeRect(rect.X, rect.Y, rect.Width, rect.Height),
                              command, true);
        };
        atomAction(0.0f, CmdEditAtom, Str::EditAtomButton, false);
        atomAction(actionW + actionGap, CmdDeleteAtom, Str::DeleteAtomButton, true);
        y += cardH + S(10.0f);
    }

    painter.Divider(contentX, contentX + contentW, y, UiColor(255, 32, 42, 58));
    y += S(12.0f);

    PaintSectionLabel(painter, contentX, y + S(11.0f), T(Str::MeasurementsSection));
    const auto& measurements = viewport_.Measurements();
    const float clearSize = S(8.8f);
    const float clearW = painter.MeasureText(T(Str::MeasurementClearAll), clearSize) + S(6.0f);
    if (hasStructure && !measurements.empty()) {
        const UiRect clearRect(contentX + contentW - clearW, y + S(2.0f), clearW, S(18.0f));
        const bool clearHover = HotspotHovered(HotspotKind::Command, CmdClearMeasurements);
        painter.Text(T(Str::MeasurementClearAll), clearRect, clearSize,
                     clearHover ? Theme::kRed : Theme::kTextMuted, UiTextAlign::Right, UiTextVAlign::Middle);
        addHotspotVisible(HotspotKind::Command, MakeRect(clearRect.X, clearRect.Y, clearRect.Width, clearRect.Height),
                          CmdClearMeasurements, true);
    }
    y += S(26.0f);

    const MeasureMode mode = viewport_.Mode();
    const float buttonGap = S(6.0f);
    const float modeW = (contentW - buttonGap) * 0.5f;
    auto modeButton = [&](bool active, float bx, Icon icon, Str label, int command, const UiColor& accent) {
        const UiRect rect(bx, y, modeW, S(34.0f));
        const bool hover = hasStructure && HotspotHovered(HotspotKind::Command, command);
        const UiColor fill = active ? UiColor(38, accent.GetR(), accent.GetG(), accent.GetB())
                              : hover ? UiColor(255, 27, 36, 51)
                                      : UiColor(255, 14, 20, 29);
        painter.FillRoundRect(rect, S(8.0f), fill);
        painter.StrokeRoundRect(rect, S(8.0f),
                                active ? UiColor(95, accent.GetR(), accent.GetG(), accent.GetB())
                                       : UiColor(255, 34, 45, 61),
                                S(0.9f));
        DrawIcon(painter.Graphics(), icon,
                 UiRect(rect.X + S(10.0f), rect.Y + S(9.0f), S(15.0f), S(15.0f)),
                 active ? accent : (hasStructure ? Theme::kTextSecondary : Theme::kTextFaint));
        painter.Text(T(label), UiRect(rect.X + S(30.0f), rect.Y, rect.Width - S(32.0f), rect.Height), S(9.6f),
                     active ? accent : (hasStructure ? UiColor(255, 178, 191, 210) : Theme::kTextFaint),
                     UiTextAlign::Left, UiTextVAlign::Middle, active);
        if (hasStructure) {
            addHotspotVisible(HotspotKind::Command, MakeRect(rect.X, rect.Y, rect.Width, rect.Height), command, true);
        }
    };
    modeButton(mode == MeasureMode::Distance, contentX, Icon::Ruler, Str::MeasurementDistance, CmdMeasureDistance,
               Theme::kGold);
    modeButton(mode == MeasureMode::Angle, contentX + modeW + buttonGap, Icon::Angle, Str::MeasurementAngle,
               CmdMeasureAngle, Theme::kCyan);
    y += S(40.0f);

    if (mode != MeasureMode::None) {
        const int required = viewport_.RequiredPicks();
        const int picked = viewport_.PendingCount();
        std::wstring hint = picked > 0 ? Fmt(T(Str::SelectedCountFmt), picked, required)
                                        : std::wstring(T(mode == MeasureMode::Distance ? Str::MeasurementPickDistance
                                                                                       : Str::MeasurementPickAngle));
        painter.Text(EllipsizeText(painter, hint, S(8.8f), contentW), UiRect(contentX, y, contentW, S(16.0f)),
                     S(8.8f), mode == MeasureMode::Distance ? Theme::kGold : Theme::kCyan, UiTextAlign::Left,
                     UiTextVAlign::Middle);
        y += S(20.0f);
    }

    if (measurements.empty()) {
        const UiRect empty(contentX, y, contentW, S(70.0f));
        painter.FillRoundRect(empty, S(9.0f), UiColor(255, 12, 17, 26));
        painter.StrokeRoundRect(empty, S(9.0f), UiColor(255, 30, 40, 54), S(0.9f));
        painter.Text(T(Str::MeasureEmpty), UiRect(empty.X + S(10.0f), empty.Y + S(12.0f), empty.Width - S(20.0f), S(18.0f)),
                     S(9.8f), Theme::kTextSecondary, UiTextAlign::Center, UiTextVAlign::Middle);
        painter.Text(T(Str::MeasureEmptyHint), UiRect(empty.X + S(10.0f), empty.Y + S(34.0f), empty.Width - S(20.0f), S(24.0f)),
                     S(8.6f), Theme::kTextMuted, UiTextAlign::Center, UiTextVAlign::Middle, false, false, true);
        y += empty.Height + S(8.0f);
    } else {
        for (size_t i = 0; i < measurements.size(); ++i) {
            const Measurement& m = measurements[i];
            const bool distance = m.kind == MeasurementKind::Distance;
            const UiColor accent = distance ? Theme::kGold : Theme::kCyan;
            const float cardH = S(58.0f);
            const UiRect card(contentX, y, contentW, cardH);
            painter.FillRoundRect(card, S(9.0f), UiColor(255, 13, 19, 28));
            painter.StrokeRoundRect(card, S(9.0f), UiColor(255, 33, 44, 60), S(0.9f));
            painter.FillRoundRect(UiRect(card.X, card.Y + S(9.0f), S(3.0f), S(36.0f)), S(1.5f), accent);
            painter.Text(T(distance ? Str::MeasurementDistance : Str::MeasurementAngle),
                         UiRect(card.X + S(11.0f), card.Y + S(5.0f), S(80.0f), S(15.0f)), S(8.3f), accent,
                         UiTextAlign::Left, UiTextVAlign::Middle, true);
            const UiRect removeRect(card.X + card.Width - S(26.0f), card.Y + S(5.0f), S(20.0f), S(20.0f));
            const bool removeHover = HotspotHovered(HotspotKind::RemoveMeasurement, static_cast<int>(i));
            DrawIcon(painter.Graphics(), Icon::Close,
                     UiRect(removeRect.X + S(5.0f), removeRect.Y + S(5.0f), S(10.0f), S(10.0f)),
                     removeHover ? Theme::kRed : Theme::kTextFaint);
            addHotspotVisible(HotspotKind::RemoveMeasurement,
                              MakeRect(removeRect.X, removeRect.Y, removeRect.Width, removeRect.Height),
                              static_cast<int>(i), true, T(Str::RemoveMeasurement));
            const std::wstring expression = MeasurementExpression(*structure_, m);
            const std::wstring value = MeasurementValueText(m);
            const float valueW = painter.MeasureText(value, S(11.5f), true);
            painter.Text(EllipsizeText(painter, expression, S(9.4f), card.Width - S(24.0f) - valueW - S(12.0f)),
                         UiRect(card.X + S(11.0f), card.Y + S(20.0f), card.Width - S(24.0f) - valueW - S(12.0f),
                                S(26.0f)),
                         S(9.4f), UiColor(255, 169, 183, 203), UiTextAlign::Left, UiTextVAlign::Middle, false, true);
            painter.Text(value, UiRect(card.X, card.Y + S(22.0f), card.Width - S(12.0f), S(22.0f)), S(11.5f),
                         accent, UiTextAlign::Right, UiTextVAlign::Middle, true, true);
            y += cardH + S(8.0f);
        }
    }

    const float contentHeight = y + rightScroll_ - static_cast<float>(inner.top) + S(8.0f);
    rightContentHeight_ = contentHeight;
    painter.Graphics().Restore(state);

    if (rightContentHeight_ > innerH) {
        const float trackX = static_cast<float>(rightPanelRect_.right) - S(8.0f);
        const float trackY = static_cast<float>(inner.top);
        painter.FillRoundRect(UiRect(trackX, trackY, S(3.0f), innerH), S(1.5f), UiColor(255, 27, 35, 48));
        const float thumbH = std::max(S(28.0f), innerH * innerH / rightContentHeight_);
        const float maxScroll = rightContentHeight_ - innerH;
        const float thumbY = trackY + (innerH - thumbH) * (rightScroll_ / std::max(1.0f, maxScroll));
        painter.FillRoundRect(UiRect(trackX, thumbY, S(3.0f), thumbH), S(1.5f), UiColor(255, 68, 87, 116));
    }
}

void MainWindow::PaintStatusBar(Painter& painter) {
    const auto S = [&](float dip) { return dip * scale_; };
    painter.FillRect(RectOf(statusRect_), UiColor(255, 8, 12, 18));
    painter.Divider(0.0f, static_cast<float>(clientWidth_), static_cast<float>(statusRect_.top) + 0.5f,
                    UiColor(255, 25, 33, 46));
    const float centerY = statusRect_.top + (statusRect_.bottom - statusRect_.top) * 0.5f;
    const bool good = viewport_.RendererReady();
    painter.FillRoundRect(UiRect(S(16.0f), centerY - S(3.0f), S(6.0f), S(6.0f)), S(3.0f),
                          good ? Theme::kTeal : Theme::kGold);
    std::wstring status = hoveredAtom_ >= 0 ? HoverStatusText() : statusMessage_;
    if (status.empty()) status = T(Str::Ready);
    const float statusSize = S(9.5f);
    painter.Text(status, UiRect(S(29.0f), static_cast<float>(statusRect_.top), clientWidth_ * 0.56f,
                                static_cast<float>(statusRect_.bottom - statusRect_.top)),
                 statusSize, UiColor(255, 141, 156, 178), UiTextAlign::Left, UiTextVAlign::Middle);
    std::wstring renderer = viewport_.RendererDescription();
    if (renderer.empty()) renderer = T(Str::None);
    const float renderSize = S(8.6f);
    const float rightX = static_cast<float>(clientWidth_) - S(14.0f);
    const float maxRightW = clientWidth_ * 0.38f;
    const std::wstring shown = EllipsizeText(painter, renderer, renderSize, maxRightW);
    painter.Text(shown, UiRect(rightX - maxRightW, static_cast<float>(statusRect_.top), maxRightW,
                               static_cast<float>(statusRect_.bottom - statusRect_.top)),
                 renderSize, UiColor(255, 88, 102, 122), UiTextAlign::Right, UiTextVAlign::Middle);
}

void MainWindow::AddHotspot(HotspotKind kind, const RECT& rect, int value, bool enabled,
                            const std::wstring& tooltip) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) return;
    hotspots_.push_back({kind, rect, value, enabled, tooltip});
}

bool MainWindow::HotspotHovered(HotspotKind kind, int value) const {
    return hoveredKind_ == kind && hoveredValue_ == value;
}

int MainWindow::FindHotspot(int x, int y) const {
    for (int i = static_cast<int>(hotspots_.size()) - 1; i >= 0; --i) {
        if (PtInRect(&hotspots_[static_cast<size_t>(i)].rect, POINT{x, y})) return i;
    }
    return -1;
}

void MainWindow::UpdateHover(int x, int y) {
    const int index = FindHotspot(x, y);
    HotspotKind kind = HotspotKind::None;
    int value = 0;
    std::wstring tooltip;
    bool enabled = false;
    if (index >= 0) {
        const Hotspot& hotspot = hotspots_[static_cast<size_t>(index)];
        kind = hotspot.kind;
        value = hotspot.value;
        tooltip = hotspot.tooltip;
        enabled = hotspot.enabled;
    }
    const bool changed = kind != hoveredKind_ || value != hoveredValue_;
    if (changed) {
        hoveredKind_ = kind;
        hoveredValue_ = value;
        HideTooltip();
        KillTimer(hwnd_, kTooltipTimer);
        tooltipPending_ = false;
        if (!tooltip.empty()) {
            pendingTooltipText_ = tooltip;
            SetTimer(hwnd_, kTooltipTimer, kTooltipDelayMs, nullptr);
            tooltipPending_ = true;
        }
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
    bool hand = enabled && kind != HotspotKind::None;
    bool resize = kind == HotspotKind::Slider;
    SetCursor(LoadCursorW(nullptr, resize ? IDC_SIZEWE : (hand ? IDC_HAND : IDC_ARROW)));
}

void MainWindow::HideTooltip() {
    tooltip_.Hide();
    tooltipShown_ = false;
    KillTimer(hwnd_, kTooltipTimer);
    tooltipPending_ = false;
}

void MainWindow::ResetHover() {
    hoveredKind_ = HotspotKind::None;
    hoveredValue_ = 0;
    HideTooltip();
    SetCursor(LoadCursorW(nullptr, IDC_ARROW));
}

void MainWindow::ShowTooltipForHotspot(int index) {
    if (index < 0 || index >= static_cast<int>(hotspots_.size())) return;
    const Hotspot& hotspot = hotspots_[static_cast<size_t>(index)];
    if (hotspot.tooltip.empty()) return;
    POINT pt{};
    GetCursorPos(&pt);
    tooltip_.Show(hotspot.tooltip, pt.x, pt.y, scale_);
    tooltipShown_ = true;
}

void MainWindow::ScrollPanel(bool left, int delta) {
    const auto S = [&](float dip) { return dip * scale_; };
    const float amount = static_cast<float>(delta) / static_cast<float>(WHEEL_DELTA) * S(52.0f);
    if (left) {
        const float visible = static_cast<float>(leftPanelInner_.bottom - leftPanelInner_.top);
        const float maxScroll = std::max(0.0f, leftContentHeight_ - visible);
        leftScroll_ = std::clamp(leftScroll_ - amount, 0.0f, maxScroll);
    } else {
        const float visible = static_cast<float>(rightPanelInner_.bottom - rightPanelInner_.top);
        const float maxScroll = std::max(0.0f, rightContentHeight_ - visible);
        rightScroll_ = std::clamp(rightScroll_ - amount, 0.0f, maxScroll);
    }
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::UpdateSliderFromX(int x) {
    if (atomSliderTrack_.right <= atomSliderTrack_.left) return;
    const float t = std::clamp(static_cast<float>(x - atomSliderTrack_.left) /
                                   static_cast<float>(atomSliderTrack_.right - atomSliderTrack_.left),
                               0.0f, 1.0f);
    options_.atomScale = 0.15f + t * 0.65f;
    viewport_.SetOptions(options_);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::OpenMenu(int menuIndex) {
    if (menuIndex < 0 || menuIndex >= 5) return;
    HideTooltip();
    const RECT rect = menuRects_[menuIndex];
    POINT point{rect.left, rect.bottom + static_cast<LONG>(std::lround(2.0f * scale_))};
    ClientToScreen(hwnd_, &point);
    openMenu_ = menuIndex;
    menu_.Show(BuildMenu(menuIndex), point, scale_);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

std::vector<MenuEntry> MainWindow::BuildMenu(int menuIndex) const {
    std::vector<MenuEntry> entries;
    auto add = [&](const std::wstring& label, const std::wstring& shortcut, int command, bool enabled = true,
                   bool checked = false) {
        MenuEntry entry;
        entry.label = label;
        entry.shortcut = shortcut;
        entry.command = command;
        entry.enabled = enabled;
        entry.checked = checked;
        entries.push_back(std::move(entry));
    };
    const bool loaded = static_cast<bool>(structure_);
    const bool hasCell = structure_ && structure_->cell.valid;
    switch (menuIndex) {
    case 0:
        add(T(Str::OpenFile), L"Ctrl+O", CmdOpen);
        add(T(Str::Library), L"Ctrl+L", CmdLibrary);
        add(T(Str::ReloadFile), L"Ctrl+R", CmdReload, !currentPath_.empty());
        add(T(Str::SaveStructure), L"Ctrl+S", CmdSaveStructure, loaded);
        add(T(Str::SaveScreenshot), L"Ctrl+Shift+S", CmdScreenshot, loaded);
        entries.push_back(MenuEntry::Separator());
        add(T(Str::ExitApp), L"Alt+F4", CmdExit);
        break;
    case 1: {
        add(T(Str::Undo), L"Ctrl+Z", CmdUndo, !undoStack_.empty());
        add(T(Str::Redo), L"Ctrl+Y", CmdRedo, !redoStack_.empty());
        entries.push_back(MenuEntry::Separator());
        add(T(Str::EditCell), L"Ctrl+E", CmdEditCell, hasCell);
        add(T(Str::AddAtom), L"Ctrl+Shift+A", CmdAddAtom, loaded);
        const bool hasSelection = loaded && selectedAtom_ >= 0 &&
                                  selectedAtom_ < static_cast<int>(structure_->atoms.size());
        add(T(Str::EditAtom), L"F2", CmdEditAtom, hasSelection);
        add(T(Str::DeleteAtom), L"Delete", CmdDeleteAtom, hasSelection);
        entries.push_back(MenuEntry::Separator());
        add(T(Str::CopySummary), L"Ctrl+C", CmdCopySummary, loaded);
        add(T(Str::ClearMeasurements), L"", CmdClearMeasurements, loaded && !viewport_.Measurements().empty());
        break;
    }
    case 2:
        add(T(Str::ResetView), L"Home", CmdResetView, loaded);
        add(T(Str::FitView), L"F", CmdFitView, loaded);
        entries.push_back(MenuEntry::Separator());
        add(T(Str::ProjectionPerspective), L"", CmdPerspective, loaded, !viewport_.Orthographic());
        add(T(Str::ProjectionOrthographic), L"", CmdOrthographic, loaded, viewport_.Orthographic());
        entries.push_back(MenuEntry::Separator());
        add(T(Str::ToggleCell), L"C", CmdToggleCell, hasCell, options_.showCell);
        add(T(Str::ToggleBonds), L"B", CmdToggleBonds, loaded, options_.showBonds);
        add(T(Str::ToggleLabels), L"L", CmdToggleLabels, loaded, options_.showLabels);
        add(T(Str::DisplayImages), L"", CmdToggleImages, hasCell, options_.showImages);
        add(T(Str::SupercellMenu), L"", CmdSupercell, hasCell);
        add(T(Str::AppearanceMenu), L"", CmdAppearance);
        add(T(Str::ToggleAxes), L"", CmdToggleAxes, loaded, options_.showAxes);
        entries.push_back(MenuEntry::Separator());
        add(T(Str::ToggleLeftPanel), L"", CmdToggleLeftPanel, true, leftVisible_);
        add(T(Str::ToggleRightPanel), L"", CmdToggleRightPanel, true, rightVisible_);
        entries.push_back(MenuEntry::Separator());
        add(T(I18n::IsChinese() ? Str::LanguageEnglish : Str::LanguageChinese), L"",
            I18n::IsChinese() ? CmdLanguageEnglish : CmdLanguageChinese);
        break;
    case 3:
        add(T(Str::MeasureDistance), L"D", CmdMeasureDistance, loaded, viewport_.Mode() == MeasureMode::Distance);
        add(T(Str::MeasureAngle), L"A", CmdMeasureAngle, loaded, viewport_.Mode() == MeasureMode::Angle);
        entries.push_back(MenuEntry::Separator());
        add(T(Str::CancelMeasurement), L"Esc", CmdCancelMeasure, viewport_.Mode() != MeasureMode::None);
        add(T(Str::ClearMeasurements), L"", CmdClearMeasurements, !viewport_.Measurements().empty());
        break;
    case 4:
        add(T(Str::KeyboardShortcuts), L"F1", CmdHelp);
        add(T(Str::AboutApp), L"", CmdAbout);
        break;
    default:
        break;
    }
    return entries;
}

void MainWindow::ExecuteHotspot(const Hotspot& hotspot) {
    if (!hotspot.enabled) return;
    if (hotspot.kind == HotspotKind::RemoveMeasurement) {
        HideTooltip();
        viewport_.RemoveMeasurement(hotspot.value);
        ResetHover();
        InvalidateRect(hwnd_, nullptr, FALSE);
    } else if (hotspot.kind == HotspotKind::Command) {
        ExecuteCommand(hotspot.value);
    }
}

void MainWindow::ToggleMeasureMode(MeasureMode mode) {
    if (viewport_.Mode() == mode) {
        viewport_.CancelMeasure();
    } else {
        viewport_.SetMeasureMode(mode);
    }
    ResetHover();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::ExecuteCommand(int command) {
    if ((help_.IsVisible() || form_.IsVisible()) && command != CmdHelp) return;
    switch (command) {
    case CmdLibrary:
        for (const auto& path : ChooseLibraryStructures(hwnd_)) OpenDocument(path);
        break;
    case CmdOpen:
        OpenFileDialog();
        break;
    case CmdReload:
        if (!currentPath_.empty() && ConfirmDiscardChanges()) OpenPath(currentPath_);
        break;
    case CmdSaveStructure:
        SaveStructureDialog();
        break;
    case CmdScreenshot:
        SaveScreenshotDialog();
        break;
    case CmdExit:
        PostMessageW(hwnd_, WM_CLOSE, 0, 0);
        break;
    case CmdCopySummary:
        CopySummary();
        break;
    case CmdClearMeasurements:
        viewport_.ClearMeasurements();
        break;
    case CmdUndo:
        Undo();
        break;
    case CmdRedo:
        Redo();
        break;
    case CmdEditCell:
        EditCellDialog();
        break;
    case CmdAddAtom:
        AddAtomDialog();
        break;
    case CmdEditAtom:
        EditSelectedAtomDialog();
        break;
    case CmdDeleteAtom:
        DeleteSelectedAtom();
        break;
    case CmdResetView:
        viewport_.ResetView();
        break;
    case CmdFitView:
        viewport_.FitView();
        break;
    case CmdPerspective:
        viewport_.SetOrthographic(false);
        SaveSettingsNow();
        break;
    case CmdOrthographic:
        viewport_.SetOrthographic(true);
        SaveSettingsNow();
        break;
    case CmdToggleCell:
        if (structure_ && structure_->cell.valid) {
            options_.showCell = !options_.showCell;
            ApplyOptions();
        }
        break;
    case CmdToggleBonds:
        options_.showBonds = !options_.showBonds;
        ApplyOptions();
        break;
    case CmdToggleLabels:
        options_.showLabels = !options_.showLabels;
        ApplyOptions();
        break;
    case CmdToggleImages:
        if (structure_ && structure_->cell.valid) {
            options_.showImages = !options_.showImages;
            ApplyOptions();
        }
        break;
    case CmdSupercell:
        SupercellDialog();
        break;
    case CmdAppearance:
        AppearanceDialog();
        break;
    case CmdToggleAxes:
        options_.showAxes = !options_.showAxes;
        ApplyOptions();
        break;
    case CmdToggleLeftPanel:
        leftVisible_ = !leftVisible_;
        SaveSettingsNow();
        ResetHover();
        Relayout();
        InvalidateRect(hwnd_, nullptr, FALSE);
        break;
    case CmdToggleRightPanel:
        rightVisible_ = !rightVisible_;
        SaveSettingsNow();
        ResetHover();
        Relayout();
        InvalidateRect(hwnd_, nullptr, FALSE);
        break;
    case CmdBallStick:
        options_.style = AtomStyle::BallAndStick;
        ApplyOptions();
        break;
    case CmdSpaceFill:
        options_.style = AtomStyle::SpaceFill;
        ApplyOptions();
        break;
    case CmdPolyhedral:
        options_.style = AtomStyle::Polyhedral;
        ApplyOptions();
        break;
    case CmdLanguageChinese:
        I18n::SetLanguage(Language::Chinese);
        SaveSettingsNow();
        UpdateTitle();
        SetStatus(structure_ ? Fmt(T(Str::StatusLoadedFmt), CurrentFileName().c_str()) : T(Str::StatusReadyHint));
        HideTooltip();
        toast_.Hide();
        InvalidateRect(hwnd_, nullptr, FALSE);
        viewport_.InvalidateView();
        break;
    case CmdLanguageEnglish:
        I18n::SetLanguage(Language::English);
        SaveSettingsNow();
        UpdateTitle();
        SetStatus(structure_ ? Fmt(T(Str::StatusLoadedFmt), CurrentFileName().c_str()) : T(Str::StatusReadyHint));
        HideTooltip();
        toast_.Hide();
        InvalidateRect(hwnd_, nullptr, FALSE);
        viewport_.InvalidateView();
        break;
    case CmdMeasureDistance:
        ToggleMeasureMode(MeasureMode::Distance);
        break;
    case CmdMeasureAngle:
        ToggleMeasureMode(MeasureMode::Angle);
        break;
    case CmdCancelMeasure:
        viewport_.CancelMeasure();
        break;
    case CmdHelp:
    case CmdAbout:
        menu_.Hide();
        HideTooltip();
        toast_.Hide();
        help_.Show(scale_);
        break;
    default:
        break;
    }
    if (hotspots_.size() > 0) ResetHover();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::ApplyOptions(bool save) {
    viewport_.SetOptions(options_);
    if (save) SaveSettingsNow();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::SaveSettingsNow() {
    AppSettings settings;
    settings.language = I18n::GetLanguage();
    settings.leftPanel = leftVisible_;
    settings.rightPanel = rightVisible_;
    settings.showCell = options_.showCell;
    settings.showBonds = options_.showBonds;
    settings.showLabels = options_.showLabels;
    settings.showImages = options_.showImages;
    settings.showAxes = options_.showAxes;
    settings.orthographic = viewport_.Orthographic();
    settings.atomStyle = options_.style == AtomStyle::Polyhedral ? 2
                         : options_.style == AtomStyle::SpaceFill ? 1
                                                                   : 0;
    settings.atomScale = options_.atomScale;
    settings.supercellX = options_.supercellX;
    settings.supercellY = options_.supercellY;
    settings.supercellZ = options_.supercellZ;
    static_cast<AppearanceState&>(settings) = options_;
    Settings::Save(settings, savedSettings_);
    savedSettings_ = settings;
}

std::wstring MainWindow::CurrentFileName() const {
    if (currentPath_.empty()) return {};
    return std::filesystem::path(currentPath_).filename().wstring();
}

void MainWindow::UpdateTitle() {
    std::wstring title = T(Str::AppName);
    title += L"  —  ";
    const std::wstring file = CurrentFileName();
    title += file.empty() ? T(Str::AppTagline) : file;
    if (modified_) title += L" *";
    SetWindowTextW(hwnd_, title.c_str());
}

void MainWindow::SetStatus(const std::wstring& text) {
    statusMessage_ = text;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::ShowToast(const std::wstring& title, const std::wstring& message, ToastKind kind) {
    toast_.Show(title, message, kind, scale_);
}

void MainWindow::OpenPath(const std::wstring& path) {
    if (path.empty()) return;
    HCURSOR previous = SetCursor(LoadCursorW(nullptr, IDC_WAIT));
    Structure loaded;
    ParseError error;
    const bool ok = LoadStructureFile(path, loaded, error);
    SetCursor(previous);
    if (!ok) {
        std::wstring detail = Utf8ToWide(error.message);
        if (detail.empty()) detail = T(Str::UnsupportedFormat);
        if (error.line > 0) detail += L"  (line " + std::to_wstring(error.line) + L")";
        const std::wstring name = std::filesystem::path(path).filename().wstring();
        ShowToast(T(Str::OpenFailedTitle), name + L"\n" + detail, ToastKind::Error);
        SetStatus(T(Str::OpenFailedTitle));
        return;
    }
    structure_ = std::make_shared<Structure>(std::move(loaded));
    currentPath_ = path;
    modified_ = false;
    undoStack_.clear();
    redoStack_.clear();
    selectedAtom_ = -1;
    hoveredAtom_ = -1;
    leftScroll_ = 0.0f;
    rightScroll_ = 0.0f;
    leftContentHeight_ = 0.0f;
    rightContentHeight_ = 0.0f;
    viewport_.SetStructure(structure_);
    UpdateTitle();
    const std::wstring name = CurrentFileName();
    statusMessage_ = Fmt(T(Str::StatusLoadedFmt), name.c_str());
    const std::wstring info = Fmt(T(Str::StatusFileInfoFmt), FormatDisplayName(structure_->format),
                                  static_cast<int>(structure_->atoms.size()),
                                  static_cast<int>(structure_->bonds.size()));
    ShowToast(Fmt(T(Str::LoadedToastFmt), name.c_str()), info, ToastKind::Success);
    ResetHover();
    InvalidateRect(hwnd_, nullptr, FALSE);
    if (viewport_.Hwnd()) SetFocus(viewport_.Hwnd());
}

void MainWindow::OpenDocument(const std::wstring& path) {
    if (!structure_) {
        OpenPath(path);
        return;
    }
    // Each document owns its OpenGL context, edit history and measurement state.
    const std::wstring executable = ExecutablePath();
    std::wstring command = L"\"" + executable + L"\" \"" + path + L"\"";
    STARTUPINFOW startup{sizeof(startup)};
    PROCESS_INFORMATION child{};
    if (CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, 0,
                       nullptr, nullptr, &startup, &child)) {
        CloseHandle(child.hThread);
        CloseHandle(child.hProcess);
    } else {
        ShowToast(T(Str::OpenFailedTitle), path, ToastKind::Error);
    }
}

void MainWindow::OpenFileDialog() {
    std::vector<std::wstring> paths;
    if (ShowOpenDialog(hwnd_, paths)) {
        for (const auto& path : paths) OpenDocument(path);
    }
}

void MainWindow::SaveScreenshotDialog() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    std::filesystem::path folder = std::filesystem::path(PicturesDirectory()) / L"CrystalLens";
    std::error_code ec;
    std::filesystem::create_directories(folder, ec);
    if (ec || !std::filesystem::is_directory(folder)) {
        wchar_t localAppData[MAX_PATH]{};
        const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
        if (length > 0 && length < MAX_PATH) {
            folder = std::filesystem::path(localAppData) / L"CrystalLens" / L"Screenshots";
            ec.clear();
            std::filesystem::create_directories(folder, ec);
        }
    }
    if (ec || !std::filesystem::is_directory(folder)) {
        wchar_t tempPath[MAX_PATH]{};
        const DWORD tempLength = GetTempPathW(MAX_PATH, tempPath);
        if (tempLength > 0 && tempLength < MAX_PATH) {
            folder = std::filesystem::path(tempPath) / L"CrystalLens Screenshots";
            ec.clear();
            std::filesystem::create_directories(folder, ec);
        }
    }
    if (ec || !std::filesystem::is_directory(folder)) {
        std::error_code cwdError;
        const std::filesystem::path cwd = std::filesystem::current_path(cwdError);
        if (!cwdError) {
            folder = cwd / L"CrystalLens Screenshots";
            ec.clear();
            std::filesystem::create_directories(folder, ec);
        }
    }
    if (ec || !std::filesystem::is_directory(folder)) {
        ShowToast(T(Str::ScreenshotFailed), folder.wstring() + L"\n" + Utf8ToWide(ec.message()), ToastKind::Error);
        return;
    }
    SYSTEMTIME time{};
    GetLocalTime(&time);
    wchar_t name[96];
    swprintf_s(name, L"CrystalLens-%04u%02u%02u-%02u%02u%02u.png", time.wYear, time.wMonth, time.wDay,
               time.wHour, time.wMinute, time.wSecond);
    const std::wstring path = (folder / name).wstring();
    std::wstring error;
    if (viewport_.CaptureScreenshot(path, &error)) {
        ShowToast(T(Str::ScreenshotSaved), Fmt(T(Str::ScreenshotSavedFmt), path.c_str()), ToastKind::Success);
        SetStatus(Fmt(T(Str::ScreenshotSavedFmt), path.c_str()));
    } else {
        ShowToast(T(Str::ScreenshotFailed), path + L"\n" + error, ToastKind::Error);
    }
}

bool MainWindow::ConfirmDiscardChanges() {
    if (!modified_ || !structure_) return true;
    return MessageBoxW(hwnd_, T(Str::UnsavedMessage), T(Str::UnsavedTitle),
                       MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) == IDYES;
}

void MainWindow::PushUndoSnapshot() {
    if (!structure_) return;
    undoStack_.push_back(*structure_);
    if (undoStack_.size() > 50) undoStack_.erase(undoStack_.begin());
    redoStack_.clear();
}

void MainWindow::RefreshAfterEdit(int selectIndex, const std::wstring& status, bool preserveCamera) {
    if (!structure_) return;
    modified_ = true;
    if (selectIndex >= static_cast<int>(structure_->atoms.size())) selectIndex = -1;
    selectedAtom_ = selectIndex;
    hoveredAtom_ = -1;
    viewport_.RefreshStructure(preserveCamera, selectIndex);
    UpdateTitle();
    statusMessage_ = status;
    ResetHover();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::CommitStructure(Structure&& candidate, bool preserveCamera, int selectIndex,
                                 const std::wstring& status) {
    if (!structure_) return;
    PushUndoSnapshot();
    *structure_ = std::move(candidate);
    RefreshAfterEdit(selectIndex, status, preserveCamera);
}

void MainWindow::Undo() {
    if (!structure_ || undoStack_.empty()) return;
    Structure current = *structure_;
    Structure previous = std::move(undoStack_.back());
    undoStack_.pop_back();
    redoStack_.push_back(std::move(current));
    if (redoStack_.size() > 50) redoStack_.erase(redoStack_.begin());
    *structure_ = std::move(previous);
    RefreshAfterEdit(-1, T(Str::Undone), true);
}

void MainWindow::Redo() {
    if (!structure_ || redoStack_.empty()) return;
    Structure current = *structure_;
    Structure next = std::move(redoStack_.back());
    redoStack_.pop_back();
    undoStack_.push_back(std::move(current));
    if (undoStack_.size() > 50) undoStack_.erase(undoStack_.begin());
    *structure_ = std::move(next);
    RefreshAfterEdit(-1, T(Str::Redone), true);
}

int MainWindow::SelectedSiteIndex() const {
    if (!structure_ || selectedAtom_ < 0 || selectedAtom_ >= static_cast<int>(structure_->atoms.size()))
        return -1;
    return structure_->atoms[static_cast<size_t>(selectedAtom_)].siteIndex;
}

void MainWindow::EditCellDialog() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    if (!structure_->cell.valid) {
        ShowToast(T(Str::EditCellTitle), T(Str::NoCellForEdit), ToastKind::Info);
        return;
    }
    const Cell& cell = structure_->cell;
    std::vector<FormField> fields = {
        {L"a", FormatNumber(cell.a, 6), L"Å"},       {L"b", FormatNumber(cell.b, 6), L"Å"},
        {L"c", FormatNumber(cell.c, 6), L"Å"},       {L"α", FormatNumber(cell.alpha, 4), L"°"},
        {L"β", FormatNumber(cell.beta, 4), L"°"},    {L"γ", FormatNumber(cell.gamma, 4), L"°"},
    };
    form_.Show(T(Str::EditCellTitle), T(Str::EditCellSubtitle), fields, T(Str::DialogOK),
               T(Str::DialogCancel),
               [this](const std::vector<std::wstring>& values) -> std::wstring {
                   if (values.size() != 6) return T(Str::CellInvalid);
                   double parsed[6]{};
                   for (size_t i = 0; i < 6; ++i) {
                       if (!ParseNumberToken(values[i], parsed[i])) return T(Str::DialogInvalidNumber);
                   }
                   Structure candidate = *structure_;
                   std::string error;
                   if (!SetCellParameters(candidate, parsed[0], parsed[1], parsed[2], parsed[3], parsed[4],
                                          parsed[5], &error)) {
                       return T(Str::CellInvalid);
                   }
                   CommitStructure(std::move(candidate), true, -1, T(Str::StructureUpdated));
                   return {};
               },
               scale_);
}

void MainWindow::SupercellDialog() {
    if (!structure_ || !structure_->cell.valid) {
        ShowToast(T(Str::SupercellTitle), T(Str::NoCellForEdit), ToastKind::Info);
        return;
    }
    std::vector<FormField> fields = {
        {T(Str::SupercellAxisA), std::to_wstring(options_.supercellX), L"×"},
        {T(Str::SupercellAxisB), std::to_wstring(options_.supercellY), L"×"},
        {T(Str::SupercellAxisC), std::to_wstring(options_.supercellZ), L"×"},
    };
    form_.Show(T(Str::SupercellTitle), T(Str::SupercellSubtitle), fields, T(Str::DialogOK),
               T(Str::DialogCancel),
               [this](const std::vector<std::wstring>& values) -> std::wstring {
                   if (values.size() != 3) return T(Str::SupercellInvalid);
                   int repeats[3]{};
                   for (size_t i = 0; i < 3; ++i) {
                       double parsed = 0.0;
                       if (!ParseNumberToken(values[i], parsed)) return T(Str::SupercellInvalid);
                       if (!std::isfinite(parsed) || parsed < 1 || parsed > kMaxCellRepeats ||
                           parsed != std::floor(parsed)) return T(Str::SupercellInvalid);
                       repeats[i] = static_cast<int>(parsed);
                   }
                   if (!structure_ || !structure_->cell.valid) return T(Str::NoCellForEdit);
                   if (!FitsSupercell(*structure_, repeats[0] * repeats[1] * repeats[2]))
                       return T(Str::SupercellBudget);
                   options_.supercellX = repeats[0];
                   options_.supercellY = repeats[1];
                   options_.supercellZ = repeats[2];
                   ApplyOptions();
                   return {};
               },
               scale_);
}

void MainWindow::AppearanceDialog() {
    appearance_.Show(
        options_, scale_,
        [this](const AppearanceState& changed) {
            static_cast<AppearanceState&>(options_) = changed;
            viewport_.SetAppearance(changed);
        },
        [this]() { SaveSettingsNow(); });
}

void MainWindow::AddAtomDialog() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    const bool fractional = structure_->cell.valid;
    Atom seed;
    seed.atomicNumber = 6;
    seed.element = "C";
    seed.occupancy = 1.0;
    if (fractional) {
        seed.frac = {0.5, 0.5, 0.5};
    } else {
        seed.cart = structure_->center;
    }
    const Vec3 coordinates = fractional ? seed.frac : seed.cart;
    std::vector<FormField> fields = {
        {T(Str::ElementField), Utf8ToWide(seed.element), T(Str::HintElementInput)},
        {T(Str::AtomLabelField), L"", T(Str::HintOptional)},
        {T(Str::OccupancyField), L"1.00", L"0 – 1"},
        {L"x", FormatNumber(coordinates.x, 5), fractional ? T(Str::HintFractional) : L"Å"},
        {L"y", FormatNumber(coordinates.y, 5), fractional ? T(Str::HintFractional) : L"Å"},
        {L"z", FormatNumber(coordinates.z, 5), fractional ? T(Str::HintFractional) : L"Å"},
    };
    form_.Show(T(Str::AddAtomTitle), T(fractional ? Str::AtomSubtitleFrac : Str::AtomSubtitleCart), fields,
               T(Str::DialogOK), T(Str::DialogCancel),
               [this, fractional](const std::vector<std::wstring>& values) -> std::wstring {
                   if (values.size() != 6) return T(Str::DialogInvalidNumber);
                   int z = 0;
                   std::string symbol;
                   std::string elementError;
                   if (!ElementFromInput(WideToUtf8(values[0]), z, symbol, &elementError)) {
                       return T(Str::InvalidElement);
                   }
                   double occupancy = 1.0;
                   double coords[3]{};
                   if (!ParseNumberToken(values[2], occupancy)) return T(Str::DialogInvalidNumber);
                   if (!(occupancy > 0.0 && occupancy <= 1.0)) return T(Str::InvalidOccupancy);
                   for (int i = 0; i < 3; ++i) {
                       if (!ParseNumberToken(values[3 + static_cast<size_t>(i)], coords[i])) {
                           return T(Str::DialogInvalidNumber);
                       }
                   }
                   Atom atom;
                   atom.atomicNumber = z;
                   atom.element = symbol;
                   atom.label = WideToUtf8(values[1]);
                   atom.occupancy = occupancy;
                   if (fractional) {
                       atom.frac = {coords[0], coords[1], coords[2]};
                   } else {
                       atom.cart = {coords[0], coords[1], coords[2]};
                   }
                   Structure candidate = *structure_;
                   std::string error;
                   const int site = AddAtomSite(candidate, atom, &error);
                   if (site < 0) {
                       return error.empty() ? T(Str::DialogInvalidNumber) : Utf8ToWide(error);
                   }
                   const int display = FindDisplayedSite(candidate, site);
                   CommitStructure(std::move(candidate), true, display, T(Str::StructureUpdated));
                   return {};
               },
               scale_);
}

void MainWindow::EditSelectedAtomDialog() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    const int site = SelectedSiteIndex();
    if (site < 0 || site >= static_cast<int>(structure_->asymmetricAtoms.size())) {
        ShowToast(T(Str::EditAtomTitle), T(Str::SelectAtomFirst), ToastKind::Info);
        return;
    }
    const Atom& source = structure_->asymmetricAtoms[static_cast<size_t>(site)];
    const bool fractional = structure_->cell.valid;
    const Vec3 coordinates = fractional ? source.frac : source.cart;
    std::vector<FormField> fields = {
        {T(Str::ElementField), Utf8ToWide(ElementByZ(source.atomicNumber).symbol),
         T(Str::HintElementInput)},
        {T(Str::AtomLabelField), Utf8ToWide(source.baseLabel.empty() ? source.label : source.baseLabel),
         T(Str::HintOptional)},
        {T(Str::OccupancyField), FormatNumber(source.occupancy, 2), L"0 – 1"},
        {L"x", FormatNumber(coordinates.x, 5), fractional ? T(Str::HintFractional) : L"Å"},
        {L"y", FormatNumber(coordinates.y, 5), fractional ? T(Str::HintFractional) : L"Å"},
        {L"z", FormatNumber(coordinates.z, 5), fractional ? T(Str::HintFractional) : L"Å"},
    };
    std::wstring subtitle = T(fractional ? Str::EditAtomSubtitleFrac : Str::EditAtomSubtitleCart);
    const bool generated = selectedAtom_ >= 0 &&
                           structure_->atoms[static_cast<size_t>(selectedAtom_)].symmetryGenerated;
    if (generated) subtitle += L"  " + std::wstring(T(Str::EditSymmetryNote));
    form_.Show(T(Str::EditAtomTitle), subtitle, fields, T(Str::DialogOK), T(Str::DialogCancel),
               [this, site, fractional](const std::vector<std::wstring>& values) -> std::wstring {
                   if (values.size() != 6) return T(Str::DialogInvalidNumber);
                   int z = 0;
                   std::string symbol;
                   std::string elementError;
                   if (!ElementFromInput(WideToUtf8(values[0]), z, symbol, &elementError)) {
                       return T(Str::InvalidElement);
                   }
                   double occupancy = 1.0;
                   double coords[3]{};
                   if (!ParseNumberToken(values[2], occupancy)) return T(Str::DialogInvalidNumber);
                   if (!(occupancy > 0.0 && occupancy <= 1.0)) return T(Str::InvalidOccupancy);
                   for (int i = 0; i < 3; ++i) {
                       if (!ParseNumberToken(values[3 + static_cast<size_t>(i)], coords[i])) {
                           return T(Str::DialogInvalidNumber);
                       }
                   }
                   Atom atom = structure_->asymmetricAtoms[static_cast<size_t>(site)];
                   atom.atomicNumber = z;
                   atom.element = symbol;
                   atom.label = WideToUtf8(values[1]);
                   atom.occupancy = occupancy;
                   if (fractional) {
                       atom.frac = {coords[0], coords[1], coords[2]};
                   } else {
                       atom.cart = {coords[0], coords[1], coords[2]};
                   }
                   Structure candidate = *structure_;
                   std::string error;
                   if (!UpdateAtomSite(candidate, site, atom, &error)) {
                       return error.empty() ? T(Str::DialogInvalidNumber) : Utf8ToWide(error);
                   }
                   const int display = FindDisplayedSite(candidate, site);
                   CommitStructure(std::move(candidate), true, display, T(Str::StructureUpdated));
                   return {};
               },
               scale_);
}

void MainWindow::DeleteSelectedAtom() {
    if (!structure_) return;
    const int site = SelectedSiteIndex();
    if (site < 0) {
        ShowToast(T(Str::DeleteAtom), T(Str::SelectAtomFirst), ToastKind::Info);
        return;
    }
    Structure candidate = *structure_;
    std::string error;
    if (!DeleteAtomSite(candidate, site, &error)) {
        ShowToast(T(Str::DeleteAtom), Utf8ToWide(error), ToastKind::Error);
        return;
    }
    CommitStructure(std::move(candidate), true, -1, T(Str::AtomDeleted));
}

void MainWindow::SaveStructureDialog() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    std::filesystem::path suggested = currentPath_.empty() ? std::filesystem::path(L"CrystalLens")
                                                           : std::filesystem::path(currentPath_);
    suggested = suggested.parent_path() / (suggested.stem().wstring() + L"-edited");
    const bool allowCif = structure_->cell.valid;
    bool cif = allowCif;
    suggested += cif ? L".cif" : L".xyz";
    std::wstring path;
    if (!ShowSaveStructureDialog(hwnd_, suggested.wstring(), allowCif, cif, path)) return;
    std::string error;
    bool ok = false;
    if (cif) {
        if (!structure_->cell.valid) {
            ShowToast(T(Str::SaveStructureFailed), T(Str::NoCellForCif), ToastKind::Error);
            return;
        }
        ok = ExportStructureToCif(*structure_, path, &error);
    } else {
        ok = ExportStructureToXyz(*structure_, path, &error);
    }
    if (!ok) {
        ShowToast(T(Str::SaveStructureFailed),
                  error.empty() ? T(Str::SaveStructureFailed) : Utf8ToWide(error), ToastKind::Error);
        return;
    }
    OpenPath(path);
    if (currentPath_ == path) {
        modified_ = false;
        UpdateTitle();
        ShowToast(T(Str::SaveStructureSaved), Fmt(T(Str::SaveStructureSavedFmt), path.c_str()),
                  ToastKind::Success);
        SetStatus(Fmt(T(Str::SaveStructureSavedFmt), path.c_str()));
    }
}

void MainWindow::CopySummary() {
    if (!structure_) {
        ShowToast(T(Str::NoStructureToast), L"", ToastKind::Info);
        return;
    }
    const std::wstring summary = BuildStructureSummary(*structure_, viewport_.Measurements());
    if (WriteClipboardText(hwnd_, summary)) {
        ShowToast(T(Str::CopiedSummary), L"", ToastKind::Success);
    } else {
        ShowToast(T(Str::OpenFailedTitle), L"Clipboard is unavailable", ToastKind::Error);
    }
}

std::wstring MainWindow::HoverStatusText() const {
    if (!structure_ || hoveredAtom_ < 0 || hoveredAtom_ >= static_cast<int>(structure_->atoms.size())) {
        return statusMessage_;
    }
    const Atom& atom = structure_->atoms[static_cast<size_t>(hoveredAtom_)];
    return Fmt(T(Str::StatusHoverFmt), Utf8ToWide(atom.label).c_str(),
               ElementSymbolText(atom.atomicNumber).c_str());
}

void MainWindow::OnViewportSelectionChanged(int atomIndex) {
    selectedAtom_ = atomIndex;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::OnViewportMeasurementsChanged() {
    ResetHover();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::OnViewportHoverChanged(int atomIndex) {
    hoveredAtom_ = atomIndex;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::OnViewportModeChanged(MeasureMode mode) {
    (void)mode;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void MainWindow::OnViewportCommand(int commandId) { ExecuteCommand(commandId); }

} // namespace cl
