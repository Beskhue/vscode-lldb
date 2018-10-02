use super::*;

cpp_class!(pub unsafe struct SBCommandInterpreter as "SBCommandInterpreter");

unsafe impl Send for SBCommandInterpreter {}

impl SBCommandInterpreter {
    pub fn is_valid(&self) -> bool {
        cpp!(unsafe [self as "SBCommandInterpreter*"] -> bool as "bool" {
            return self->IsValid();
        })
    }
    pub fn handle_command(
        &self, command: &str, result: &mut SBCommandReturnObject, add_to_history: bool,
    ) -> ReturnStatus {
        with_cstr(command, |command| {
            cpp!(unsafe [self as "SBCommandInterpreter*", command as "const char*",
                         result as "SBCommandReturnObject*", add_to_history as "bool"] -> ReturnStatus as "ReturnStatus" {
                return self->HandleCommand(command, *result, add_to_history);
            })
        })
    }
    pub fn handle_command_with_context(
        &self, command: &str, context: &SBExecutionContext, result: &mut SBCommandReturnObject, add_to_history: bool,
    ) -> ReturnStatus {
        with_cstr(command, |command| {
            cpp!(unsafe [self as "SBCommandInterpreter*", command as "const char*", context as "SBExecutionContext*",
                         result as "SBCommandReturnObject*", add_to_history as "bool"] -> ReturnStatus as "ReturnStatus" {
                return self->HandleCommand(command, *context, *result, add_to_history);
            })
        })
    }
}

#[derive(Clone, Copy, Eq, PartialEq, Debug)]
#[repr(u32)]
pub enum ReturnStatus {
    Invalid = 0,
    SuccessFinishNoResult = 1,
    SuccessFinishResult = 2,
    SuccessContinuingNoResult = 3,
    SuccessContinuingResult = 4,
    Started = 5,
    Failed = 6,
    Quit = 7,
}
