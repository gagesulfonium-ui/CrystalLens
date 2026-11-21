#include "Localization.h"

namespace cl {
namespace {
Language gLanguage = Language::Chinese;

const wchar_t* kChinese[] = {
#define CL_ZH_ENTRY(id, zh, en) zh,
    CL_STRING_LIST(CL_ZH_ENTRY)
#undef CL_ZH_ENTRY
};

const wchar_t* kEnglish[] = {
#define CL_EN_ENTRY(id, zh, en) en,
    CL_STRING_LIST(CL_EN_ENTRY)
#undef CL_EN_ENTRY
};

constexpr size_t kStringCount = static_cast<size_t>(Str::Count);
static_assert(sizeof(kChinese) / sizeof(kChinese[0]) == kStringCount, "Chinese string table is incomplete");
static_assert(sizeof(kEnglish) / sizeof(kEnglish[0]) == kStringCount, "English string table is incomplete");
} // namespace

Language I18n::GetLanguage() { return gLanguage; }

void I18n::SetLanguage(Language language) { gLanguage = language; }

bool I18n::IsChinese() { return gLanguage == Language::Chinese; }

const wchar_t* I18n::Get(Str id, Language language) {
    const size_t index = static_cast<size_t>(id);
    if (index >= kStringCount) return L"";
    return language == Language::Chinese ? kChinese[index] : kEnglish[index];
}

const wchar_t* I18n::Get(Str id) { return Get(id, gLanguage); }

} // namespace cl
