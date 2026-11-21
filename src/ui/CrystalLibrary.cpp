#include "CrystalLibrary.h"
#include "Localization.h"
#include "core/Crystal.h"
#include "library_ids.h"

#include <commctrl.h>
#include <array>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace cl {

std::wstring ExecutablePath() {
    std::wstring path(32768, L'\0');
    DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (!length || length == path.size()) return {};
    path.resize(length);
    return path;
}

namespace {

struct Entry {
    std::wstring path;
    std::array<std::wstring, 4> columns;
};

struct Picker {
    std::vector<Entry> entries;
    std::vector<std::wstring> selected;
};

std::vector<Entry> ReadLibrary(const std::filesystem::path& directory) {
    std::ifstream index(directory / L"index.tsv");
    std::string line;
    std::getline(index, line); // Column headings.
    std::vector<Entry> entries;
    while (std::getline(index, line)) {
        std::istringstream row(line);
        std::array<std::string, 6> fields;
        bool complete = true;
        for (auto& field : fields) {
            if (!std::getline(row, field, '\t') || field.empty()) {
                complete = false;
                break;
            }
        }
        if (!complete) continue;
        const std::filesystem::path file = Utf8ToWide(fields[0]);
        if (file != file.filename() || file.extension() != L".cif") continue;
        entries.push_back({(directory / file).wstring(),
            {Utf8ToWide(fields[I18n::IsChinese() ? 1 : 2]), Utf8ToWide(fields[3]),
             Utf8ToWide(fields[4]), Utf8ToWide(fields[5])}});
    }
    return entries;
}

void Populate(HWND dialog, Picker& picker) {
    SetWindowTextW(dialog, T(Str::Library));
    SetDlgItemTextW(dialog, IDC_LIBRARY_HINT, T(Str::LibraryHint));
    SetDlgItemTextW(dialog, IDOK, T(Str::LibraryOpen));
    SetDlgItemTextW(dialog, IDCANCEL, T(Str::DialogCancel));
    HWND list = GetDlgItem(dialog, IDC_LIBRARY_LIST);
    ListView_SetExtendedListViewStyle(list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
    RECT bounds{};
    GetClientRect(list, &bounds);
    const int available = bounds.right - GetSystemMetricsForDpi(SM_CXVSCROLL, GetDpiForWindow(dialog)) - 2;
    const wchar_t* labels[] = {T(Str::LibraryMineral), T(Str::LibraryFormula), T(Str::LibraryGroup), L"COD"};
    const int percentages[] = {34, 17, 29, 20};
    for (int col = 0; col < 4; ++col) {
        LVCOLUMNW column{};
        column.mask = LVCF_TEXT | LVCF_WIDTH;
        column.pszText = const_cast<wchar_t*>(labels[col]);
        column.cx = available * percentages[col] / 100;
        ListView_InsertColumn(list, col, &column);
    }
    for (int row = 0; row < static_cast<int>(picker.entries.size()); ++row) {
        auto& values = picker.entries[row].columns;
        LVITEMW item{};
        item.mask = LVIF_TEXT;
        item.iItem = row;
        item.pszText = values[0].data();
        ListView_InsertItem(list, &item);
        for (int col = 1; col < 4; ++col) ListView_SetItemText(list, row, col, values[col].data());
    }
    ListView_SetItemState(list, 0, LVIS_SELECTED | LVIS_FOCUSED, LVIS_SELECTED | LVIS_FOCUSED);
}

INT_PTR CALLBACK LibraryProc(HWND dialog, UINT message, WPARAM wp, LPARAM lp) {
    if (message == WM_INITDIALOG) {
        SetWindowLongPtrW(dialog, DWLP_USER, lp);
        Populate(dialog, *reinterpret_cast<Picker*>(lp));
        SetFocus(GetDlgItem(dialog, IDC_LIBRARY_LIST));
        return FALSE;
    }
    HWND list = GetDlgItem(dialog, IDC_LIBRARY_LIST);
    if (message == WM_NOTIFY) {
        const auto* info = reinterpret_cast<NMHDR*>(lp);
        if (info->idFrom != IDC_LIBRARY_LIST) return FALSE;
        if (info->code == LVN_ITEMCHANGED) {
            EnableWindow(GetDlgItem(dialog, IDOK), ListView_GetSelectedCount(list) > 0);
        } else if (info->code == NM_DBLCLK && reinterpret_cast<NMITEMACTIVATE*>(lp)->iItem >= 0) {
            SendMessageW(dialog, WM_COMMAND, IDOK, 0);
        }
        return FALSE;
    }
    if (message == WM_COMMAND && LOWORD(wp) == IDOK) {
        auto& picker = *reinterpret_cast<Picker*>(GetWindowLongPtrW(dialog, DWLP_USER));
        for (int i = ListView_GetNextItem(list, -1, LVNI_SELECTED); i >= 0;
             i = ListView_GetNextItem(list, i, LVNI_SELECTED)) {
            picker.selected.push_back(picker.entries[i].path);
        }
        if (!picker.selected.empty()) EndDialog(dialog, IDOK);
        return TRUE;
    }
    if (message == WM_CLOSE || (message == WM_COMMAND && LOWORD(wp) == IDCANCEL)) {
        EndDialog(dialog, IDCANCEL);
        return TRUE;
    }
    return FALSE;
}
} // namespace

std::vector<std::wstring> ChooseLibraryStructures(HWND owner) {
    const auto directory = std::filesystem::path(ExecutablePath()).parent_path() / L"library";
    Picker picker{ReadLibrary(directory), {}};
    INITCOMMONCONTROLSEX controls{sizeof(controls), ICC_LISTVIEW_CLASSES};
    if (picker.entries.empty() || !InitCommonControlsEx(&controls) ||
        DialogBoxParamW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDD_LIBRARY), owner,
                        LibraryProc, reinterpret_cast<LPARAM>(&picker)) == -1) {
        MessageBoxW(owner, T(Str::LibraryUnavailable), T(Str::Library), MB_OK | MB_ICONERROR);
    }
    return picker.selected;
}

} // namespace cl
