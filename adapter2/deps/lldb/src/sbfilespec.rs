use super::*;
use std::path::Path;

cpp_class!(pub unsafe struct SBFileSpec as "SBFileSpec");

unsafe impl Send for SBFileSpec {}

impl SBFileSpec {
    pub fn is_valid(&self) -> bool {
        cpp!(unsafe [self as "SBFileSpec*"] -> bool as "bool" {
            return self->IsValid();
        })
    }
    pub fn filename(&self) -> &str {
        let ptr = cpp!(unsafe [self as "SBFileSpec*"] -> *const c_char as "const char*" {
            return self->GetFilename();
        });
        unsafe { CStr::from_ptr(ptr).to_str().unwrap() }
    }
    pub fn directory(&self) -> &str {
        let ptr = cpp!(unsafe [self as "SBFileSpec*"] -> *const c_char as "const char*" {
            return self->GetDirectory();
        });
        unsafe { CStr::from_ptr(ptr).to_str().unwrap() }
    }
    pub fn path(&self) -> String {
        get_string(|ptr, size| {
            cpp!(unsafe [self as "SBFileSpec*", ptr as "char*", size as "size_t"] -> u32 as "uint32_t" {
                return self->GetPath(ptr, size);
            }) as usize
        })
    }
}

impl<T> From<T> for SBFileSpec
where
    T: AsRef<Path>,
{
    fn from(path: T) -> Self {
        with_cstr(path.as_ref().to_str().unwrap(), |path| {
            cpp!(unsafe [path as "const char*"] -> SBFileSpec as "SBFileSpec" {
                return SBFileSpec(path);
            })
        })
    }
}

impl fmt::Debug for SBFileSpec {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        debug_descr(f, |descr| {
            cpp!(unsafe [self as "SBFileSpec*", descr as "SBStream*"] -> bool as "bool" {
                return self->GetDescription(*descr);
            })
        })
    }
}
