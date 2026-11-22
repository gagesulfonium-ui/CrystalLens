#include "SolidDocument.h"
#include <iomanip>
#include <istream>
#include <ostream>
#include <locale>

namespace cl {
SolidDocument NewSolidDocument(int preset, int sides, bool mirror) {
    SolidDocument doc;
    doc.preset=preset;
    doc.sides=std::clamp(sides,3,256);
    const auto& model=SolidPresets().at(preset);
    doc.mirror=mirror && model.family==SolidFamily::Archimedean && model.mask==0;
    doc.mesh=MakeSolid(model,doc.sides,doc.mirror);
    return doc;
}

bool WriteSolidDocument(std::ostream& out,const SolidDocument& d) {
    out.imbue(std::locale::classic());
    out<<"CrystalLensPoly 1\n"<<SolidPresets().at(d.preset).id<<" "<<d.sides<<" "<<d.mirror<<"\n"
       <<d.look.face<<" "<<d.look.edge<<" "<<d.look.background<<" "<<d.look.mode<<" "<<d.look.points<<"\n"
       <<d.mesh.vertices.size()<<"\n"<<std::setprecision(17);
    for (const auto& v:d.mesh.vertices) out<<v.x<<" "<<v.y<<" "<<v.z<<"\n";
    return bool(out);
}

bool ReadSolidDocument(std::istream& in,SolidDocument& dest) {
    in.imbue(std::locale::classic());
    std::string magic,id;
    int version,sides;
    bool mirror;
    SolidLook look;
    size_t count;
    if (!(in>>std::setw(32)>>magic>>version>>std::setw(64)>>id>>sides>>mirror
          >>look.face>>look.edge>>look.background>>look.mode>>look.points>>count) ||
        magic!="CrystalLensPoly" || version!=1 || sides<3 || sides>256 ||
        look.mode<0 || look.mode>2 || (look.face|look.edge|look.background)>0xFFFFFF) return false;
    const auto& presets=SolidPresets();
    const auto it=std::find_if(presets.begin(),presets.end(),[&](const SolidPreset& p){return id==p.id;});
    if (it==presets.end()) return false;
    auto model=NewSolidDocument(static_cast<int>(it-presets.begin()),sides,mirror);
    if (model.mirror!=mirror || count!=model.mesh.vertices.size()) return false;
    for (auto& v:model.mesh.vertices) {
        if (!(in>>v.x>>v.y>>v.z)) return false;
        for (int i=0;i<3;++i) if (!std::isfinite(v[i]) || std::abs(v[i])>10000) return false;
    }
    if (!(in>>std::ws).eof()) return false;
    model.look=look;
    dest=std::move(model);
    return true;
}
} // namespace cl
