cmake_minimum_required(VERSION 3.24)
project(code3d_solver VERSION 1.0.1 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-fexceptions)

include(FetchContent)
FetchContent_Declare(ondsel
  GIT_REPOSITORY https://github.com/FreeCAD/OndselSolver.git
  GIT_TAG 458510ddfd1a96f0afb4a045dc09b57dadd2617c
  SOURCE_SUBDIR OndselSolver
)
set(ONDSELSOLVER_BUILD_SHARED OFF)
FetchContent_MakeAvailable(ondsel)

add_executable(solver solver.cpp)
target_include_directories(solver PRIVATE ${ondsel_SOURCE_DIR}/OndselSolver)
target_link_libraries(solver PRIVATE OndselSolver)
target_link_options(solver PRIVATE
  -lembind -fexceptions
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576
  "-sINCOMING_MODULE_JS_API=['wasmBinary','locateFile','print','printErr']"
)
set_target_properties(solver PROPERTIES
  SUFFIX .js
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../wasm
)
