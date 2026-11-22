#include "ElementStyleDialog.h"
#include "Localization.h"
#include "core/Crystal.h"
#include "library_ids.h"

#include <commdlg.h>
#include <cwchar>

namespace cl {
namespace {

struct Editor {
    const std::map<int, int>& counts;
    ElementStyles styles;
    int selected;
    COLORREF customColors[16]{};
};

void ShowStyle(HWND dlg, const Editor& editor) {
    const auto& style = editor.styles[editor.selected];
    SetDlgItemInt(dlg, IDC_ELEMENT_RADIUS, style.radiusPercent, FALSE);
    wchar_t hex[8]{};
    swprintf_s(hex, L"#%06X", style.Color(ElementByZ(editor.selected)));
    SetDlgItemTextW(dlg, IDC_ELEMENT_HEX, hex);
    InvalidateRect(GetDlgItem(dlg, IDC_ELEMENT_SWATCH), nullptr, TRUE);
}

bool StoreRadius(HWND dlg, Editor& editor) {
    BOOL valid = FALSE;
    const UINT percent = GetDlgItemInt(dlg, IDC_ELEMENT_RADIUS, &valid, FALSE);
    if (!valid || percent < 25 || percent > 300) {
        MessageBoxW(dlg, T(Str::RadiusInvalid), T(Str::ElementRadius), MB_OK | MB_ICONINFORMATION);
        SetFocus(GetDlgItem(dlg, IDC_ELEMENT_RADIUS));
        return false;
    }
    editor.styles[editor.selected].radiusPercent = static_cast<int>(percent);
    return true;
}

INT_PTR CALLBACK Proc(HWND dlg, UINT msg, WPARAM wp, LPARAM lp) {
    auto* editor = reinterpret_cast<Editor*>(GetWindowLongPtrW(dlg, DWLP_USER));
    const HWND list = GetDlgItem(dlg, IDC_ELEMENT_LIST);
    if (msg == WM_INITDIALOG) {
        editor = reinterpret_cast<Editor*>(lp);
        SetWindowLongPtrW(dlg, DWLP_USER, lp);
        SetWindowTextW(dlg, T(Str::ElementStyleMenu));
        SetDlgItemTextW(dlg, IDC_ELEMENT_LABEL, T(Str::ElementField));
        SetDlgItemTextW(dlg, IDC_RADIUS_LABEL, T(Str::ElementRadius));
        SetDlgItemTextW(dlg, IDC_ELEMENT_COLOR, T(Str::ElementColor));
        SetDlgItemTextW(dlg, IDC_ELEMENT_RESET, T(Str::ElementDefault));
        SetDlgItemTextW(dlg, IDOK, T(Str::DialogOK));
        SetDlgItemTextW(dlg, IDCANCEL, T(Str::DialogCancel));
        SendDlgItemMessageW(dlg, IDC_ELEMENT_RADIUS, EM_SETLIMITTEXT, 3, 0);
        for (const auto& [z, count] : editor->counts) {
            const auto label = ElementDisplayName(z);
            const auto row = SendMessageW(list, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(label.c_str()));
            SendMessageW(list, CB_SETITEMDATA, row, z);
            if (z == editor->selected) SendMessageW(list, CB_SETCURSEL, row, 0);
        }
        ShowStyle(dlg, *editor);
        return TRUE;
    }
    if (!editor) return FALSE;
    auto& style = editor->styles[editor->selected];
    const auto rgb = style.Color(ElementByZ(editor->selected));
    const COLORREF swatch = RGB((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
    if (msg == WM_DRAWITEM && wp == IDC_ELEMENT_SWATCH) {
        const auto& item = *reinterpret_cast<const DRAWITEMSTRUCT*>(lp);
        SetDCBrushColor(item.hDC, swatch);
        FillRect(item.hDC, &item.rcItem, static_cast<HBRUSH>(GetStockObject(DC_BRUSH)));
        FrameRect(item.hDC, &item.rcItem, GetSysColorBrush(COLOR_3DSHADOW));
        return TRUE;
    }
    if (msg == WM_COMMAND) {
        switch (LOWORD(wp)) {
        case IDC_ELEMENT_LIST:
            if (HIWORD(wp) == CBN_SELCHANGE) {
                if (!StoreRadius(dlg, *editor)) {
                    for (int i = 0; i < SendMessageW(list, CB_GETCOUNT, 0, 0); ++i)
                        if (SendMessageW(list, CB_GETITEMDATA, i, 0) == editor->selected)
                            SendMessageW(list, CB_SETCURSEL, i, 0);
                    return TRUE;
                }
                const auto row = SendMessageW(list, CB_GETCURSEL, 0, 0);
                editor->selected = static_cast<int>(SendMessageW(list, CB_GETITEMDATA, row, 0));
                ShowStyle(dlg, *editor);
            }
            return TRUE;
        case IDC_ELEMENT_COLOR: {
            if (!StoreRadius(dlg, *editor)) return TRUE;
            CHOOSECOLORW color{sizeof(color)};
            color.hwndOwner = dlg;
            color.lpCustColors = editor->customColors;
            color.rgbResult = swatch;
            color.Flags = CC_FULLOPEN | CC_RGBINIT;
            if (ChooseColorW(&color)) {
                style.color = (GetRValue(color.rgbResult) << 16) | (GetGValue(color.rgbResult) << 8) |
                              GetBValue(color.rgbResult);
                ShowStyle(dlg, *editor);
            }
            return TRUE;
        }
        case IDC_ELEMENT_RESET:
            style = ElementStyle{};
            ShowStyle(dlg, *editor);
            return TRUE;
        case IDOK:
            if (StoreRadius(dlg, *editor)) EndDialog(dlg, IDOK);
            return TRUE;
        case IDCANCEL:
            EndDialog(dlg, IDCANCEL);
            return TRUE;
        }
    }
    return FALSE;
}

} // namespace

bool EditElementStyles(HWND owner, const std::map<int,int>& counts, int preferred, ElementStyles& styles) {
    if (counts.empty()) return false;
    Editor editor{counts, styles, counts.count(preferred) ? preferred : counts.begin()->first};
    if (DialogBoxParamW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDD_ELEMENT_STYLE), owner, Proc,
                        reinterpret_cast<LPARAM>(&editor)) != IDOK) return false;
    styles = editor.styles;
    return true;
}

} // namespace cl
