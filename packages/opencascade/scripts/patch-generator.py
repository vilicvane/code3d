"""Configure owned destruction and allocator headers in the pinned generator."""

from pathlib import Path

generator = Path('/opencascade.js/src/ocjs_bindgen/codegen/embind/class_.py')
source = generator.read_text()
original = '    output += "namespace emscripten { namespace internal { template<> void raw_destructor<" + classCpp + ">(" + classCpp + "* ptr) { /* do nothing */ } } }\\n"'
helper = '''#ifndef CODE3D_OWNED_DESTRUCTOR
#define CODE3D_OWNED_DESTRUCTOR
#include <type_traits>
#include <utility>
namespace emscripten { namespace internal {
template<class T, class = void> struct Code3dOwnedDestructor {
  static void destroy(T*) {}
};
template<class T> struct Code3dOwnedDestructor<T, std::void_t<decltype(delete std::declval<T*>())>> {
  static void destroy(T* ptr) { delete ptr; }
};
} }
#endif
'''
replacement = (
    '    output += ' + repr(helper) + '\n'
    '    output += "namespace emscripten { namespace internal { template<> void raw_destructor<" + classCpp + ">(" + classCpp + "* ptr) { Code3dOwnedDestructor<" + classCpp + ">::destroy(ptr); } } }\\n"'
)
if source.count(original) != 1:
    raise RuntimeError('The pinned binding generator no longer matches the patch')
generator.write_text(source.replace(original, replacement))

# The binding parser uses host Clang include paths while defining __EMSCRIPTEN__.
# Give it the pinned allocator's header, also present in the WASM compiler sysroot.
parser = Path('/opencascade.js/src/ocjs_bindgen/ast/parse.py')
source = parser.read_text()
original = '            "-D__EMSCRIPTEN__",'
replacement = original + '\n            "-I/emsdk/upstream/emscripten/system/lib/mimalloc/include",'
if source.count(original) != 3:
    raise RuntimeError('The pinned binding parser no longer matches the patch')
parser.write_text(source.replace(original, replacement))

driver = Path('/opencascade.js/build-wasm.sh')
source = driver.read_text()
original = '"$OCJS_PYTHON" src/compileBindings.py "$THREADING"'
if source.count(original) != 1:
    raise RuntimeError('The pinned build driver no longer matches the patch')
driver.write_text(source.replace(original, '"$OCJS_PYTHON" /src/compile-bindings.py'))
