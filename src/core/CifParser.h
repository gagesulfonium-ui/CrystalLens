#pragma once

#include "Crystal.h"

#include <string>

namespace cl {

// Parses the first usable structure block in a CIF document. The structure is
// returned with its asymmetric unit populated; call FinalizeStructure next.
bool ParseCifText(std::string_view text, Structure& out, ParseError& error);

} // namespace cl
