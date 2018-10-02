import sys
import lldb
import traceback
import logging
from ctypes import *
from value import Value

logging.basicConfig(level=logging.DEBUG, #filename='/tmp/codelldb.log',
                    format='%(levelname)s(Python) %(asctime)s %(name)s: %(message)s', datefmt='%H:%M:%S')

log = logging.getLogger('codelldb')

PY2 = sys.version_info[0] == 2
if not PY2:
    basestring = str
    long = int

def to_utf8(s):
    return s.encode('utf8', 'backslashreplace')

#============================================================================================

RESULT_CALLBACK = CFUNCTYPE(None, c_int, c_void_p, c_size_t, c_void_p)

def evaluate(script, simple_expr, callback_addr, baton):
    callback = RESULT_CALLBACK(callback_addr)

    if simple_expr:
        eval_globals = {}
        eval_locals = PyEvalContext(lldb.frame)
        eval_globals['__frame_vars'] = eval_locals
    else:
        import __main__
        eval_globals = getattr(__main__, lldb.debugger.GetInstanceName() + '_dict')
        eval_globals['__frame_vars'] = PyEvalContext(lldb.frame)
        eval_locals = {}

    try:
        result = eval(script, eval_globals, eval_locals)
        result = Value.unwrap(result)
        if isinstance(result, lldb.SBValue):
            callback(1, long(result.this), 0, baton)
        elif isinstance(result, bool):
            callback(2, 0, long(result), baton)
        elif isinstance(result, int):
            callback(3, 0, long(result), baton)
        elif isinstance(result, basestring):
            s = to_utf8(result)
            callback(4, s, len(s), baton)
        else:
            s = to_utf8(str(result))
            callback(5, s, len(s), baton)
    except Exception as e:
        log.error('Evaluation error "%s": %s', script, e)
        s = to_utf8(traceback.format_exc())
        callback(0, s, len(s), baton)

def find_var_in_frame(sbframe, name):
    val = sbframe.FindVariable(name)
    if not val.IsValid():
        for val_type in [lldb.eValueTypeVariableGlobal,
                         lldb.eValueTypeVariableStatic,
                         lldb.eValueTypeRegister,
                         lldb.eValueTypeConstResult]:
            val = sbframe.FindValue(name, val_type)
            if val.IsValid():
                break
    if not val.IsValid():
        val = sbframe.GetValueForVariablePath(name)
    return val

# A dictionary-like object that fetches values from SBFrame (and caches them).
class PyEvalContext(dict):
    def __init__(self, sbframe):
        self.sbframe = sbframe

    def __missing__(self, name):
        val = find_var_in_frame(self.sbframe, name)
        if val.IsValid():
            val = Value(val)
            self.__setitem__(name, val)
            return val
        else:
            raise KeyError(name)

#============================================================================================

module_loaded_observers = []

# observer: Callable[SBModule]
def register_on_module_loaded(observer):
    module_loaded_observers.append(observer)

ASSIGN_SBMODULE = CFUNCTYPE(None, c_void_p, c_void_p)

def modules_loaded(sbmodule_addrs, assign_sbmodule_addr):
    assign_sbmodule = ASSIGN_SBMODULE(assign_sbmodule_addr)
    # SWIG does not provide a method for wrapping raw pointers from Python,
    # so we create a dummy module object, then call back into Rust code to
    # overwrite it with the module we need wrapped.
    for addr in sbmodule_addrs:
        sbmodule = lldb.SBModule() # Recreate, because sbmodule.compile_units will cache the list
        assign_sbmodule(long(sbmodule.this), addr)
        log.info('sbmodule is %s', sbmodule)
        for observer in module_loaded_observers:
            try:
                observer(sbmodule)
            except Exception as err:
                log.error('on_module_loaded observer %s raised %s', observer, err)
