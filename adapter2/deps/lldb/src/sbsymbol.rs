use super::*;

cpp_class!(pub unsafe struct SBSymbol as "SBSymbol");

unsafe impl Send for SBSymbol {}

impl SBSymbol {
    pub fn is_valid(&self) -> bool {
        cpp!(unsafe [self as "SBSymbol*"] -> bool as "bool" {
            return self->IsValid();
        })
    }
    pub fn name(&self) -> &str {
        let ptr = cpp!(unsafe [self as "SBSymbol*"] -> *const c_char as "const char*" {
            return self->GetName();
        });
        unsafe { CStr::from_ptr(ptr).to_str().unwrap() }
    }
    pub fn display_name(&self) -> &str {
        let ptr = cpp!(unsafe [self as "SBSymbol*"] -> *const c_char as "const char*" {
            return self->GetDisplayName();
        });
        unsafe { CStr::from_ptr(ptr).to_str().unwrap() }
    }
    pub fn mangled_name(&self) -> &str {
        let ptr = cpp!(unsafe [self as "SBSymbol*"] -> *const c_char as "const char*" {
            return self->GetMangledName();
        });
        unsafe { CStr::from_ptr(ptr).to_str().unwrap() }
    }
    pub fn start_address(&self) -> SBAddress {
        cpp!(unsafe [self as "SBSymbol*"] -> SBAddress as "SBAddress" {
            return self->GetStartAddress();
        })
    }
    pub fn end_address(&self) -> SBAddress {
        cpp!(unsafe [self as "SBSymbol*"] -> SBAddress as "SBAddress" {
            return self->GetEndAddress();
        })
    }
    pub fn instructions(&self, target: &SBTarget) -> SBInstructionList {
        let target = target.clone();
        cpp!(unsafe [self as "SBSymbol*", target as "SBTarget"] -> SBInstructionList as "SBInstructionList" {
            return self->GetInstructions(target);
        })
    }
    pub fn get_description(&self, description: &mut SBStream) -> bool {
        cpp!(unsafe [self as "SBSymbol*", description as "SBStream*"] -> bool as "bool" {
            return self->GetDescription(*description);
        })
    }
}
