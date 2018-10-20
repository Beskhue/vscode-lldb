extern crate clap;
extern crate env_logger;

use self::loading::*;
use clap::{App, Arg};
use std::env;
use std::mem;
use std::path;

fn main() -> Result<(), std::io::Error> {
    env_logger::Builder::from_default_env().init();

    let matches = App::new("codelldb")
        .arg(
            Arg::with_name("liblldb")
                .long("liblldb")
                .takes_value(true)
                .required(true),
        )
        .arg(Arg::with_name("port").long("port").takes_value(true))
        .arg(Arg::with_name("multi-session").long("multi-session"))
        .get_matches();

    let liblldb_path = matches.value_of("liblldb").unwrap();
    let multi_session = matches.is_present("multi-session");
    let port = matches.value_of("port").map(|s| s.parse().unwrap()).unwrap_or(0);

    unsafe {
        let mut liblldb_path: path::PathBuf = liblldb_path.into();
        if liblldb_path.is_dir() {
            if cfg!(windows) {
                liblldb_path.push("liblldb.dll");
            } else if cfg!(target_os = "macos") {
                liblldb_path.push("liblldb.dylib");
            } else {
                liblldb_path.push("liblldb.so");
            }
        }
        load_library(&liblldb_path, true);

        let mut codelldb_path = env::current_exe()?;
        codelldb_path.pop();
        if cfg!(windows) {
            codelldb_path.push("codelldb.dll");
        } else if cfg!(target_os = "macos") {
            codelldb_path.push("libcodelldb.dylib");
        } else {
            codelldb_path.push("libcodelldb.so");
        }
        let codelldb = load_library(&codelldb_path, false);

        if cfg!(windows) {
            load_library(path::Path::new("python36.dll"), false);
        }

        let entry: unsafe extern "C" fn(u16, bool) = mem::transmute(find_symbol(codelldb, "entry"));
        entry(port, multi_session);
    }

    Ok(())
}

#[cfg(unix)]
mod loading {
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int, c_void};
    use std::path::Path;

    #[link(name = "dl")]
    extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *const c_void;
        fn dlsym(handle: *const c_void, symbol: *const c_char) -> *const c_void;
        fn dlerror() -> *const c_char;
    }
    const RTLD_LAZY: c_int = 0x00001;
    const RTLD_GLOBAL: c_int = 0x00100;

    pub unsafe fn load_library(path: &Path, global_symbols: bool) -> *const c_void {
        let cpath = CString::new(path.as_os_str().to_str().unwrap().as_bytes()).unwrap();
        let flags = match global_symbols {
            true => RTLD_LAZY | RTLD_GLOBAL,
            false => RTLD_LAZY,
        };
        let handle = dlopen(cpath.as_ptr() as *const c_char, flags);
        if handle.is_null() {
            panic!("{:?}", CStr::from_ptr(dlerror()));
        }
        handle
    }

    pub unsafe fn find_symbol(handle: *const c_void, name: &str) -> *const c_void {
        let cname = CString::new(name).unwrap();
        let ptr = dlsym(handle, cname.as_ptr() as *const c_char);
        if ptr.is_null() {
            panic!("{:?}", CStr::from_ptr(dlerror()));
        }
        ptr
    }
}

#[cfg(windows)]
mod loading {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_void};
    use std::path::Path;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryA(filename: *const c_char) -> *const c_void;
        fn GetProcAddress(handle: *const c_void, symbol: *const c_char) -> *const c_void;
        fn GetLastError() -> u32;
    }

    pub unsafe fn load_library(path: &Path, _global_symbols: bool) -> *const c_void {
        let cpath = CString::new(path.as_os_str().to_str().unwrap().as_bytes()).unwrap();
        let handle = LoadLibraryA(cpath.as_ptr() as *const c_char);
        if handle.is_null() {
            panic!("Could not load {:?} (err={:08X})", path, GetLastError());
        }
        handle
    }

    pub unsafe fn find_symbol(handle: *const c_void, name: &str) -> *const c_void {
        let cname = CString::new(name).unwrap();
        let ptr = GetProcAddress(handle, cname.as_ptr() as *const c_char);
        if ptr.is_null() {
            panic!("Could not find {} (err={:08X})", name, GetLastError());
        }
        ptr
    }
}
