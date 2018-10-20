#!/usr/bin/python
# Debug stub for launching Python debug session inside LLDB
import sys
import os
import subprocess

args = sys.argv[1:]
script = [
  "import sys,runpy,__main__",
  "sys.orig_main = __main__",
  "sys.argv=['%s']" % "','".join(args),
  "runpy.run_path('%s', run_name='__main__')" % sys.argv[1]
]
command = [os.environ['LLDB_EXECUTABLE'], '-b', '-O', 'script ' + '; '.join(script)]
subprocess.call(command)
