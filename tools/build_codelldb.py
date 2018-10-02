#!/usr/bin/python
from __future__ import print_function
import sys
import os
import shutil
import subprocess
import stat

def main():
    subprocess.check_call(['cargo', 'build'])

    workspace_folder = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = workspace_folder + '/target/debug'
    target_dir = workspace_folder + '/out/adapter2'
    make_dirs(target_dir)

    copy_if_newer(workspace_folder + '/adapter2/codelldb.py', target_dir)
    copy_if_newer(workspace_folder + '/adapter2/rust.py', target_dir)
    copy_if_newer(workspace_folder + '/adapter2/value.py', target_dir)

    if sys.platform.startswith('linux'):
        copy_if_newer(build_dir + '/codelldb', target_dir)
        copy_if_newer(build_dir + '/libcodelldb.so', target_dir)

        # copy_if_newer('/usr/lib/llvm-6.0/bin/lldb-server-6.0.1', target_dir)
        # copy_if_newer('/usr/lib/llvm-6.0/lib/liblldb-6.0.so', target_dir)

        copy_if_newer('/home/chega/NW/llvm-build/build/bin/lldb-server', target_dir)
        copy_if_newer('/home/chega/NW/llvm-build/build/lib/liblldb.so', target_dir)

        target_site_packages = target_dir + '/python2.7/site-packages'
        if not os.path.isdir(target_site_packages):
            shutil.copytree('/home/chega/NW/llvm-build/build/lib//python2.7/site-packages', target_site_packages,
                ignore=shutil.ignore_patterns('_lldb.*'))

    elif sys.platform.startswith('darwin'):
        copy_if_newer(build_dir + '/codelldb', target_dir)
        copy_if_newer(build_dir + '/libcodelldb.dylib', target_dir)
        target_framework = target_dir + '/LLDB.framework'
        if not os.path.isdir(target_framework):
            shutil.copytree('/Library/Developer/CommandLineTools/Library/PrivateFrameworks/LLDB.framework', target_framework,
                ignore=shutil.ignore_patterns('_lldb.*'))

    elif sys.platform.startswith('win32'):
        copy_if_newer(build_dir + '/codelldb.exe', target_dir)
        copy_if_newer(build_dir + '/codelldb.dll', target_dir)
        copy_if_newer('C:/NW/ll/build/bin/liblldb.dll', target_dir)
        copy_if_newer('C:/NW/ll/build/bin/liblldb.pdb', target_dir)

        # copy_if_newer('C:/NW/ll/build/bin/lldb.exe', target_dir)
        # copy_if_newer('C:/NW/ll/build/bin/lldb.pdb', target_dir)

        target_site_packages = target_dir + '/../lib/site-packages'
        if not os.path.isdir(target_site_packages):
            shutil.copytree('C:/NW/ll/build/lib/site-packages', target_site_packages,
                ignore=shutil.ignore_patterns('_lldb.*'))
    else:
        assert False

def make_dirs(path):
    try:
        os.makedirs(path)
    except OSError as err:
        pass

def copy_if_newer(source, target):
    try:
        st1 = os.stat(source)
        st2 = os.stat(target)
        if stat.S_ISDIR(st2.st_mode):
            st2 = os.stat(os.path.join(target, os.path.basename(source)))
        if st2.st_mtime >= st1.st_mtime and st2.st_size == st1.st_size:
            print('Skipping', os.path.basename(source))
            return
    except OSError as e:
        pass
    print('Copying', os.path.basename(source))
    shutil.copy(source, target)

main()
