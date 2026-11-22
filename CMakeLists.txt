cmake_minimum_required(VERSION 3.25)

project(CrystalLens VERSION 1.4.0 LANGUAGES CXX RC)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

option(CRYSTALLENS_BUILD_TESTS "Build the core test suite" ON)

add_library(crystal_core STATIC
    src/core/Solids.cpp
    src/core/SolidDocument.cpp
    src/core/Crystal.cpp
    src/core/CifParser.cpp
    src/core/XyzParser.cpp
    src/core/VestaParser.cpp
    src/core/PeriodicTable.cpp
)
target_include_directories(crystal_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(crystal_core PUBLIC WIN32_LEAN_AND_MEAN NOMINMAX _CRT_SECURE_NO_WARNINGS)
if(MSVC)
    target_compile_options(crystal_core PRIVATE /utf-8 /W3 /permissive- /Zc:__cplusplus)
endif()

add_executable(CrystalLens WIN32
    src/main.cpp
    src/render/GL.cpp
    src/render/Camera.cpp
    src/render/Renderer.cpp
    src/render/PolyhedronMesh.cpp
    src/render/Picking.cpp
    src/render/Overlay.cpp
    src/ui/Localization.cpp
    src/ui/UiDraw.cpp
    src/ui/Icons.cpp
    src/ui/Format.cpp
    src/ui/Settings.cpp
    src/ui/Viewport.cpp
    src/ui/Popups.cpp
    src/ui/AppearanceWindow.cpp
    src/ui/ElementStyleDialog.cpp
    src/ui/SolidViewer.cpp
    src/ui/CrystalLibrary.cpp
    src/ui/MainWindow.cpp
    resources/app.rc
)
target_link_libraries(CrystalLens PRIVATE
    crystal_core
    opengl32
    gdiplus
    dwmapi
    shell32
    ole32
    uuid
    comctl32
    comdlg32
)
target_include_directories(CrystalLens PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/resources)
target_compile_definitions(CrystalLens PRIVATE
    UNICODE
    _UNICODE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
)
if(MSVC)
    target_compile_options(CrystalLens PRIVATE /utf-8 /W3 /permissive- /Zc:__cplusplus)
    target_link_options(CrystalLens PRIVATE
        "/MANIFEST:EMBED"
        "/MANIFESTINPUT:${CMAKE_CURRENT_SOURCE_DIR}/resources/app.manifest"
    )
endif()
set_target_properties(CrystalLens PROPERTIES OUTPUT_NAME "CrystalLens")

add_custom_target(crystal_library_data ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/library" "$<TARGET_FILE_DIR:CrystalLens>/library"
    VERBATIM
)
add_dependencies(CrystalLens crystal_library_data)

if(CRYSTALLENS_BUILD_TESTS)
    enable_testing()
    add_executable(crystal_tests tests/test_core.cpp)
    target_link_libraries(crystal_tests PRIVATE crystal_core)
    target_include_directories(crystal_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_compile_definitions(crystal_tests PRIVATE
        CL_EXAMPLES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/examples"
    )
    if(MSVC)
        target_compile_options(crystal_tests PRIVATE /utf-8 /W3 /permissive-)
    endif()
    add_test(NAME core_tests COMMAND crystal_tests)

    add_executable(crystal_solid_tests tests/test_solids.cpp)
    target_link_libraries(crystal_solid_tests PRIVATE crystal_core)
    if(MSVC)
        target_compile_options(crystal_solid_tests PRIVATE /utf-8 /W3 /permissive-)
    endif()
    add_test(NAME solid_tests COMMAND crystal_solid_tests)

    add_executable(crystal_camera_tests tests/test_camera.cpp src/render/Camera.cpp src/render/Picking.cpp
                   src/render/GL.cpp src/render/Renderer.cpp src/render/PolyhedronMesh.cpp)
    target_link_libraries(crystal_camera_tests PRIVATE crystal_core opengl32)
    target_include_directories(crystal_camera_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_compile_definitions(crystal_camera_tests PRIVATE UNICODE _UNICODE
        CL_EXAMPLES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/examples"
    )
    if(MSVC)
        target_compile_options(crystal_camera_tests PRIVATE /utf-8 /W3 /permissive-)
    endif()
    add_test(NAME camera_tests COMMAND crystal_camera_tests)
endif()
