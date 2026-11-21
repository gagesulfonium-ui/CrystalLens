#include "Icons.h"

#include <algorithm>
#include <cmath>

namespace cl {
namespace {

void StylePen(Gdiplus::Pen& pen, float width) {
    pen.SetLineCap(Gdiplus::LineCapRound, Gdiplus::LineCapRound, Gdiplus::DashCapRound);
    pen.SetLineJoin(Gdiplus::LineJoinRound);
    pen.SetWidth(width);
}

void DrawCircle(Gdiplus::Graphics& g, const UiColor& color, float cx, float cy, float radius, bool filled,
                float thickness = 1.7f) {
    if (filled) {
        Gdiplus::SolidBrush brush(color);
        g.FillEllipse(&brush, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
        Gdiplus::Pen pen(color, thickness);
        StylePen(pen, thickness);
        g.DrawEllipse(&pen, cx - radius, cy - radius, radius * 2, radius * 2);
    }
}

void DrawArrowHead(Gdiplus::Graphics& g, const UiColor& color, float tipX, float tipY, float angle,
                   float length, float thickness) {
    Gdiplus::Pen pen(color, thickness);
    StylePen(pen, thickness);
    const float a1 = angle + 2.55f;
    const float a2 = angle - 2.55f;
    g.DrawLine(&pen, tipX, tipY, tipX + std::cos(a1) * length, tipY + std::sin(a1) * length);
    g.DrawLine(&pen, tipX, tipY, tipX + std::cos(a2) * length, tipY + std::sin(a2) * length);
}

} // namespace

void DrawLogo(Gdiplus::Graphics& graphics, const UiRect& box, bool detailed) {
    Gdiplus::GraphicsState state = graphics.Save();
    graphics.TranslateTransform(box.X, box.Y);
    const float s = std::min(box.Width, box.Height);
    graphics.ScaleTransform(s / 24.0f, s / 24.0f);

    Gdiplus::PointF silhouettePoints[] = {{12.0f, 1.2f}, {21.2f, 7.3f}, {18.4f, 18.8f},
                                          {12.0f, 22.8f}, {5.6f, 18.8f}, {2.8f, 7.3f}};
    Gdiplus::GraphicsPath silhouette;
    silhouette.AddPolygon(silhouettePoints, 6);
    Gdiplus::LinearGradientBrush gradient(UiRect(2, 1, 20, 22), Theme::kAccentLight, Theme::kTeal,
                                          Gdiplus::LinearGradientModeForwardDiagonal);
    graphics.FillPath(&gradient, &silhouette);
    Gdiplus::Pen edge(UiColor(160, 236, 246, 255), 0.8f);
    StylePen(edge, 0.8f);
    graphics.DrawPath(&edge, &silhouette);

    if (detailed) {
        Gdiplus::Pen facet(UiColor(115, 8, 16, 35), 0.75f);
        StylePen(facet, 0.75f);
        graphics.DrawLine(&facet, 12.0f, 1.2f, 12.0f, 22.8f);
        graphics.DrawLine(&facet, 2.8f, 7.3f, 12.0f, 12.2f);
        graphics.DrawLine(&facet, 21.2f, 7.3f, 12.0f, 12.2f);
        graphics.DrawLine(&facet, 5.6f, 18.8f, 12.0f, 12.2f);
        graphics.DrawLine(&facet, 18.4f, 18.8f, 12.0f, 12.2f);
        Gdiplus::SolidBrush shine(UiColor(190, 255, 255, 255));
        graphics.FillEllipse(&shine, 9.3f, 3.7f, 2.6f, 2.6f);
    }
    graphics.Restore(state);
}

void DrawIcon(Gdiplus::Graphics& graphics, Icon icon, const UiRect& box, const UiColor& color, float strokeScale) {
    Gdiplus::GraphicsState state = graphics.Save();
    const float size = std::min(box.Width, box.Height);
    graphics.TranslateTransform(box.X + (box.Width - size) * 0.5f, box.Y + (box.Height - size) * 0.5f);
    graphics.ScaleTransform(size / 24.0f, size / 24.0f);
    const float stroke = std::max(1.15f, 1.65f * strokeScale);
    Gdiplus::Pen pen(color, stroke);
    StylePen(pen, stroke);
    Gdiplus::SolidBrush brush(color);
    Gdiplus::Pen thin(color, std::max(0.9f, stroke * 0.66f));
    StylePen(thin, std::max(0.9f, stroke * 0.66f));

    switch (icon) {
    case Icon::Open: {
        Gdiplus::GraphicsPath path;
        path.AddLine(2.6f, 19.6f, 2.6f, 6.6f);
        path.AddLine(2.6f, 6.6f, 9.0f, 6.6f);
        path.AddLine(9.0f, 6.6f, 11.2f, 9.0f);
        path.AddLine(11.2f, 9.0f, 21.4f, 9.0f);
        path.AddLine(21.4f, 9.0f, 21.4f, 19.6f);
        path.CloseFigure();
        graphics.DrawPath(&pen, &path);
        graphics.DrawLine(&thin, 5.0f, 12.5f, 18.6f, 12.5f);
        break;
    }
    case Icon::Reload: {
        graphics.DrawArc(&pen, 4.0f, 4.0f, 16.0f, 16.0f, -52.0f, 286.0f);
        DrawArrowHead(graphics, color, 17.2f, 4.8f, -0.75f, 4.6f, stroke);
        break;
    }
    case Icon::Camera: {
        Gdiplus::GraphicsPath body;
        AddRoundedRectPath(body, UiRect(2.8f, 7.0f, 18.4f, 12.7f), 2.2f);
        graphics.DrawPath(&pen, &body);
        graphics.DrawRectangle(&pen, 8.5f, 4.6f, 7.0f, 3.0f);
        DrawCircle(graphics, color, 12.0f, 13.2f, 4.0f, false, stroke);
        DrawCircle(graphics, color, 18.0f, 10.1f, 0.8f, true);
        break;
    }
    case Icon::Reset: {
        graphics.DrawArc(&pen, 4.4f, 4.4f, 15.2f, 15.2f, 32.0f, 280.0f);
        DrawArrowHead(graphics, color, 5.0f, 6.0f, -2.4f, 4.4f, stroke);
        DrawCircle(graphics, color, 12.0f, 12.0f, 1.4f, true);
        break;
    }
    case Icon::Fit: {
        graphics.DrawLine(&pen, 3.2f, 8.0f, 3.2f, 3.2f);
        graphics.DrawLine(&pen, 3.2f, 3.2f, 8.0f, 3.2f);
        graphics.DrawLine(&pen, 16.0f, 3.2f, 20.8f, 3.2f);
        graphics.DrawLine(&pen, 20.8f, 3.2f, 20.8f, 8.0f);
        graphics.DrawLine(&pen, 20.8f, 16.0f, 20.8f, 20.8f);
        graphics.DrawLine(&pen, 20.8f, 20.8f, 16.0f, 20.8f);
        graphics.DrawLine(&pen, 8.0f, 20.8f, 3.2f, 20.8f);
        graphics.DrawLine(&pen, 3.2f, 20.8f, 3.2f, 16.0f);
        DrawCircle(graphics, color, 12.0f, 12.0f, 1.7f, true);
        break;
    }
    case Icon::Cube: {
        Gdiplus::PointF points[] = {{12.0f, 2.2f}, {21.0f, 7.2f}, {21.0f, 17.1f}, {12.0f, 22.1f},
                                    {3.0f, 17.1f}, {3.0f, 7.2f}};
        graphics.DrawPolygon(&pen, points, 6);
        graphics.DrawLine(&thin, 3.0f, 7.2f, 12.0f, 12.1f);
        graphics.DrawLine(&thin, 21.0f, 7.2f, 12.0f, 12.1f);
        graphics.DrawLine(&thin, 12.0f, 12.1f, 12.0f, 22.1f);
        break;
    }
    case Icon::Cell: {
        Gdiplus::PointF points[] = {{5.0f, 4.0f}, {19.0f, 4.0f}, {19.0f, 18.0f}, {5.0f, 18.0f}};
        graphics.DrawPolygon(&pen, points, 4);
        graphics.DrawLine(&thin, 5.0f, 4.0f, 8.6f, 7.4f);
        graphics.DrawLine(&thin, 19.0f, 4.0f, 15.4f, 7.4f);
        graphics.DrawLine(&thin, 5.0f, 18.0f, 8.6f, 14.6f);
        graphics.DrawLine(&thin, 19.0f, 18.0f, 15.4f, 14.6f);
        graphics.DrawLine(&thin, 8.6f, 7.4f, 15.4f, 7.4f);
        graphics.DrawLine(&thin, 8.6f, 7.4f, 8.6f, 14.6f);
        graphics.DrawLine(&thin, 15.4f, 7.4f, 15.4f, 14.6f);
        graphics.DrawLine(&thin, 8.6f, 14.6f, 15.4f, 14.6f);
        DrawCircle(graphics, color, 5.0f, 4.0f, 1.3f, true);
        DrawCircle(graphics, color, 19.0f, 18.0f, 1.3f, true);
        break;
    }
    case Icon::Bond: {
        graphics.DrawLine(&pen, 8.0f, 16.0f, 16.0f, 8.0f);
        DrawCircle(graphics, color, 7.2f, 16.8f, 3.0f, false, stroke);
        DrawCircle(graphics, color, 16.8f, 7.2f, 3.0f, false, stroke);
        break;
    }
    case Icon::Label: {
        Gdiplus::PointF tagPoints[] = {{3.0f, 5.0f}, {13.4f, 5.0f}, {20.6f, 12.0f},
                                       {12.7f, 19.8f}, {3.0f, 19.8f}};
        Gdiplus::GraphicsPath tag;
        tag.AddPolygon(tagPoints, 5);
        graphics.DrawPath(&pen, &tag);
        DrawCircle(graphics, color, 7.5f, 8.7f, 1.2f, true);
        break;
    }
    case Icon::Ruler: {
        Gdiplus::GraphicsState s2 = graphics.Save();
        graphics.TranslateTransform(12.0f, 12.0f);
        graphics.RotateTransform(-45.0f);
        Gdiplus::GraphicsPath ruler;
        AddRoundedRectPath(ruler, UiRect(-9.5f, -3.1f, 19.0f, 6.2f), 1.2f);
        graphics.DrawPath(&pen, &ruler);
        for (int i = -6; i <= 6; i += 3) {
            graphics.DrawLine(&thin, static_cast<float>(i), -3.1f, static_cast<float>(i), -1.0f);
        }
        graphics.Restore(s2);
        DrawCircle(graphics, color, 3.6f, 20.4f, 1.3f, true);
        DrawCircle(graphics, color, 20.4f, 3.6f, 1.3f, true);
        break;
    }
    case Icon::Angle: {
        graphics.DrawLine(&pen, 4.4f, 19.0f, 11.3f, 6.3f);
        graphics.DrawLine(&pen, 11.3f, 6.3f, 20.2f, 16.0f);
        graphics.DrawArc(&thin, 8.2f, 9.8f, 8.2f, 8.2f, 15.0f, 68.0f);
        DrawCircle(graphics, color, 11.3f, 6.3f, 1.15f, true);
        DrawCircle(graphics, color, 4.4f, 19.0f, 1.1f, true);
        DrawCircle(graphics, color, 20.2f, 16.0f, 1.1f, true);
        break;
    }
    case Icon::Trash: {
        graphics.DrawLine(&pen, 4.0f, 7.2f, 20.0f, 7.2f);
        graphics.DrawLine(&pen, 9.2f, 4.4f, 14.8f, 4.4f);
        graphics.DrawLine(&pen, 6.2f, 7.2f, 7.2f, 20.2f);
        graphics.DrawLine(&pen, 17.8f, 7.2f, 16.8f, 20.2f);
        graphics.DrawLine(&pen, 7.2f, 20.2f, 16.8f, 20.2f);
        graphics.DrawLine(&thin, 10.2f, 10.4f, 10.5f, 17.3f);
        graphics.DrawLine(&thin, 13.8f, 10.4f, 13.5f, 17.3f);
        break;
    }
    case Icon::PanelLeft: {
        Gdiplus::GraphicsPath path;
        AddRoundedRectPath(path, UiRect(3.0f, 4.0f, 18.0f, 16.0f), 2.4f);
        graphics.DrawPath(&pen, &path);
        Gdiplus::SolidBrush fill(UiColor(70, color.GetR(), color.GetG(), color.GetB()));
        graphics.FillRectangle(&fill, 4.0f, 5.0f, 5.2f, 14.0f);
        graphics.DrawLine(&thin, 9.2f, 5.0f, 9.2f, 19.0f);
        break;
    }
    case Icon::PanelRight: {
        Gdiplus::GraphicsPath path;
        AddRoundedRectPath(path, UiRect(3.0f, 4.0f, 18.0f, 16.0f), 2.4f);
        graphics.DrawPath(&pen, &path);
        Gdiplus::SolidBrush fill(UiColor(70, color.GetR(), color.GetG(), color.GetB()));
        graphics.FillRectangle(&fill, 14.8f, 5.0f, 5.2f, 14.0f);
        graphics.DrawLine(&thin, 14.8f, 5.0f, 14.8f, 19.0f);
        break;
    }
    case Icon::Info: {
        DrawCircle(graphics, color, 12.0f, 12.0f, 8.8f, false, stroke);
        DrawCircle(graphics, color, 12.0f, 7.8f, 1.2f, true);
        graphics.DrawLine(&pen, 12.0f, 11.0f, 12.0f, 16.8f);
        break;
    }
    case Icon::Check: {
        graphics.DrawLine(&pen, 4.2f, 12.6f, 9.6f, 18.0f);
        graphics.DrawLine(&pen, 9.6f, 18.0f, 20.0f, 6.2f);
        break;
    }
    case Icon::Close: {
        graphics.DrawLine(&pen, 6.0f, 6.0f, 18.0f, 18.0f);
        graphics.DrawLine(&pen, 18.0f, 6.0f, 6.0f, 18.0f);
        break;
    }
    case Icon::ChevronLeft: {
        graphics.DrawLine(&pen, 15.0f, 5.0f, 8.0f, 12.0f);
        graphics.DrawLine(&pen, 8.0f, 12.0f, 15.0f, 19.0f);
        break;
    }
    case Icon::ChevronRight: {
        graphics.DrawLine(&pen, 9.0f, 5.0f, 16.0f, 12.0f);
        graphics.DrawLine(&pen, 16.0f, 12.0f, 9.0f, 19.0f);
        break;
    }
    case Icon::ChevronDown: {
        graphics.DrawLine(&pen, 5.0f, 9.0f, 12.0f, 16.0f);
        graphics.DrawLine(&pen, 12.0f, 16.0f, 19.0f, 9.0f);
        break;
    }
    }
    graphics.Restore(state);
}

} // namespace cl
