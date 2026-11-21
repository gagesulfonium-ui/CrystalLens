#pragma once

#include "Crystal.h"

namespace cl {

bool ParseXyzText(std::string_view text, Structure& out, ParseError& error);

} // namespace cl
