#include <mimalloc.h>

class Code3dMemory {
public:
  // Allocator occupancy, including geometry shared by multiple shape handles.
  // Unlike wasmMemory.buffer.byteLength, this decreases when shapes are freed.
  static double AllocatedBytes() {
    double bytes = 0;
    mi_heap_visit_blocks(mi_heap_get_default(), false,
      [](const mi_heap_t*, const mi_heap_area_t* area, void*, size_t, void* state) {
      // In the pinned Emscripten 5.0.1 mimalloc, used counts blocks, not bytes.
      *static_cast<double*>(state) +=
        static_cast<double>(area->used) * area->full_block_size;
      return true;
      }, &bytes);
    return bytes;
  }
};
