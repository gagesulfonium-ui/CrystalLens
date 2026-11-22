#include "SolidViewer.h"
#include "Localization.h"
#include "core/SolidDocument.h"
#include "render/Camera.h"
#include "solid_ids.h"

#include <GL/gl.h>
#include <commdlg.h>
#include <windowsx.h>
#include <filesystem>
#include <fstream>
#include <set>

namespace cl {
namespace {
const wchar_t* tr(const wchar_t* zh,const wchar_t* en) { return I18n::IsChinese()?zh:en; }
enum class Gesture { None, Orbit, Pan, Vertex };
struct Viewer {
    HWND dlg{},canvas{};
    HDC dc{};
    HGLRC gl{};
    POINT minSize{},start{};
    SolidDocument doc=NewSolidDocument(0,5,false);
    struct UndoState { SolidDocument doc; uint64_t revision; };
    std::vector<UndoState> undo;
    std::vector<std::pair<int,int>> edges;
    Camera camera,dragCamera;
    int vertex=0;
    uint64_t revision=0, savedRevision=0, nextRevision=1;
    bool moved=false;
    Gesture gesture=Gesture::None;
    Vec3 initialVertex,grab;
    COLORREF colors[16]{};
    SIZE Size() const {
        RECT rc{}; GetClientRect(canvas,&rc);
        return {std::max(1L,rc.right),std::max(1L,rc.bottom)};
    }
    void DrawSoon() { InvalidateRect(canvas,nullptr,FALSE); }
    void Fit() {
        const auto sz=Size();
        camera.FitScenePoints(doc.mesh.vertices,double(sz.cx)/sz.cy,1.3);
        DrawSoon();
    }
    void Remember() {
        if (undo.size()>=24) undo.erase(undo.begin());
        undo.push_back({doc,revision});
        revision=nextRevision++;
        EnableWindow(GetDlgItem(dlg,IDS_UNDO),TRUE);
    }
    void Coordinates() {
        wchar_t value[64];
        for (int i=0;i<3;++i) {
            swprintf_s(value,L"%.10g",doc.mesh.vertices[vertex][i]);
            SetDlgItemTextW(dlg,IDS_X+i,value);
        }
        SendDlgItemMessageW(dlg,IDS_VERTEX,CB_SETCURSEL,vertex,0);
    }
    void Refresh() {
        std::set<std::pair<int,int>> unique;
        for (const auto& face:doc.mesh.faces) for (size_t i=0;i<face.size();++i)
            unique.insert(std::minmax(face[i],face[(i+1)%face.size()]));
        edges.assign(unique.begin(),unique.end());
        const auto& p=SolidPresets()[doc.preset];
        const bool n=p.family==SolidFamily::Prism || p.family==SolidFamily::Antiprism;
        for (int id:{IDS_N,IDS_N_TITLE,IDS_GENERATE}) EnableWindow(GetDlgItem(dlg,id),n);
        EnableWindow(GetDlgItem(dlg,IDS_MIRROR),p.family==SolidFamily::Archimedean && !p.mask);
        EnableWindow(GetDlgItem(dlg,IDS_UNDO),!undo.empty());
        SetDlgItemInt(dlg,IDS_N,doc.sides,FALSE);
        CheckDlgButton(dlg,IDS_MIRROR,doc.mirror?BST_CHECKED:BST_UNCHECKED);
        CheckDlgButton(dlg,IDS_POINTS,doc.look.points?BST_CHECKED:BST_UNCHECKED);
        SendDlgItemMessageW(dlg,IDS_MODE,CB_SETCURSEL,doc.look.mode,0);
        SendDlgItemMessageW(dlg,IDS_PRESET,CB_SETCURSEL,doc.preset,0);
        HWND combo=GetDlgItem(dlg,IDS_VERTEX);
        SendMessageW(combo,WM_SETREDRAW,FALSE,0);
        SendMessageW(combo,CB_RESETCONTENT,0,0);
        for (size_t i=1;i<=doc.mesh.vertices.size();++i) {
            const auto name=std::to_wstring(i);
            SendMessageW(combo,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(name.c_str()));
        }
        vertex=std::clamp(vertex,0,int(doc.mesh.vertices.size())-1);
        Coordinates();
        SendMessageW(combo,WM_SETREDRAW,TRUE,0);
        InvalidateRect(combo,nullptr,TRUE);
        wchar_t stats[128];
        swprintf_s(stats,tr(L"%zu 个顶点     %zu 条棱     %zu 个面",L"%zu vertices     %zu edges     %zu faces"),
                   doc.mesh.vertices.size(),edges.size(),doc.mesh.faces.size());
        SetDlgItemTextW(dlg,IDS_STATS,stats);
        DrawSoon();
    }
};

void color(uint32_t rgb,double light=1) {
    glColor3d(((rgb>>16)&255)*light/255,((rgb>>8)&255)*light/255,(rgb&255)*light/255);
}
void point(const Vec3& p) { glVertex3d(p.x,p.y,p.z); }
void draw(Viewer& s) {
    const HGLRC previous=wglGetCurrentContext();
    const HDC prevDC=wglGetCurrentDC();
    if (!s.gl || !wglMakeCurrent(s.dc,s.gl)) return;
    const auto sz=s.Size();
    glViewport(0,0,sz.cx,sz.cy);
    const auto& look=s.doc.look;
    glClearColor(((look.background>>16)&255)/255.f,((look.background>>8)&255)/255.f,(look.background&255)/255.f,1);
    glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glEnable(GL_DEPTH_TEST);
    glDepthFunc(GL_LEQUAL);
    glMatrixMode(GL_PROJECTION); glLoadMatrixf(s.camera.ProjectionMatrix(sz.cx,sz.cy).m);
    glMatrixMode(GL_MODELVIEW); glLoadMatrixf(s.camera.ViewMatrix().m);
    const auto& m=s.doc.mesh;
    if (look.mode!=2) {
        const Vec3 lamp=Normalize(s.camera.Up()*0.75-s.camera.Right()*0.45-s.camera.Forward());
        glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(1,1);
        glBegin(GL_TRIANGLES);
        for (const auto& face:m.faces) {
            Vec3 center;
            for (int i:face) center+=m.vertices[i];
            center=center/double(face.size());
            // A center fan also fills a pentagram's non-zero winding region.
            for (size_t i=0;i<face.size();++i) {
                const auto& a=m.vertices[face[i]];
                const auto& b=m.vertices[face[(i+1)%face.size()]];
                const Vec3 normal=Normalize(Cross(a-center,b-center));
                color(look.face,0.38+0.62*std::max(0.0,Dot(normal,lamp)));
                point(center);point(a);point(b);
            }
        }
        glEnd(); glDisable(GL_POLYGON_OFFSET_FILL);
    }
    if (look.mode!=1) {
        color(look.edge); glLineWidth(1.5f); glBegin(GL_LINES);
        for (auto [a,b]:s.edges) { point(m.vertices[a]);point(m.vertices[b]); }
        glEnd();
    }
    if (look.points) {
        color(look.edge); glPointSize(4); glBegin(GL_POINTS);
        for (const Vec3& v:m.vertices) point(v);
        glEnd();
        glPointSize(8); glBegin(GL_POINTS); color(0xFFB64A); point(m.vertices[s.vertex]); glEnd();
    }
    SwapBuffers(s.dc);
    wglMakeCurrent(prevDC,previous);
}

int pick(const Viewer& s,int x,int y) {
    const auto sz=s.Size();
    const double radius=9.0*GetDpiForWindow(s.canvas)/96;
    double best=radius*radius,depth=1e20;
    int hit=-1;
    for (int i=0;i<int(s.doc.mesh.vertices.size());++i) {
        const auto p=s.camera.WorldToScreen(s.doc.mesh.vertices[i],sz.cx,sz.cy);
        if (!p.visible) continue;
        const double dist=(x-p.x)*(x-p.x)+(y-p.y)*(y-p.y);
        if (dist<best-0.01 || (std::abs(dist-best)<0.01 && p.depth<depth)) {
            hit=i;best=dist;depth=p.depth;
        }
    }
    return hit;
}
Vec3 onPlane(const Viewer& s,int x,int y) {
    const auto sz=s.Size();
    const Ray ray=s.dragCamera.ScreenRay(x,y,sz.cx,sz.cy);
    const Vec3 n=s.dragCamera.Forward();
    return ray.origin+ray.direction*(Dot(s.initialVertex-ray.origin,n)/Dot(ray.direction,n));
}
void move(Viewer& s,int x,int y) {
    const double dx=x-s.start.x,dy=y-s.start.y;
    if (!s.moved && std::hypot(dx,dy)<3.0*GetDpiForWindow(s.canvas)/96) return;
    const auto sz=s.Size();
    if (s.gesture==Gesture::Vertex) {
        const Vec3 next=s.initialVertex+onPlane(s,x,y)-s.grab;
        if (std::max({std::abs(next.x),std::abs(next.y),std::abs(next.z)})>10000) return;
        if (!s.moved) s.Remember();
        s.doc.mesh.vertices[s.vertex]=next;
        s.Coordinates();
    } else if (s.gesture==Gesture::Orbit) {
        s.camera.OrbitFromDrag(s.dragCamera,dx,dy,sz.cx,sz.cy);
    } else if (s.gesture==Gesture::Pan) {
        s.camera=s.dragCamera;
        s.camera.Pan(dx,dy,sz.cx,sz.cy);
    }
    s.moved=true;
    s.DrawSoon();
}
void endGesture(Viewer& s) {
    s.gesture=Gesture::None;
    if (GetCapture()==s.canvas) ReleaseCapture();
}
LRESULT CALLBACK canvasProc(HWND h,UINT msg,WPARAM wp,LPARAM lp) {
    auto* s=reinterpret_cast<Viewer*>(GetWindowLongPtrW(h,GWLP_USERDATA));
    if (!s) return DefWindowProcW(h,msg,wp,lp);
    const int x=GET_X_LPARAM(lp),y=GET_Y_LPARAM(lp);
    switch (msg) {
    case WM_ERASEBKGND:return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps{}; BeginPaint(h,&ps); draw(*s); EndPaint(h,&ps); return 0;
    }
    case WM_LBUTTONDOWN: case WM_RBUTTONDOWN: {
        if (s->gesture!=Gesture::None) return 0;
        SetFocus(h);
        s->dragCamera=s->camera;s->start={x,y};s->moved=false;
        if (msg==WM_LBUTTONDOWN && (wp&MK_CONTROL)) {
            const int hit=pick(*s,x,y);
            if (hit<0) return 0;
            s->vertex=hit;s->Coordinates();
            s->initialVertex=s->doc.mesh.vertices[hit];s->grab=onPlane(*s,x,y);
            s->gesture=Gesture::Vertex;
        } else s->gesture=msg==WM_LBUTTONDOWN?Gesture::Orbit:Gesture::Pan;
        SetCapture(h);s->DrawSoon();return 0;
    }
    case WM_MOUSEMOVE:
        if (s->gesture!=Gesture::None) move(*s,x,y);
        return 0;
    case WM_LBUTTONUP: case WM_RBUTTONUP:
        if (s->gesture!=Gesture::None && (msg==WM_RBUTTONUP)==(s->gesture==Gesture::Pan)) {
            move(*s,x,y);
            if (!s->moved && s->gesture==Gesture::Orbit) {
                const int hit=pick(*s,x,y);
                if (hit>=0) {s->vertex=hit;s->Coordinates();s->DrawSoon();}
            }
            endGesture(*s);
        }
        return 0;
    case WM_CANCELMODE:case WM_CAPTURECHANGED:case WM_KILLFOCUS:endGesture(*s);break;
    case WM_MOUSEWHEEL: {
        endGesture(*s);POINT p{x,y};ScreenToClient(h,&p);
        const auto sz=s->Size();
        s->camera.ZoomAt(double(GET_WHEEL_DELTA_WPARAM(wp))/WHEEL_DELTA,p.x,p.y,sz.cx,sz.cy);
        s->DrawSoon();return 0;
    }
    }
    return DefWindowProcW(h,msg,wp,lp);
}

void error(HWND dlg,const wchar_t* zh,const wchar_t* en) {
    MessageBoxW(dlg,tr(zh,en),T(Str::SolidViewer),MB_ICONWARNING|MB_OK);
}
bool fileDialog(Viewer& s,bool save) {
    wchar_t filename[32768]{};
    OPENFILENAMEW of{sizeof(of)};
    of.hwndOwner=s.dlg;of.lpstrFile=filename;of.nMaxFile=32768;
    of.lpstrFilter=L"CrystalLens polyhedron (*.clpoly)\0*.clpoly\0\0";
    of.lpstrDefExt=L"clpoly";
    of.Flags=OFN_EXPLORER|OFN_NOCHANGEDIR|OFN_PATHMUSTEXIST|(save?OFN_OVERWRITEPROMPT:OFN_FILEMUSTEXIST);
    if (!(save?GetSaveFileNameW(&of):GetOpenFileNameW(&of))) return false;
    const std::filesystem::path path(filename);
    if (save) {
        wchar_t temp[MAX_PATH]{};
        if (GetTempFileNameW(path.parent_path().c_str(),L"CLP",0,temp)) {
            std::ofstream out(std::filesystem::path(temp),std::ios::binary);
            const bool wrote=WriteSolidDocument(out,s.doc);
            out.close();
            if (wrote && out && MoveFileExW(temp,filename,MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)) {
                s.savedRevision=s.revision;return true;
            }
            DeleteFileW(temp);
        }
        error(s.dlg,L"无法保存模型文件。",L"Could not save the model file.");
    } else {
        std::ifstream in(path,std::ios::binary);
        SolidDocument doc;
        if (ReadSolidDocument(in,doc)) {
            s.doc=std::move(doc);s.undo.clear();s.savedRevision=s.revision;s.vertex=0;
            s.Refresh();s.Fit();return true;
        }
        error(s.dlg,L"无法读取此模型文件。",L"Could not read this model file.");
    }
    return false;
}
bool mayReplace(Viewer& s) {
    if (s.revision==s.savedRevision) return true;
    const int answer=MessageBoxW(s.dlg,tr(L"保存当前模型的修改？",L"Save changes to the current model?"),
                                  T(Str::SolidViewer),MB_YESNOCANCEL|MB_ICONQUESTION);
    return answer==IDNO || (answer==IDYES && fileDialog(s,true));
}
void chooseColor(Viewer& s,uint32_t& value) {
    CHOOSECOLORW dialog{sizeof(dialog)};
    dialog.hwndOwner=s.dlg;dialog.lpCustColors=s.colors;
    dialog.rgbResult=RGB((value>>16)&255,(value>>8)&255,value&255);
    dialog.Flags=CC_RGBINIT|CC_FULLOPEN;
    if (!ChooseColorW(&dialog)) return;
    s.Remember();
    value=(GetRValue(dialog.rgbResult)<<16)|(GetGValue(dialog.rgbResult)<<8)|GetBValue(dialog.rgbResult);
    s.DrawSoon();
}
void editPoint(Viewer& s) {
    Vec3 point;
    for (int i=0;i<3;++i) {
        wchar_t input[64]{};
        GetDlgItemTextW(s.dlg,IDS_X+i,input,64);
        wchar_t* end=nullptr;
        point[i]=std::wcstod(input,&end);
        if (end==input || *end || !std::isfinite(point[i]) || std::abs(point[i])>10000) {
            error(s.dlg,L"请输入 −10000 到 10000 之间的有效坐标。",L"Enter coordinates between -10000 and 10000.");
            return;
        }
    }
    if (LengthSq(point-s.doc.mesh.vertices[s.vertex])>1e-20) {
        s.Remember();s.doc.mesh.vertices[s.vertex]=point;s.Fit();
    }
}

void initializeControls(Viewer& s) {
    const struct {int id;const wchar_t* zh;const wchar_t* en;} labels[]={
        {IDS_PRESET_TITLE,L"模型",L"Model"},{IDS_N_TITLE,L"边数",L"Sides"},
        {IDS_GENERATE,L"生成 (3–256)",L"Generate (3–256)"},{IDS_MIRROR,L"扭棱模型镜像",L"Mirror snub model"},
        {IDS_VERTEX_TITLE,L"顶点",L"Vertex"},{IDS_APPLY,L"应用坐标",L"Apply XYZ"},
        {IDS_UNDO,L"撤销修改",L"Undo edit"},{IDS_LOOK_TITLE,L"外观",L"Appearance"},
        {IDS_POINTS,L"显示顶点",L"Show vertices"},{IDS_FACE,L"面颜色",L"Face color"},
        {IDS_EDGE,L"棱颜色",L"Edge color"},{IDS_BG,L"背景色",L"Backdrop"},
        {IDS_FIT,L"适配视图",L"Fit view"},{IDS_RESET,L"还原模型",L"Restore model"},
        {IDS_OPEN,L"打开模型…",L"Open model…"},{IDS_SAVE,L"保存模型…",L"Save model…"},
        {IDS_HINT,L"左拖旋转 · 右拖平移 · 滚轮缩放 · Ctrl + 左拖顶点编辑",
                  L"Left drag: rotate   ·   Right drag: pan   ·   Wheel: zoom   ·   Ctrl + drag: move vertex"}
    };
    SetWindowTextW(s.dlg,T(Str::SolidViewer));
    for (auto& l:labels) SetDlgItemTextW(s.dlg,l.id,tr(l.zh,l.en));
    for (const auto& p:SolidPresets()) SendDlgItemMessageW(s.dlg,IDS_PRESET,CB_ADDSTRING,0,
        reinterpret_cast<LPARAM>(tr(p.zh,p.en)));
    for (auto label:{tr(L"面和棱",L"Faces and edges"),tr(L"仅面",L"Faces only"),tr(L"线框",L"Wireframe")})
        SendDlgItemMessageW(s.dlg,IDS_MODE,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(label));
    for (int i=0;i<3;++i) SendDlgItemMessageW(s.dlg,IDS_X+i,EM_SETLIMITTEXT,50,0);
    SendDlgItemMessageW(s.dlg,IDS_N,EM_SETLIMITTEXT,3,0);
}
void layout(Viewer& s) {
    RECT client{};GetClientRect(s.dlg,&client);
    RECT units{174,8,8,44};MapDialogRect(s.dlg,&units);
    const int w=std::max(1L,client.right-units.left-units.right);
    const int h=std::max(1L,client.bottom-units.top-units.bottom);
    MoveWindow(s.canvas,units.left,units.top,w,h,TRUE);
    const int line=units.bottom/2;
    MoveWindow(GetDlgItem(s.dlg,IDS_STATS),units.left,units.top+h+3,w,line-3,TRUE);
    MoveWindow(GetDlgItem(s.dlg,IDS_HINT),units.left,units.top+h+line,w,line,TRUE);
    s.DrawSoon();
}
bool initGL(Viewer& s) {
    s.dc=GetDC(s.canvas);
    PIXELFORMATDESCRIPTOR pf{sizeof(pf),1};
    pf.dwFlags=PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER;
    pf.iPixelType=PFD_TYPE_RGBA;pf.cColorBits=24;pf.cDepthBits=24;pf.iLayerType=PFD_MAIN_PLANE;
    const int format=ChoosePixelFormat(s.dc,&pf);
    if (!format || !SetPixelFormat(s.dc,format,&pf)) return false;
    s.gl=wglCreateContext(s.dc);
    const auto previous=wglGetCurrentContext();
    const auto prevDC=wglGetCurrentDC();
    if (!s.gl || !wglMakeCurrent(s.dc,s.gl)) return false;
    return wglMakeCurrent(prevDC,previous)!=FALSE;
}
INT_PTR CALLBACK viewerProc(HWND dlg,UINT msg,WPARAM wp,LPARAM lp) {
    auto* s=reinterpret_cast<Viewer*>(GetWindowLongPtrW(dlg,DWLP_USER));
    if (msg==WM_INITDIALOG) {
        s=reinterpret_cast<Viewer*>(lp);s->dlg=dlg;s->canvas=GetDlgItem(dlg,IDS_CANVAS);
        SetWindowLongPtrW(dlg,DWLP_USER,lp);SetWindowLongPtrW(s->canvas,GWLP_USERDATA,lp);
        RECT rc{};GetWindowRect(dlg,&rc);s->minSize={rc.right-rc.left,rc.bottom-rc.top};
        if (!initGL(*s)) {EndDialog(dlg,-1);return TRUE;}
        initializeControls(*s);layout(*s);s->Refresh();s->Fit();
        return TRUE;
    }
    if (!s) return FALSE;
    if (msg==WM_SIZE) {layout(*s);return TRUE;}
    if (msg==WM_GETMINMAXINFO) {reinterpret_cast<MINMAXINFO*>(lp)->ptMinTrackSize=s->minSize;return TRUE;}
    if (msg==WM_DESTROY) {
        if (s->gl) {if (wglGetCurrentContext()==s->gl) wglMakeCurrent(nullptr,nullptr);wglDeleteContext(s->gl);}
        if (s->dc) ReleaseDC(s->canvas,s->dc);
        SetWindowLongPtrW(s->canvas,GWLP_USERDATA,0);
        return TRUE;
    }
    if (msg==WM_CLOSE || (msg==WM_COMMAND && LOWORD(wp)==IDCANCEL)) {
        if (mayReplace(*s)) EndDialog(dlg,IDCANCEL);
        return TRUE;
    }
    if (msg!=WM_COMMAND) return FALSE;
    const int id=LOWORD(wp),notice=HIWORD(wp);
    auto& d=s->doc;
    if ((id==IDS_PRESET && notice==CBN_SELCHANGE) || id==IDS_GENERATE || id==IDS_MIRROR) {
        const int model=static_cast<int>(SendDlgItemMessageW(dlg,IDS_PRESET,CB_GETCURSEL,0,0));
        int sides=d.sides;
        if (id==IDS_GENERATE) {
            BOOL valid; sides=GetDlgItemInt(dlg,IDS_N,&valid,FALSE);
            if (!valid || sides<3 || sides>256) {error(dlg,L"边数范围为 3–256。",L"Enter 3–256 sides.");return TRUE;}
        }
        const bool mirror=id==IDS_MIRROR && IsDlgButtonChecked(dlg,IDS_MIRROR)==BST_CHECKED;
        if (mayReplace(*s)) {
            d=NewSolidDocument(model,sides,mirror);s->vertex=0;s->savedRevision=s->revision;s->undo.clear();s->Fit();
        }
        s->Refresh();
    } else if (id==IDS_VERTEX && notice==CBN_SELCHANGE) {
        s->vertex=static_cast<int>(SendDlgItemMessageW(dlg,IDS_VERTEX,CB_GETCURSEL,0,0));s->Coordinates();s->DrawSoon();
    } else if (id==IDS_MODE && notice==CBN_SELCHANGE) {
        s->Remember();d.look.mode=static_cast<int>(SendDlgItemMessageW(dlg,IDS_MODE,CB_GETCURSEL,0,0));s->DrawSoon();
    } else if (id==IDS_POINTS) {
        s->Remember();d.look.points=IsDlgButtonChecked(dlg,id)==BST_CHECKED;s->DrawSoon();
    } else if (id==IDS_FACE) chooseColor(*s,d.look.face);
    else if (id==IDS_EDGE) chooseColor(*s,d.look.edge);
    else if (id==IDS_BG) chooseColor(*s,d.look.background);
    else if (id==IDS_APPLY || id==IDOK) editPoint(*s);
    else if (id==IDS_UNDO && !s->undo.empty()) {
        d=std::move(s->undo.back().doc);s->revision=s->undo.back().revision;s->undo.pop_back();s->Refresh();s->Fit();
    } else if (id==IDS_RESET) {
        s->Remember();d=NewSolidDocument(d.preset,d.sides,d.mirror);s->Refresh();s->Fit();
    } else if (id==IDS_FIT) s->Fit();
    else if (id==IDS_SAVE) fileDialog(*s,true);
    else if (id==IDS_OPEN && mayReplace(*s)) fileDialog(*s,false);
    else return FALSE;
    return TRUE;
}
} // namespace

void ShowSolidViewer(HWND owner) {
    WNDCLASSW wc{}; wc.style=CS_OWNDC|CS_HREDRAW|CS_VREDRAW;wc.lpfnWndProc=canvasProc;
    wc.hInstance=GetModuleHandleW(nullptr);wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);
    wc.lpszClassName=L"CrystalLensSolidCanvas";
    if (!RegisterClassW(&wc) && GetLastError()!=ERROR_CLASS_ALREADY_EXISTS) return;
    Viewer viewer;
    if (DialogBoxParamW(wc.hInstance,MAKEINTRESOURCEW(IDD_SOLIDS),owner,viewerProc,reinterpret_cast<LPARAM>(&viewer))==-1)
        error(owner,L"无法打开多面体视窗，请检查当前图形会话是否支持 OpenGL。",L"Could not open the polyhedron viewer. Check OpenGL support in this graphics session.");
}
} // namespace cl
