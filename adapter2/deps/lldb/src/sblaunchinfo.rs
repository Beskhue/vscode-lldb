use super::*;

cpp_class!(pub unsafe struct SBLaunchInfo as "SBLaunchInfo");

unsafe impl Send for SBLaunchInfo {}

impl SBLaunchInfo {
    pub fn new() -> SBLaunchInfo {
        cpp!(unsafe [] -> SBLaunchInfo as "SBLaunchInfo" {
            return SBLaunchInfo(nullptr);
        })
    }
    pub fn clear(&self) {
        cpp!(unsafe [self as "SBLaunchInfo*"] {
            self->Clear();
        })
    }
    pub fn set_listener(&self, listener: &SBListener) {
        cpp!(unsafe [self as "SBLaunchInfo*", listener as "SBListener*"] {
            self->SetListener(*listener);
        })
    }
    pub fn set_arguments<'a>(&self, args: impl IntoIterator<Item = &'a str>, append: bool) {
        let cstrs: Vec<CString> = args.into_iter().map(|a| CString::new(a).unwrap()).collect();
        let mut ptrs: Vec<*const c_char> = cstrs.iter().map(|cs| cs.as_ptr()).collect();
        ptrs.push(ptr::null());
        let argv = ptrs.as_ptr();
        cpp!(unsafe [self as "SBLaunchInfo*", argv as "const char**", append as "bool"] {
            self->SetArguments(argv, append);
        });
    }
    pub fn set_environment_entries<'a>(&self, env: impl IntoIterator<Item = &'a str>, append: bool) {
        let cstrs: Vec<CString> = env.into_iter().map(|a| CString::new(a).unwrap()).collect();
        let mut ptrs: Vec<*const c_char> = cstrs.iter().map(|cs| cs.as_ptr()).collect();
        ptrs.push(ptr::null());
        let envp = ptrs.as_ptr();
        cpp!(unsafe [self as "SBLaunchInfo*", envp as "const char**", append as "bool"] {
            self->SetEnvironmentEntries(envp, append);
        });
    }
    pub fn set_working_directory(&self, cwd: &str) {
        with_cstr(cwd, |cwd| {
            cpp!(unsafe [self as "SBLaunchInfo*", cwd as "const char*"] {
                self->SetWorkingDirectory(cwd);
            });
        })
    }
    pub fn add_open_file_action(&self, fd: i32, path: &str, read: bool, write: bool) -> bool {
        with_cstr(path, |path| {
            cpp!(unsafe [self as "SBLaunchInfo*", fd as "int32_t", path as "const char*",
                         read as "bool", write as "bool"] -> bool as "bool" {
                return self->AddOpenFileAction(fd, path, read, write);
            })
        })
    }
    pub fn add_duplicate_file_action(&self, fd: i32, dup_fd: i32) -> bool {
        cpp!(unsafe [self as "SBLaunchInfo*", fd as "int32_t", dup_fd as "int32_t"] -> bool as "bool" {
            return self->AddDuplicateFileAction(fd, dup_fd);
        })
    }
    pub fn add_suppress_file_action(&self, fd: i32, read: bool, write: bool) -> bool {
        cpp!(unsafe [self as "SBLaunchInfo*", fd as "int32_t",
                     read as "bool", write as "bool"] -> bool as "bool" {
            return self->AddSuppressFileAction(fd, read, write);
        })
    }
    pub fn add_close_file_action(&self, fd: i32) -> bool {
        cpp!(unsafe [self as "SBLaunchInfo*", fd as "int32_t"] -> bool as "bool" {
            return self->AddCloseFileAction(fd);
        })
    }
    pub fn set_launch_flags(&self, flags: LaunchFlag) {
        cpp!(unsafe [self as "SBLaunchInfo*", flags as "uint32_t"] {
            self->SetLaunchFlags(flags);
        })
    }
    pub fn launch_flags(&self) -> LaunchFlag {
        cpp!(unsafe [self as "SBLaunchInfo*"] -> LaunchFlag as "uint32_t" {
            return self->GetLaunchFlags();
        })
    }
    pub fn set_executable_file(&self, exe_file: &SBFileSpec, add_as_first_arg: bool) {
        cpp!(unsafe [self as "SBLaunchInfo*", exe_file as "SBFileSpec*", add_as_first_arg as "bool"] {
            return self->SetExecutableFile(*exe_file, add_as_first_arg);
        })
    }
}

bitflags! {
    pub struct LaunchFlag : u32 {
        const None = 0;
        // Exec when launching and turn the calling
        // process into a new process
        const Exec = (1 << 0);
        // Stop as soon as the process launches to
        // allow the process to be debugged
        const Debug = (1 << 1);
        // Stop at the program entry point
        // instead of auto-continuing when
        // launching or attaching at entry point
        const StopAtEntry = (1 << 2);
        // Disable Address Space Layout Randomization
        const DisableASLR = (1 << 3);
        // Disable stdio for inferior process (e.g. for a GUI app)
        const DisableSTDIO = (1 << 4);
        // Launch the process in a new TTY if supported by the host
        const LaunchInTTY = (1 << 5);
        // Launch the process inside a shell to get shell expansion
        const LaunchInShell = (1 << 6);
        // Launch the process in a separate process group
        const LaunchInSeparateProcessGroup = (1 << 7);
        // If you are going to hand the process off (e.g. to debugserver)
        // set this flag so lldb & the handee don't race to set its exit status.
        const DontSetExitStatus = (1 << 8);
        // If set, then the client stub should detach rather than killing
        // the debugee if it loses connection with lldb.
        const DetachOnError = (1 << 9);
        // Perform shell-style argument expansion
        const ShellExpandArguments = (1 << 10);
        // Close the open TTY on exit
        const CloseTTYOnExit = (1 << 11);
    }
}
