#!/usr/bin/python
from __future__ import print_function
import sys
import os
import shutil
import subprocess
import stat
import errno

def main():
    lldb_root = os.environ['LLDB_ROOT']
    if not lldb_root: raise Exception('Need LLDB_ROOT')
    workspace_folder = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    subprocess.check_call(['cargo', 'build'])

    build_dir = workspace_folder + '/target/debug'
    lldb_dir = workspace_folder + '/out/lldb'
    adapter2_dir = workspace_folder + '/out/adapter2'
    make_dirs(lldb_dir)
    make_dirs(lldb_dir + '/bin')
    make_dirs(lldb_dir + '/lib')
    make_dirs(adapter2_dir)

    copy_if_newer(workspace_folder + '/adapter2/codelldb.py', adapter2_dir)
    copy_if_newer(workspace_folder + '/adapter2/rust.py', adapter2_dir)
    copy_if_newer(workspace_folder + '/adapter2/value.py', adapter2_dir)

    if sys.platform.startswith('linux'):
        copy_if_newer(build_dir + '/codelldb', adapter2_dir)
        copy_if_newer(build_dir + '/libcodelldb.so', adapter2_dir)

        copy_if_newer(lldb_root + '/bin/lldb', lldb_dir + '/bin')
        copy_if_newer(lldb_root + '/bin/lldb-server', lldb_dir + '/bin')
        copy_if_newer(lldb_root + '/lib/liblldb.so', lldb_dir + '/lib')
        copy_if_newer(lldb_root + '/lib/liblldb.so.8svn', lldb_dir + '/lib')

        copy_tree_if_newer(lldb_root + '/lib/python2.7/site-packages',
                           lldb_dir + '/lib/python2.7/site-packages',
                           ignore=['_lldb.*'])

    elif sys.platform.startswith('darwin'):
        copy_if_newer(build_dir + '/codelldb', adapter2_dir)
        copy_if_newer(build_dir + '/libcodelldb.dylib', adapter2_dir)

        copy_if_newer(lldb_root + '/bin/lldb', lldb_dir + '/bin')
        copy_if_newer(lldb_root + '/lib/liblldb.dylib', lldb_dir + '/lib')

        copy_tree_if_newer(lldb_root + '/lib/python2.7/site-packages',
                           lldb_dir + '/lib/python2.7/site-packages',
                           ignore=['_lldb.*'])

    elif sys.platform.startswith('win32'):
        copy_if_newer(build_dir + '/codelldb.exe', adapter2_dir)
        copy_if_newer(build_dir + '/codelldb.dll', adapter2_dir)

        copy_if_newer(lldb_root + '/bin/lldb.exe', lldb_dir + '/bin')
        #copy_if_newer(lldb_root + '/bin/lldb.pdb', lldb_dir + '/bin')

        copy_if_newer(lldb_root + '/bin/liblldb.dll', lldb_dir + '/bin')
        #copy_if_newer(lldb_root + '/bin/liblldb.pdb', lldb_dir + '/bin')

        copy_tree_if_newer(lldb_root + '/lib/site-packages',
                           lldb_dir + '/lib/site-packages',
                           ignore=['_lldb.*'])
    else:
        assert False

def make_dirs(path):
    try:
        os.makedirs(path)
    except OSError as err:
        if err.errno != errno.EEXIST:
            raise

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

def copy_tree_if_newer(source, target, ignore=None):
    if not os.path.isdir(target):
        print('Copying', source)
        if ignore is not None:
            ignore=shutil.ignore_patterns(*ignore)
        shutil.copytree(source, target, ignore=ignore)

main()
