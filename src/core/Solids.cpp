#include "Solids.h"
#include <set>

namespace cl {
namespace {
using Family = SolidFamily;
constexpr double eps = 1e-8;
Vec3 reflect(const Vec3& v, const Vec3& n) { return v - n * (2 * Dot(v,n)); }

// Orbit of a point in a spherical Coxeter triangle. Active mirrors have
// equal seed distance. For the two snubs only orientation-preserving pairs act.
std::vector<Vec3> orbit(int p, int q, int mask) {
    const double cp=std::cos(kPi/p), sp=std::sin(kPi/p), cq=std::cos(kPi/q);
    const Vec3 n[]={{1,0,0},{-cp,sp,0},{0,-cq/sp,std::sqrt(1-cq*cq/(sp*sp))}};
    double d0=mask&1 ? 1:0, d1=mask&2 ? 1:0, d2=mask&4 ? 1:0;
    if (mask==0) {
        // Equal chords under mirror pairs 01, 12 and 20.
        d0=d1=d2=1;
        for (int i=0;i<48;++i) {
            d2=std::sqrt(1+2*cp*d0);
            d0=std::sqrt(1+2*cq*d2);
        }
    }
    const double y=(d1+cp*d0)/sp;
    std::vector<Vec3> points{Normalize({d0,y,(d2-y*n[2].y)/n[2].z})};
    for (size_t i=0;i<points.size();++i) {
        const Vec3 point=points[i];
        for (int j=0;j<3;++j) {
            Vec3 v=reflect(point,n[j]);
            if (!mask) v=reflect(v,n[(j+1)%3]);
            if (std::none_of(points.begin(),points.end(),[&](const Vec3& a){return LengthSq(a-v)<eps*eps;}))
                points.push_back(v);
        }
    }
    return points;
}

void orderFace(const std::vector<Vec3>& v, std::vector<int>& face, Vec3 normal) {
    Vec3 center;
    for (int i:face) center+=v[i];
    center=center/double(face.size());
    if (Dot(normal,center)<0) normal=-normal;
    const Vec3 u=Normalize(v[face.front()]-center), w=Cross(Normalize(normal),u);
    auto angle=[&](int i){return std::atan2(Dot(v[i]-center,w),Dot(v[i]-center,u));};
    std::sort(face.begin(),face.end(),[&](int a,int b){return angle(a)<angle(b);});
}

std::vector<std::vector<int>> convexFaces(const std::vector<Vec3>& v) {
    double edge2=4;
    for (size_t i=1;i<v.size();++i) edge2=std::min(edge2,LengthSq(v[i]-v[0]));
    std::set<std::vector<int>> known;
    std::vector<std::vector<int>> result;
    for (int i=0;i<int(v.size());++i) {
        std::vector<int> adjacent;
        for (int j=0;j<int(v.size());++j)
            if (std::abs(LengthSq(v[i]-v[j])-edge2)<eps) adjacent.push_back(j);
        for (size_t a=0;a<adjacent.size();++a) for (size_t b=0;b<a;++b) {
            Vec3 n=Normalize(Cross(v[adjacent[a]]-v[i],v[adjacent[b]]-v[i]));
            if (Dot(n,v[i])<0) n=-n;
            std::vector<int> face;
            for (int j=0;j<int(v.size());++j) {
                const double h=Dot(n,v[j]-v[i]);
                if (h>eps) {face.clear();break;}
                if (std::abs(h)<eps) face.push_back(j);
            }
            if (face.size()<3 || !known.insert(face).second) continue;
            orderFace(v,face,n);
            result.push_back(std::move(face));
        }
    }
    return result;
}

SolidMesh prism(int n, bool anti) {
    SolidMesh m;
    const double edge=2*std::sin(kPi/n);
    const double horizontal=2*std::sin(kPi/(2*n));
    const double halfHeight=0.5*(anti?std::sqrt(edge*edge-horizontal*horizontal):edge);
    for (int layer=0;layer<2;++layer) {
        std::vector<int> cap;
        for (int i=0;i<n;++i) {
            const double t=(2*i+(anti?layer:0))*kPi/n;
            m.vertices.push_back(Normalize({std::cos(t),std::sin(t),layer?halfHeight:-halfHeight}));
            cap.push_back(layer*n+i);
        }
        if (!layer) std::reverse(cap.begin(),cap.end());
        m.faces.push_back(std::move(cap));
    }
    for (int i=0;i<n;++i) {
        const int j=(i+1)%n;
        if (anti) {
            m.faces.push_back({i,j,n+i});
            m.faces.push_back({j,n+j,n+i});
        } else m.faces.push_back({i,j,n+j,n+i});
    }
    return m;
}

SolidMesh regularStar(int type) {
    // The great icosahedron uses the longer non-antipodal icosahedral chord.
    // The three dodecahedral forms are rings perpendicular to five-fold axes.
    const auto ico=orbit(5,3,4);
    SolidMesh m;
    m.vertices=type==2 ? orbit(5,3,1) : ico;
    if (type==3) {
        for (int i=0;i<12;++i) for (int j=0;j<i;++j) for (int k=0;k<j;++k) {
            auto longEdge=[&](int a,int b){return std::abs(Dot(ico[a],ico[b])+1/std::sqrt(5.0))<eps;};
            if (longEdge(i,j)&&longEdge(j,k)&&longEdge(k,i)) {
                std::vector<int> face{i,j,k};
                orderFace(ico,face,Cross(ico[j]-ico[i],ico[k]-ico[i]));
                m.faces.push_back(std::move(face));
            }
        }
    } else {
        for (const Vec3& axis:ico) {
            double height=1;
            for (const Vec3& p:m.vertices) {
                const double d=Dot(axis,p);
                if (d>eps) height=std::min(height,d);
            }
            std::vector<int> ring;
            for (int i=0;i<int(m.vertices.size());++i)
                if (std::abs(Dot(axis,m.vertices[i])-height)<eps) ring.push_back(i);
            orderFace(m.vertices,ring,axis);
            if (type==0) m.faces.push_back(ring);
            else m.faces.push_back({ring[0],ring[2],ring[4],ring[1],ring[3]});
        }
    }
    return m;
}
} // namespace

const std::vector<SolidPreset>& SolidPresets() {
    static const std::vector<SolidPreset> presets={
        {"tetra",L"正四面体",L"Tetrahedron",Family::Platonic,3,3,1},
        {"cube",L"正六面体",L"Cube",Family::Platonic,4,3,1},
        {"octa",L"正八面体",L"Octahedron",Family::Platonic,4,3,4},
        {"dodeca",L"正十二面体",L"Dodecahedron",Family::Platonic,5,3,1},
        {"icosa",L"正二十面体",L"Icosahedron",Family::Platonic,5,3,4},
        {"tr-tetra",L"截角四面体",L"Truncated tetrahedron",Family::Archimedean,3,3,3},
        {"cubocta",L"立方八面体",L"Cuboctahedron",Family::Archimedean,4,3,2},
        {"tr-cube",L"截角立方体",L"Truncated cube",Family::Archimedean,4,3,3},
        {"tr-octa",L"截角八面体",L"Truncated octahedron",Family::Archimedean,4,3,6},
        {"rh-cubocta",L"小斜方截半立方体",L"Rhombicuboctahedron",Family::Archimedean,4,3,5},
        {"tr-cubocta",L"大斜方截半立方体",L"Truncated cuboctahedron",Family::Archimedean,4,3,7},
        {"snub-cube",L"扭棱立方体",L"Snub cube",Family::Archimedean,4,3,0},
        {"icosidodeca",L"截半二十面体",L"Icosidodecahedron",Family::Archimedean,5,3,2},
        {"tr-dodeca",L"截角十二面体",L"Truncated dodecahedron",Family::Archimedean,5,3,3},
        {"tr-icosa",L"截角二十面体",L"Truncated icosahedron",Family::Archimedean,5,3,6},
        {"rh-icosidodeca",L"小斜方截半二十面体",L"Rhombicosidodecahedron",Family::Archimedean,5,3,5},
        {"tr-icosidodeca",L"大斜方截半二十面体",L"Truncated icosidodecahedron",Family::Archimedean,5,3,7},
        {"snub-dodeca",L"扭棱十二面体",L"Snub dodecahedron",Family::Archimedean,5,3,0},
        {"great-dodeca",L"大十二面体",L"Great dodecahedron",Family::Star,0,0,0},
        {"small-stellated",L"小星形十二面体",L"Small stellated dodecahedron",Family::Star,0,0,1},
        {"great-stellated",L"大星形十二面体",L"Great stellated dodecahedron",Family::Star,0,0,2},
        {"great-icosa",L"大二十面体",L"Great icosahedron",Family::Star,0,0,3},
        {"prism",L"正棱柱",L"Regular prism",Family::Prism,0,0,0},
        {"antiprism",L"正反棱柱",L"Regular antiprism",Family::Antiprism,0,0,0}
    };
    return presets;
}

SolidMesh MakeSolid(const SolidPreset& preset,int sides,bool mirror) {
    if (preset.family==Family::Prism || preset.family==Family::Antiprism)
        return prism(std::clamp(sides,3,256),preset.family==Family::Antiprism);
    if (preset.family==Family::Star) return regularStar(preset.mask);
    SolidMesh mesh;
    mesh.vertices=orbit(preset.p,preset.q,preset.mask);
    if (mirror && !preset.mask) for (Vec3& v:mesh.vertices) v.x=-v.x;
    mesh.faces=convexFaces(mesh.vertices);
    return mesh;
}
} // namespace cl
