#pragma once

namespace cl {

enum CommandId : int {
    CmdNone = 0,
    CmdOpen = 1001,
    CmdReload,
    CmdScreenshot,
    CmdExit,
    CmdCopySummary,
    CmdClearMeasurements,
    CmdEditCell,
    CmdResetView,
    CmdFitView,
    CmdPerspective,
    CmdOrthographic,
    CmdToggleCell,
    CmdToggleBonds,
    CmdToggleLabels,
    CmdToggleAxes,
    CmdToggleLeftPanel,
    CmdToggleRightPanel,
    CmdBallStick,
    CmdSpaceFill,
    CmdLanguageChinese,
    CmdLanguageEnglish,
    CmdMeasureDistance,
    CmdMeasureAngle,
    CmdCancelMeasure,
    CmdHelp,
    CmdAbout,
    CmdSaveStructure,
    CmdUndo,
    CmdRedo,
    CmdAddAtom,
    CmdEditAtom,
    CmdDeleteAtom,
    CmdToggleImages,
    CmdSupercell,
    CmdAppearance,
    CmdPolyhedral
};

} // namespace cl
