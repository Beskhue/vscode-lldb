cmake_minimum_required(VERSION 3.10)

include(cmake/CopyFiles.cmake)

set(LLDB_ROOT $ENV{LLDB_ROOT} CACHE PATH "Root of LLDB build directory")
if (NOT LLDB_ROOT)
    message(FATAL_ERROR "LLDB_ROOT not set." )
endif()

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_INSTALL_PREFIX $ENV{HOME}/.vscode/extensions/vscode-lldb CACHE PATH "Install location")

if (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Windows")
    set(NodeProgExt .cmd)
else()
    set(ZipSymlinks -y)
endif()

add_subdirectory(adapter2)
add_subdirectory(lldb)
add_subdirectory(extension)
add_subdirectory(tests)

### Extension

add_copy_files(adapter
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/adapter
    GLOB ${CMAKE_SOURCE_DIR}/adapter/*.py
)
add_copy_files(formatters
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/formatters
    GLOB ${CMAKE_SOURCE_DIR}/formatters/*.py
)
add_dependencies(adapter formatters)
add_copy_files(images
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/images
    GLOB ${CMAKE_SOURCE_DIR}/images/*
)
add_copy_files(syntaxes
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}/syntaxes
    GLOB ${CMAKE_SOURCE_DIR}/syntaxes/*
)
add_copy_files(manifest
    DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
    FILES package.json README.md MANUAL.md CHANGELOG.md
)
add_custom_target(extension ALL
    DEPENDS adapter formatters images syntaxes extension_js manifest lldb codelldb
)

if (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Linux")
    set(StripFiles strip
                   ${CMAKE_CURRENT_BINARY_DIR}/adapter2/codelldb
                   ${CMAKE_CURRENT_BINARY_DIR}/adapter2/libcodelldb.so
                   ${CMAKE_CURRENT_BINARY_DIR}/lldb/bin/lldb
                   ${CMAKE_CURRENT_BINARY_DIR}/lldb/bin/lldb-server
                   ${CMAKE_CURRENT_BINARY_DIR}/lldb/lib/liblldb.so
                   ${CMAKE_CURRENT_BINARY_DIR}/lldb/lib/liblldb.so.8svn
                   ${CMAKE_CURRENT_BINARY_DIR}/lldb/lib/python2.7/site-packages/lldb/lldb-argdumper
                   )
endif()
add_custom_target(strip
    COMMAND ${StripFiles}
)

# VSIX package

add_copy_directory(node_modules
    ${CMAKE_SOURCE_DIR}/node_modules
    DESTINATION  ${CMAKE_BINARY_DIR}/node_modules
)

set(PackagedFilesPortable
    README.md
    CHANGELOG.md
    MANUAL.md
    formatters/*
    images/*
    syntaxes/*
    extension/*.js
    adapter/**/*.py
)

set(PackagedFilesFull
    ${PackagedFilesPortable}
    adapter2/*.py
    adapter2/codelldb
    adapter2/libcodelldb.so*
    adapter2/codelldb.exe
    adapter2/codelldb.dll
    lldb/bin/**/*
    lldb/lib/**/*
)

set(Content **)
foreach(Line ${PackagedFilesPortable})
    set(Content ${Content}\n!${Line})
endforeach()
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/vscodeignore-portable ${Content})

set(Content **)
foreach(Line ${PackagedFilesFull})
    set(Content ${Content}\n!${Line})
endforeach()
file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/vscodeignore-full ${Content})

add_custom_target(vsix_portable
    DEPENDS adapter formatters images manifest extension node_modules
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_BINARY_DIR}/vscodeignore-portable ${CMAKE_CURRENT_BINARY_DIR}/.vscodeignore
    COMMAND vsce package -o ${CMAKE_CURRENT_BINARY_DIR}/vscode-lldb-portable.vsix
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
)

add_custom_target(vsix_full
    DEPENDS adapter formatters images manifest extension node_modules lldb codelldb strip
    COMMAND ${CMAKE_COMMAND} -E copy ${CMAKE_CURRENT_BINARY_DIR}/vscodeignore-full ${CMAKE_CURRENT_BINARY_DIR}/.vscodeignore
    COMMAND vsce package -o ${CMAKE_CURRENT_BINARY_DIR}/vscode-lldb-full.vsix
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
)

### Debuggee

if (NOT ${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Windows")
    file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee)
    execute_process(
        COMMAND ${CMAKE_COMMAND} ${CMAKE_SOURCE_DIR}/debuggee -G "${CMAKE_GENERATOR}"
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee
    )
    add_custom_target(debuggee
        COMMAND ${CMAKE_COMMAND} --build ${CMAKE_CURRENT_BINARY_DIR}/debuggee
    )
else()
    # On Windows we want to check both MSVC PDB and GNU DWARF debug info kinds.
    file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee-msvc)
    execute_process(
        COMMAND ${CMAKE_COMMAND} ${CMAKE_SOURCE_DIR}/debuggee -G "${CMAKE_GENERATOR}" -DCMAKE_C_COMPILER=cl -DCMAKE_CXX_COMPILER=cl
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee-msvc
    )
    file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee-gnu)
    execute_process(
        COMMAND ${CMAKE_COMMAND} ${CMAKE_SOURCE_DIR}/debuggee -G "${CMAKE_GENERATOR}" -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
        WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/debuggee-gnu
    )
    add_custom_target(debuggee
        COMMAND ${CMAKE_COMMAND} --build ${CMAKE_CURRENT_BINARY_DIR}/debuggee-msvc
        COMMAND ${CMAKE_COMMAND} --build ${CMAKE_CURRENT_BINARY_DIR}/debuggee-gnu
    )
endif()

### Tests

set(MochaCommand "${CMAKE_SOURCE_DIR}/node_modules/.bin/mocha${NodeProgExt}"
    -u tdd
    --timeout 10000
    --exit
    --require source-map-support/register
    #-g "expressions"
    ${CMAKE_BINARY_DIR}/tests/tests
)

if (${CMAKE_HOST_SYSTEM_NAME} STREQUAL "Windows")
    add_custom_target(test_adapter_gnu
        DEPENDS debuggee adapter lldb tests
        COMMAND ${CMAKE_COMMAND} -E env TARGET_TRIPLE=x86_64-pc-windows-gnu ${MochaCommand}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
    add_custom_target(test_adapter2_gnu
        DEPENDS debuggee codelldb tests
        COMMAND ${CMAKE_COMMAND} -E env USE_ADAPTER2=1 TARGET_TRIPLE=x86_64-pc-windows-gnu ${MochaCommand}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
    add_custom_target(test_adapter_msvc
        DEPENDS debuggee adapter lldb tests
        COMMAND ${CMAKE_COMMAND} -E env TARGET_TRIPLE=x86_64-pc-windows-msvc ${MochaCommand}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
    add_custom_target(test_adapter2_msvc
        DEPENDS debuggee codelldb tests
        COMMAND ${CMAKE_COMMAND} -E env USE_ADAPTER2=1 TARGET_TRIPLE=x86_64-pc-windows-msvc ${MochaCommand}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
    add_custom_target(test_adapter
        DEPENDS test_adapter_gnu test_adapter_msvc)
    add_custom_target(test_adapter2
        DEPENDS test_adapter2_gnu test_adapter2_msvc)
else()
    add_custom_target(test_adapter
        DEPENDS debuggee adapter lldb tests
        COMMAND ${CMAKE_COMMAND} -E env TARGET_TRIPLE=x86_64-unknown-linux-gnu ${MochaCommand}
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
    add_custom_target(test_adapter2
        DEPENDS debuggee codelldb tests
        COMMAND ${CMAKE_COMMAND} -E env USE_ADAPTER2=1 TARGET_TRIPLE=x86_64-unknown-linux-gnu ${MochaCommand}
        WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
        USES_TERMINAL WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    )
endif()

### Install

install(CODE "file(REMOVE_RECURSE \"${CMAKE_INSTALL_PREFIX}/vscode-lldb\")")
install(
    DIRECTORY ${ExtensionRoot}
    DESTINATION .
)
