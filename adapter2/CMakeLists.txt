if (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Linux")
    add_copy_files(codelldb_bin
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/codelldb
    )
    add_copy_files(codelldb_lib
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/libcodelldb.so
    )
elseif (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Darwin")
    add_copy_files(codelldb_bin
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/codelldb
    )
    add_copy_files(codelldb_lib
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/libcodelldb.dylib
    )
elseif (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Windows")
    add_copy_files(codelldb_bin
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/codelldb.exe
    )
    add_copy_files(codelldb_lib
        DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
        FILES ${CMAKE_SOURCE_DIR}/target/debug/codelldb.dll
    )
    set(Target --target=x86_64-pc-windows-msvc)
else()
    message(FATAL_ERROR "${CMAKE_HOST_SYSTEM_NAME} not supported." )
endif()

add_copy_files(codelldb_python
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
    FILES ${CMAKE_SOURCE_DIR}/adapter2/codelldb.py
          ${CMAKE_SOURCE_DIR}/adapter2/value.py
          ${CMAKE_SOURCE_DIR}/formatters/rust.py
)

add_custom_target(cargo_build
    COMMAND ${CMAKE_COMMAND} -E env LLDB_ROOT=${LLDB_ROOT} cargo build ${Target}
    COMMENT "Running cargo build"
)

add_dependencies(codelldb_bin cargo_build)
add_dependencies(codelldb_lib cargo_build)

add_custom_target(codelldb ALL
    DEPENDS codelldb_bin codelldb_lib codelldb_python lldb
)
