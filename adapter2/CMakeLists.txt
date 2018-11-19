add_copy_files(codelldb_python
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
    FILES ${CMAKE_SOURCE_DIR}/adapter2/codelldb.py
          ${CMAKE_SOURCE_DIR}/adapter2/value.py
          ${CMAKE_SOURCE_DIR}/formatters/rust.py
)

add_custom_target(codelldb ALL
    DEPENDS codelldb_python lldb
    COMMAND ${CMAKE_COMMAND} -E env LLDB_ROOT=${LLDB_ROOT} cargo build -Zunstable-options --out-dir=${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Running cargo build"
)
