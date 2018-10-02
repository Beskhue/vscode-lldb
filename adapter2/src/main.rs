extern crate env_logger;

use std::env;
use std::mem;

#[cfg(unix)]
fn main() -> Result<(), std::io::Error> {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int, c_void};
    use std::os::unix::ffi::*;

    #[link(name = "dl")]
    extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
        fn dlerror() -> *const c_char;
    }
    const RTLD_LAZY: c_int = 0x00001;
    const RTLD_GLOBAL: c_int = 0x00100;

    env_logger::Builder::from_default_env().init();

    unsafe {
        let mut launch_dir = env::current_exe()?;
        launch_dir.pop();

        let mut liblldb_path = launch_dir.clone();
        if cfg!(target_os = "macos") {
            liblldb_path.push("LLDB.framework/LLDB");
        } else {
            liblldb_path.push("liblldb.so");
        };
        let liblldb_path = CString::new(liblldb_path.as_os_str().as_bytes())?;
        let liblldb = dlopen(liblldb_path.as_ptr() as *const c_char, RTLD_LAZY | RTLD_GLOBAL);
        if liblldb.is_null() {
            panic!("{:?}", CStr::from_ptr(dlerror()));
        }

        let mut codelldb_path = launch_dir;
        if cfg!(target_os = "macos") {
            codelldb_path.push("libcodelldb.dylib");
        } else {
            codelldb_path.push("libcodelldb.so");
        }
        let codelldb_path = CString::new(codelldb_path.as_os_str().as_bytes())?;
        let libcodelldb = dlopen(codelldb_path.as_ptr() as *const c_char, RTLD_LAZY);
        if libcodelldb.is_null() {
            panic!("{:?}", CStr::from_ptr(dlerror()));
        }

        let entry = dlsym(libcodelldb, b"entry\0".as_ptr() as *const c_char);
        if entry.is_null() {
            panic!("{:?}", CStr::from_ptr(dlerror()));
        }
        let entry: unsafe extern "C" fn(&[&str]) = mem::transmute(entry);

        let args = env::args().collect::<Vec<_>>();
        let arg_refs = args.iter().map(|a| a.as_ref()).collect::<Vec<_>>();
        entry(&arg_refs);
    }
    Ok(())
}

#[cfg(windows)]
fn main() -> Result<(), std::io::Error> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_void};
    use std::path::Path;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryA(filename: *const c_char) -> *const c_void;
        fn GetProcAddress(handle: *const c_void, symbol: *const c_char) -> *const c_void;
        fn GetLastError() -> u32;
    }

    unsafe fn load_library(path: &Path) -> *const c_void {
        let cpath = CString::new(path.as_os_str().to_str().unwrap().as_bytes()).unwrap();
        let handle = LoadLibraryA(cpath.as_ptr() as *const c_char);
        if handle.is_null() {
            panic!("Could not load {:?} (err={:08X})", path, GetLastError());
        }
        handle
    }

    unsafe fn find_symbol(handle: *const c_void, name: &str) -> *const c_void {
        let cname = CString::new(name).unwrap();
        let ptr = GetProcAddress(handle, cname.as_ptr() as *const c_char);
        if ptr.is_null() {
            panic!("Could not find {} (err={:08X})", name, GetLastError());
        }
        ptr
    }

    env_logger::Builder::from_default_env().init();

    unsafe {
        let mut launch_dir = env::current_exe()?;
        launch_dir.pop();

        let mut liblldb_path = launch_dir.clone();
        liblldb_path.push("liblldb.dll");
        let liblldb = load_library(&liblldb_path);
        let init_lldb = find_symbol(liblldb, "PyInit__lldb");

        // LLDB's python module _lldb.pyd is just a copy of liblldb.dll. However, on Windows dynamic symbols are
        // not global, so when Python scripting loads the _lldb module, it does not share globals with liblldb, which
        // causes all sorts of problems.  To deal with that, we pre-register liblldb with Python as a built-in module.
        let libpython = load_library(Path::new("python36.dll"));
        let py_append_inittab: unsafe extern "C" fn(name: *const c_char, mod_init: *const c_void) -> c_int =
            mem::transmute(find_symbol(libpython, "PyImport_AppendInittab"));
        py_append_inittab(b"_lldb\0".as_ptr() as *const c_char, init_lldb);

        let mut codelldb_path = launch_dir;
        codelldb_path.push("codelldb.dll");
        let codelldb = load_library(&codelldb_path);
        let entry: unsafe extern "C" fn(&[&str]) = mem::transmute(find_symbol(codelldb, "entry"));

        let args = env::args().collect::<Vec<_>>();
        let arg_refs = args.iter().map(|a| a.as_ref()).collect::<Vec<_>>();
        entry(&arg_refs);
    }
    Ok(())
}
