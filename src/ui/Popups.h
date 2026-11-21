#pragma once

#include "Commands.h"
#include "UiDraw.h"

#include <functional>
#include <string>
#include <vector>

namespace cl {

constexpr UINT WM_CL_MENU_CLOSED = WM_APP + 101;

struct MenuEntry {
    std::wstring label;
    std::wstring shortcut;
    int command = CmdNone;
    bool enabled = true;
    bool checked = false;
    bool separator = false;

    static MenuEntry Separator() {
        MenuEntry entry;
        entry.separator = true;
        return entry;
    }
};

class MenuPopup {
public:
    bool Create(HWND owner);
    void Show(const std::vector<MenuEntry>& entries, POINT screenPosition, float dpiScale);
    void Hide();
    bool IsVisible() const { return visible_; }
    ~MenuPopup();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);
    void Paint();
    void Layout();
    int HitTest(int x, int y) const;
    void Execute(int index);
    void Close(bool notify);

    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    bool closing_ = false;
    std::vector<MenuEntry> entries_;
    std::vector<RECT> itemRects_;
    int width_ = 0;
    int height_ = 0;
    int hovered_ = -1;
    float dpi_ = 1.0f;
    int itemHeight_ = 0;
    int separatorHeight_ = 0;
    int padding_ = 0;
};

class TooltipWindow {
public:
    bool Create(HWND owner);
    void Show(const std::wstring& text, int screenX, int screenY, float dpiScale);
    void Hide();
    bool IsVisible() const { return visible_; }
    ~TooltipWindow();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);
    void Paint();
    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    std::wstring text_;
    float dpi_ = 1.0f;
    int width_ = 0;
    int height_ = 0;
};

enum class ToastKind { Info, Success, Error };

class ToastWindow {
public:
    bool Create(HWND owner);
    void Show(const std::wstring& title, const std::wstring& message, ToastKind kind, float dpiScale);
    void Hide();
    bool IsVisible() const { return visible_; }
    ~ToastWindow();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);
    void Paint();
    void Reposition();
    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    std::wstring title_;
    std::wstring message_;
    ToastKind kind_ = ToastKind::Info;
    float dpi_ = 1.0f;
    int width_ = 0;
    int height_ = 0;
};

struct FormField {
    std::wstring label;
    std::wstring value;
    std::wstring hint;
};

class FormWindow {
public:
    using AcceptCallback = std::function<std::wstring(const std::vector<std::wstring>&)>;

    bool Create(HWND owner);
    void Show(const std::wstring& title, const std::wstring& subtitle, const std::vector<FormField>& fields,
              const std::wstring& okText, const std::wstring& cancelText, AcceptCallback onAccept,
              float dpiScale);
    void Hide();
    bool IsVisible() const { return visible_; }
    ~FormWindow();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK EditSubclassProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT HandleEdit(HWND edit, UINT message, WPARAM wParam, LPARAM lParam);
    void Paint();
    void Layout();
    void CreateEditors();
    void DestroyEditors();
    void FocusField(int index, bool selectAll);
    void Submit();
    void RequestCancel();
    void SetError(const std::wstring& text);
    std::vector<std::wstring> ReadValues() const;

    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    float dpi_ = 1.0f;
    int width_ = 0;
    int height_ = 0;
    std::wstring title_;
    std::wstring subtitle_;
    std::wstring okText_;
    std::wstring cancelText_;
    std::wstring error_;
    std::vector<FormField> fields_;
    std::vector<HWND> edits_;
    std::vector<RECT> fieldBoxes_;
    RECT closeRect_{};
    RECT okRect_{};
    RECT cancelRect_{};
    bool hoverOk_ = false;
    bool hoverCancel_ = false;
    bool hoverClose_ = false;
    int activeField_ = -1;
    WNDPROC oldEditProc_ = nullptr;
    HFONT font_ = nullptr;
    HBRUSH editBrush_ = nullptr;
    AcceptCallback accept_;
};

class HelpWindow {
public:
    bool Create(HWND owner);
    void Show(float dpiScale);
    void Hide();
    bool IsVisible() const { return visible_; }
    ~HelpWindow();

private:
    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);
    void Paint();
    void Reposition();
    HWND owner_ = nullptr;
    HWND hwnd_ = nullptr;
    bool visible_ = false;
    bool hoverClose_ = false;
    RECT closeRect_{};
    float dpi_ = 1.0f;
    int width_ = 0;
    int height_ = 0;
};

} // namespace cl
