#include "core/SolidDocument.h"
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>

using namespace cl;
namespace {
void check(bool ok, const std::string& message) {
    if (!ok) throw std::runtime_error(message);
}
void verify(const SolidMesh& mesh, int vertices, int edges, int faces, const std::string& name) {
    check(mesh.vertices.size() == vertices && mesh.faces.size() == faces, name + " counts");
    std::map<std::pair<int,int>, int> uses, orient;
    const auto& v = mesh.vertices;
    const auto& first = mesh.faces.at(0);
    const double side = Length(v.at(first[1])-v.at(first[0]));
    for (const auto& f : mesh.faces) {
        check(f.size() >= 3 && std::set<int>(f.begin(),f.end()).size() == f.size(), name + " face indices");
        const Vec3 n = Normalize(Cross(v.at(f[1])-v.at(f[0]), v.at(f[2])-v.at(f[0])));
        check(Dot(n,v.at(f[0])) > 0, name + " outward winding");
        const double diagonal = LengthSq(v.at(f[2])-v.at(f[0]));
        for (size_t i=0; i<f.size(); ++i) {
            int a=f[i], b=f[(i+1)%f.size()], c=f[(i+2)%f.size()];
            check(std::abs(Length(v.at(a)-v.at(b))-side) < 1e-8, name + " equal edges");
            check(std::abs(LengthSq(v.at(a)-v.at(c))-diagonal) < 1e-8, name + " equal angles");
            check(std::abs(Dot(n,v.at(a)-v.at(f[0]))) < 1e-8, name + " coplanarity");
            auto edge=std::minmax(a,b);
            ++uses[edge];
            orient[edge] += (a<b ? 1 : -1);
        }
    }
    check(uses.size()==edges, name + " edge count");
    for (const auto& entry:uses) {
        check(entry.second==2 && orient[entry.first]==0, name + " oriented shared edges");
    }
}
void geometry() {
    const auto& presets=SolidPresets();
    // Canonical V/E/F counts in preset order, including the four Kepler-Poinsot solids.
    constexpr int counts[][3]={
        {4,6,4},{8,12,6},{6,12,8},{20,30,12},{12,30,20},
        {12,18,8},{12,24,14},{24,36,14},{24,36,14},{24,48,26},
        {48,72,26},{24,60,38},{30,60,32},{60,90,32},{60,90,32},
        {60,120,62},{120,180,62},{60,150,92},
        {12,30,12},{12,30,12},{20,30,12},{12,30,20}
    };
    const std::map<int,int> faceKinds[]={
        {{3,4}},{{4,6}},{{3,8}},{{5,12}},{{3,20}},
        {{3,4},{6,4}},{{3,8},{4,6}},{{3,8},{8,6}},{{4,6},{6,8}},
        {{3,8},{4,18}},{{4,12},{6,8},{8,6}},{{3,32},{4,6}},{{3,20},{5,12}},
        {{3,20},{10,12}},{{5,12},{6,20}},{{3,20},{4,30},{5,12}},
        {{4,30},{6,20},{10,12}},{{3,80},{5,12}},{{5,12}},{{5,12}},{{5,12}},{{3,20}}
    };
    check(presets.size()==24, "preset catalog");
    for (int i=0;i<22;++i) {
        const auto& p=presets.at(i);
        const auto m=MakeSolid(p);
        verify(m,counts[i][0],counts[i][1],counts[i][2],p.id);
        std::map<int,int> kinds;
        for (const auto& face:m.faces) ++kinds[static_cast<int>(face.size())];
        check(kinds==faceKinds[i],std::string(p.id)+" face types");
        if (p.family==SolidFamily::Star && m.faces.front().size()==5) {
            const auto& f=m.faces.front();
            Vec3 center;
            for (int v:f) center+=m.vertices[v];
            center=center/5.0;
            const double step=Dot(Normalize(m.vertices[f[0]]-center),Normalize(m.vertices[f[1]]-center));
            check(std::abs(step-std::cos((i==18 ? 2 : 4)*kPi/5))<1e-8,"pentagon or pentagram");
        }
        if (p.family==SolidFamily::Archimedean && !p.mask) {
            const auto mirror=MakeSolid(p,5,true);
            verify(mirror,counts[i][0],counts[i][1],counts[i][2],p.id);
            for (size_t k=0;k<m.vertices.size();++k) {
                const auto a=m.vertices[k], b=mirror.vertices[k];
                check(LengthSq(Vec3(-a.x,a.y,a.z)-b)<1e-16, "snub chirality");
            }
        }
    }
    for (int n:{3,4,7,31,256}) {
        verify(MakeSolid(presets[22],n),2*n,3*n,n+2,"prism");
        verify(MakeSolid(presets[23],n),2*n,4*n,2*n+2,"antiprism");
    }
}
void documents() {
    auto edited=NewSolidDocument(17,7,true);
    edited.mesh.vertices[2]={1.125,-4.0,0.125};
    edited.look={0xABCDEF,0xF0054E,0x110055,2,false};
    std::ostringstream out;
    check(WriteSolidDocument(out,edited),"write");
    auto read=NewSolidDocument(1,3,false);
    std::istringstream input(out.str());
    check(ReadSolidDocument(input,read),"read");
    std::ostringstream copy;
    check(WriteSolidDocument(copy,read) && copy.str()==out.str() && read.mesh.faces==edited.mesh.faces, "lossless document");
    const std::string tetra="CrystalLensPoly 1\ntetra 5 0\n16777215 0 0 0 1\n4\n";
    for (const auto& bad:std::vector<std::string>{"",out.str()+"junk",tetra+"1 2 3",
        tetra+"10001 0 0\n0 0 0\n0 0 0\n0 0 0\n","CrystalLensPoly 2", "CrystalLensPoly 1 absent 5 0 0 0 0 0 0 1",
        "CrystalLensPoly 1 cube 257 0 0 0 0 0 1 8","CrystalLensPoly 1 cube 3 0 0 0 0 0 1 200"}) {
        std::istringstream invalid(bad);
        check(!ReadSolidDocument(invalid,read),"reject malformed document");
        std::ostringstream after;
        check(WriteSolidDocument(after,read) && after.str()==copy.str(), "failed read preserves document");
    }
}
}
int main() {
    try { geometry(); documents(); }
    catch (const std::exception& error) { std::cerr<<error.what()<<"\n";return 1; }
    std::cout<<"Verified all 22 named solids, both snub mirrors, prism families and model file I/O.\n";
}
