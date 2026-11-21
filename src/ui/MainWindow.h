#pragma once

#include "Commands.h"
#include "Icons.h"
#include "AppearanceWindow.h"
#include "Popups.h"
#include "Settings.h"
#include "UiDraw.h"
#include "Viewport.h"
#include "core/Crystal.h"
#include "render/Renderer.h"

#include <memory>
#include <string>
#include <vector>

namespace cl {

class MainWindow : public ViewportHost {
public:
    explicit MainWindow(const AppSettings& settings);
    ~MainWindow();

    bool Create(HINSTANCE instance);
    void Show(int commandShow);
    HACCEL Accelerators() const { return accelerators_; }
    HWND Hwnd() const { return hwnd_; }
    void OpenPath(const std::wstring& path);

    void OnViewportSelectionChanged(int atomIndex) override;
    void OnViewportMeasurementsChanged() override;
    void OnViewportHoverChanged(int atomIndex) override;
    void OnViewportModeChanged(MeasureMode mode) override;
    void OnViewportOpenRequested() override;
    void OnViewportFileDropped(const std::wstring& path) override;
    void OnViewportCommand(int commandId) override;

private:
    enum class HotspotKind { None, Command, OpenMenu, Slider, RemoveMeasurement };
    struct Hotspot {
        HotspotKind kind = HotspotKind::None;
        RECT rect{};
        int value = 0;
        bool enabled = true;
        std::wstring tooltip;
    };

    static LRESULT CALLBACK StaticWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);
    LRESULT WndProc(UINT message, WPARAM wParam, LPARAM lParam);

    void InitDarkTitleBar();
    void Relayout();
    void UpdateViewportBounds();
    void Paint();
    void PaintBackground(Painter& painter);
    void PaintMenuBar(Painter& painter);
    void PaintToolbar(Painter& painter);
    void PaintLeftPanel(Painter& painter);
    void PaintRightPanel(Painter& painter);
    void PaintStatusBar(Painter& painter);
    void PaintViewportFrame(Painter& painter);
    void PaintSectionLabel(Painter& painter, float x, float y, const std::wstring& text);
    void PaintSwitch(Painter& painter, float right, float centerY, bool on, bool enabled);
    void PaintToolButton(Painter& painter, const UiRect& rect, Icon icon, const std::wstring& label,
                         int command, const std::wstring& tooltip, bool active, bool enabled,
                         const UiColor& accent);
    void AddHotspot(HotspotKind kind, const RECT& rect, int value, bool enabled,
                    const std::wstring& tooltip = L"");
    bool HotspotHovered(HotspotKind kind, int value) const;
    int FindHotspot(int x, int y) const;
    void UpdateHover(int x, int y);
    void ShowTooltipForHotspot(int index);
    void HideTooltip();
    void OpenMenu(int menuIndex);
    std::vector<MenuEntry> BuildMenu(int menuIndex) const;
    void ExecuteCommand(int command);
    void ExecuteHotspot(const Hotspot& hotspot);
    void ToggleMeasureMode(MeasureMode mode);
    void ApplyOptions(bool save = true);
    void SaveSettingsNow();
    void UpdateTitle();
    void OpenFileDialog();
    void SaveScreenshotDialog();
    void SaveStructureDialog();
    void EditCellDialog();
    void SupercellDialog();
    void AppearanceDialog();
    void AddAtomDialog();
    void EditSelectedAtomDialog();
    void DeleteSelectedAtom();
    void Undo();
    void Redo();
    void PushUndoSnapshot();
    void CommitStructure(Structure&& candidate, bool preserveCamera, int selectIndex,
                         const std::wstring& status);
    void RefreshAfterEdit(int selectIndex, const std::wstring& status, bool preserveCamera);
    int SelectedSiteIndex() const;
    bool ConfirmDiscardChanges();
    void CopySummary();
    void ShowToast(const std::wstring& title, const std::wstring& message, ToastKind kind);
    void SetStatus(const std::wstring& text);
    void ResetHover();
    void ScrollPanel(bool left, int delta);
    void UpdateSliderFromX(int x);
    std::wstring CurrentFileName() const;
    std::wstring HoverStatusText() const;

    HINSTANCE instance_ = nullptr;
    HWND hwnd_ = nullptr;
    HACCEL accelerators_ = nullptr;
    UINT dpi_ = 96;
    float scale_ = 1.0f;
    int clientWidth_ = 1280;
    int clientHeight_ = 800;
    bool leftVisible_ = true;
    bool rightVisible_ = true;

    RECT menuBarRect_{};
    RECT toolbarRect_{};
    RECT statusRect_{};
    RECT leftPanelRect_{};
    RECT rightPanelRect_{};
    RECT viewportFrameRect_{};
    RECT viewportChildRect_{};
    bool viewportChildValid_ = false;
    RECT atomSliderTrack_{};
    RECT leftPanelInner_{};
    RECT rightPanelInner_{};
    float leftScroll_ = 0.0f;
    float rightScroll_ = 0.0f;
    float leftContentHeight_ = 0.0f;
    float rightContentHeight_ = 0.0f;
    RECT menuRects_[5]{};

    std::shared_ptr<Structure> structure_;
    std::wstring currentPath_;
    RenderOptions options_;
    bool modified_ = false;
    std::vector<Structure> undoStack_;
    std::vector<Structure> redoStack_;
    int selectedAtom_ = -1;
    int hoveredAtom_ = -1;
    std::wstring statusMessage_;
    std::wstring pendingTooltipText_;
    POINT tooltipAnchor_{};

    std::vector<Hotspot> hotspots_;
    HotspotKind hoveredKind_ = HotspotKind::None;
    int hoveredValue_ = 0;
    HotspotKind pressedKind_ = HotspotKind::None;
    int pressedValue_ = 0;
    bool pressed_ = false;
    bool sliderDragging_ = false;
    bool trackingLeave_ = false;
    int openMenu_ = -1;

    bool tooltipPending_ = false;
    bool tooltipShown_ = false;

    Viewport viewport_;
    MenuPopup menu_;
    TooltipWindow tooltip_;
    ToastWindow toast_;
    FormWindow form_;
    HelpWindow help_;
    AppearanceWindow appearance_;

    AppSettings initialSettings_;
};

} // namespace cl
