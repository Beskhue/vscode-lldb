import * as assert from 'assert';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import { DebugClient } from 'vscode-debugadapter-testsupport';
import { DebugProtocol as dp } from 'vscode-debugprotocol';
import { format, promisify, inspect } from 'util';

import * as util from '../util';

const projectDir = path.join(__dirname, '..', '..');

const debuggee = path.join(projectDir, 'debuggee', 'out', 'debuggee');
const debuggeeSource = path.normalize(path.join(projectDir, 'debuggee', 'cpp', 'debuggee.cpp'));
const debuggeeHeader = path.normalize(path.join(projectDir, 'debuggee', 'cpp', 'dir1', 'debuggee.h'));

const rusttypes = path.join(projectDir, 'debuggee', 'out', 'rusttypes');
const rusttypesSource = path.normalize(path.join(projectDir, 'debuggee', 'rust', 'types.rs'));

const sleepAsync = promisify(setTimeout);
const openFileAsync = promisify(fs.open);

let dc = new DebugClient('', '', 'lldb');
let testId = 0;

suite('Adapter tests', () => {

    suiteSetup(async () => {
        await new Promise(resolve => fs.unlink(getAdapterLogFileName(), resolve));
    });
    suiteTeardown(() => {
        dc.stop();
    });

    setup(async () => {
        let port = null;
        if (process.env.DEBUG_SERVER) {
            port = parseInt(process.env.DEBUG_SERVER)
        } else {
            ++testId;
            port = await startDebugAdapter(testId.toString());
        }
        //console.log('Debug server port:', port)
        dc.start(port);
    });
    teardown(async () => {
        dc.stop();
        await sleepAsync(100);
    });

    suite('Basic', () => {

        test('run program to the end', async () => {
            let terminatedAsync = dc.waitForEvent('terminated');
            await launch({ name: 'run program to the end', program: debuggee });
            await terminatedAsync;
        });

        test('run program with modified environment', async () => {
            let waitExitedAsync = dc.waitForEvent('exited');
            await launch({
                name: 'run program with modified environment',
                env: { 'FOO': 'bar' },
                program: debuggee,
                args: ['check_env', 'FOO', 'bar'],
            });
            let exitedEvent = await waitExitedAsync;
            // debuggee shall return 1 if env[argv[2]] == argv[3]
            assert.equal(exitedEvent.body.exitCode, 1);
        });

        test('stop on entry', async () => {
            let stopAsync = waitForStopEvent();
            await launch({ program: debuggee, stopOnEntry: true });
            let stopEvent = await stopAsync;
            if (process.platform.startsWith('win'))
                assert.equal(stopEvent.body.reason, 'exception');
            else
                assert.equal(stopEvent.body.reason, 'signal');
        });

        test('stop on a breakpoint', async () => {
            if (process.platform == 'win32') {
                return;
            }
            let bpLineSource = findMarker(debuggeeSource, '#BP1');
            let bpLineHeader = findMarker(debuggeeHeader, '#BPH1');
            let setBreakpointAsyncSource = setBreakpoint(debuggeeSource, bpLineSource);
            let setBreakpointAsyncHeader = setBreakpoint(debuggeeHeader, bpLineHeader);
            let waitForExitAsync = dc.waitForEvent('exited');
            let waitForStopAsync = waitForStopEvent();

            await launch({ name: 'stop on a breakpoint', program: debuggee, args: ['header'], cwd: path.dirname(debuggee) });
            await setBreakpointAsyncSource;
            await setBreakpointAsyncHeader;

            let stopEvent = await withTimeout(1000, waitForStopAsync);
            await verifyLocation(stopEvent.body.threadId, debuggeeSource, bpLineSource);

            let waitForStopAsync2 = waitForStopEvent();
            await dc.continueRequest({ threadId: 0 });
            let stopEvent2 = await withTimeout(1000, waitForStopAsync2);
            await verifyLocation(stopEvent.body.threadId, debuggeeHeader, bpLineHeader);

            await dc.continueRequest({ threadId: 0 });
            await waitForExitAsync;
        });

        test('page stack', async () => {
            let bpLine = findMarker(debuggeeSource, '#BP2');
            let setBreakpointAsync = setBreakpoint(debuggeeSource, bpLine);
            let waitForStopAsync = waitForStopEvent();
            await launch({ name: 'page stack', program: debuggee, args: ['deepstack'] });
            await setBreakpointAsync;
            let stoppedEvent = await withTimeout(1000, waitForStopAsync);
            let response2 = await dc.stackTraceRequest({ threadId: stoppedEvent.body.threadId, startFrame: 20, levels: 10 });
            assert.equal(response2.body.stackFrames.length, 10)
            let response3 = await dc.scopesRequest({ frameId: response2.body.stackFrames[0].id });
            let response4 = await dc.variablesRequest({ variablesReference: response3.body.scopes[0].variablesReference });
            assert.equal(response4.body.variables[0].name, 'levelsToGo');
            assert.equal(response4.body.variables[0].value, '20');
        });

        test('variables', async () => {
            let bpLine = findMarker(debuggeeSource, '#BP3');
            let setBreakpointAsync = setBreakpoint(debuggeeSource, bpLine);
            let stoppedEvent = await launchAndWaitForStop({ name: 'variables', program: debuggee, args: ['vars'] });
            await verifyLocation(stoppedEvent.body.threadId, debuggeeSource, bpLine);
            let frameId = await getTopFrameId(stoppedEvent.body.threadId);
            let localsRef = await getFrameLocalsRef(frameId);
            await compareVariables(localsRef, {
                a: 30,
                b: 40,
                array_int: {
                    '[0]': 1, '[1]': 2, '[2]': 3, '[3]': 4, '[4]': 5, '[5]': 6, '[6]': 7, '[7]': 8, '[8]': 9, '[9]': 10,
                },
                s1: { a: 1, b: "'a'", c: 3 },
                cstr: '"The quick brown fox"',
                wcstr: 'L"The quick brown fox"',
                str1: '"The quick brown fox"',
                str_ptr: '"The quick brown fox"',
                str_ref: '"The quick brown fox"',
                empty_str: '""',
                wstr1: 'L"Превед йожэг!"',
                wstr2: 'L"Ḥ̪͔̦̺E͍̹̯̭͜ C̨͙̹̖̙O̡͍̪͖ͅM̢̗͙̫̬E̜͍̟̟̮S̢̢̪̘̦!"',
                invalid_utf8: process.platform != 'win32' ? '"ABC\uFFFD\\x01\uFFFDXYZ' : '"ABC\uDCFF\\x01\uDCFEXYZ',
                anon_union: {
                    '': { x: 4, y: 4 }
                }
            });

            let response1 = await dc.evaluateRequest({
                expression: 'vec_int', context: 'watch', frameId: frameId
            });
            if (process.platform != 'win32') {
                await compareVariables(response1.body.variablesReference, {
                    '[0]': { '[0]': 0, '[1]': 0, '[2]': 0, '[3]': 0, '[4]': 0 },
                    '[9]': { '[0]': 0, '[1]': 0, '[2]': 0, '[3]': 0, '[4]': 0 },
                    '[raw]': null
                });
            }

            // Read a class-qualified static.
            let response2 = await dc.evaluateRequest({
                expression: 'Klazz::m1', context: 'watch', frameId: frameId
            });
            assert.equal(response2.body.result, '42');

            // Set a variable and check that it has actually changed.
            await dc.send('setVariable', { variablesReference: localsRef, name: 'a', value: '100' });
            await compareVariables(localsRef, { a: 100 });
        });

        test('expressions', async () => {
            let bpLine = findMarker(debuggeeSource, '#BP3');
            let setBreakpointAsync = setBreakpoint(debuggeeSource, bpLine);
            let stoppedEvent = await launchAndWaitForStop({ name: 'expressions', program: debuggee, args: ['vars'] });
            let frameId = await getTopFrameId(stoppedEvent.body.threadId);

            let response1 = await dc.evaluateRequest({ expression: "a+b", frameId: frameId, context: "watch" });
            assert.equal(response1.body.result, "70");

            let response2 = await dc.evaluateRequest({ expression: "/py sum([int(x) for x in $array_int])", frameId: frameId, context: "watch" });
            assert.equal(response2.body.result, "55"); // sum(1..10)

            // let response3 = await dc.evaluateRequest({ expression: "/nat 2+2", frameId: frameId, context: "watch" });
            // assert.ok(response3.body.result.endsWith("4")); // "(int) $0 = 70"

            for (let i = 1; i < 10; ++i) {
                let waitForStopAsync = waitForStopEvent();
                await dc.continueRequest({ threadId: 0 });
                let stoppedEvent = await withTimeout(1000, waitForStopAsync);
                let frameId = await getTopFrameId(stoppedEvent.body.threadId);

                let response1 = await dc.evaluateRequest({ expression: "s1.d", frameId: frameId, context: "watch" });
                let response2 = await dc.evaluateRequest({ expression: "s2.d", frameId: frameId, context: "watch" });

                await compareVariables(response1.body.variablesReference, { '[0]': i, '[1]': i, '[2]': i, '[3]': i });
                await compareVariables(response2.body.variablesReference, { '[0]': i * 10, '[1]': i * 10, '[2]': i * 10, '[3]': i * 10 });
            }
        });

        test('conditional breakpoint 1', async () => {
            let bpLine = findMarker(debuggeeSource, '#BP3');
            let setBreakpointAsync = setBreakpoint(debuggeeSource, bpLine, "i == 5");

            let stoppedEvent = await launchAndWaitForStop({ name: 'conditional breakpoint 1', program: debuggee, args: ['vars'] });
            let frameId = await getTopFrameId(stoppedEvent.body.threadId);
            let localsRef = await getFrameLocalsRef(frameId);
            await compareVariables(localsRef, { i: 5 });
        });

        test('conditional breakpoint 2', async () => {
            let bpLine = findMarker(debuggeeSource, '#BP3');
            let setBreakpointAsync = setBreakpoint(debuggeeSource, bpLine, "/py $i == 5");

            let stoppedEvent = await launchAndWaitForStop({ name: 'conditional breakpoint 2', program: debuggee, args: ['vars'] });
            let frameId = await getTopFrameId(stoppedEvent.body.threadId);
            let localsRef = await getFrameLocalsRef(frameId);
            await compareVariables(localsRef, { i: 5 });
        });

        test('disassembly', async () => {
            let setBreakpointAsync = setFnBreakpoint('/re disassembly1');
            let stoppedEvent = await launchAndWaitForStop({ name: 'disassembly', program: debuggee, args: ['dasm'] });
            let stackTrace = await dc.stackTraceRequest({
                threadId: stoppedEvent.body.threadId,
                startFrame: 0, levels: 5
            });
            let sourceRef = stackTrace.body.stackFrames[0].source.sourceReference;
            let source = await dc.sourceRequest({ sourceReference: sourceRef });
            assert.equal(source.body.mimeType, 'text/x-lldb.disassembly');

            // Set a new breakpoint two instructions ahead
            await dc.setBreakpointsRequest({
                source: { sourceReference: sourceRef },
                breakpoints: [{ line: 5 }]
            });
            let waitStoppedEvent2 = waitForStopEvent();
            await dc.continueRequest({ threadId: stoppedEvent.body.threadId });
            let stoppedEvent2 = await withTimeout(1000, waitStoppedEvent2);
            let stackTrace2 = await dc.stackTraceRequest({
                threadId: stoppedEvent2.body.threadId,
                startFrame: 0, levels: 5
            });
            assert.equal(stackTrace2.body.stackFrames[0].source.sourceReference, sourceRef);
            assert.equal(stackTrace2.body.stackFrames[0].line, 5);
        });
    });

    suite('Attach tests', () => {
        // Many Linux systems restrict tracing to parent processes only, which lldb in this case isn't.
        // To allow unrestricted tracing run `echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope`.
        if (process.platform == 'linux') {
            if (parseInt(fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'ascii')) > 0) {
                console.log('ptrace() syscall is locked down: skipping attach tests');
                return;
            }
        }

        let debuggeeProc: cp.ChildProcess;

        suiteSetup(() => {
            debuggeeProc = cp.spawn(debuggee, ['inf_loop'], {});
        })

        suiteTeardown(() => {
            debuggeeProc.kill()
        })

        test('attach by pid', async () => {
            let asyncWaitStopped = waitForStopEvent();
            let attachResp = await attach({ program: debuggee, pid: debuggeeProc.pid, stopOnEntry: true });
            assert(attachResp.success);
            await asyncWaitStopped;
        });

        test('attach by name', async () => {
            let asyncWaitStopped = waitForStopEvent();
            let attachResp = await attach({ program: debuggee, stopOnEntry: true });
            assert(attachResp.success);
            await asyncWaitStopped;
        });

        // Does not seem to work on OSX either :(
        // if (process.platform == 'darwin') {
        //     test('attach by name + waitFor', async () => {
        //         let asyncWaitStopped = waitForStopEvent();
        //         let attachResp = await attach({ program: debuggee, waitFor: true, stopOnEntry: true });
        //         assert(attachResp.success);
        //         debuggeeProc = cp.spawn(debuggee, ['inf_loop'], {});
        //         await asyncWaitStopped;
        //     });
        // }
    })

    suite('Rust tests', () => {
        test('variables', async () => {
            let bpLine = findMarker(rusttypesSource, '#BP1');
            let setBreakpointAsync = setBreakpoint(rusttypesSource, bpLine);
            let waitForStopAsync = waitForStopEvent();
            await launch({ name: 'rust variables', program: rusttypes });
            await setBreakpointAsync;
            let stoppedEvent = await waitForStopAsync;
            await verifyLocation(stoppedEvent.body.threadId, rusttypesSource, bpLine);
            let frames = await dc.stackTraceRequest({ threadId: stoppedEvent.body.threadId, startFrame: 0, levels: 1 });
            let scopes = await dc.scopesRequest({ frameId: frames.body.stackFrames[0].id });

            let foo_bar = (process.platform != 'win32') ? '"foo/bar"' : '"foo\\bar"';
            await compareVariables(scopes.body.scopes[0].variablesReference, {
                int: 17,
                float: 3.14159274,
                tuple: '(1, "a", 42)',
                tuple_ref: '(1, "a", 42)',
                // LLDB does not handle Rust enums well for now
                // reg_enum1: 'A',
                // reg_enum2: 'B(100, 200)',
                // reg_enum3: 'C{x:11.35, y:20.5}',
                // reg_enum_ref: 'C{x:11.35, y:20.5}',
                // cstyle_enum1: 'A',
                // cstyle_enum2: 'B',
                // enc_enum1: 'Some("string")',
                // enc_enum2: 'Nothing',
                // opt_str1: 'Some("string")',
                // opt_str2: 'None',
                tuple_struct: '(3, "xxx", -3)',
                reg_struct: '{a:1, c:12}',
                reg_struct_ref: '{a:1, c:12}',
                // opt_reg_struct1: 'Some({...})',
                // opt_reg_struct2: 'None',
                array: { '[0]': 1, '[1]': 2, '[2]': 3, '[3]': 4, '[4]': 5 },
                slice: '(5) &[1, 2, 3, 4, 5]',
                vec_int: {
                    $: '(10) vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]',
                    '[0]': 1, '[1]': 2, '[9]': 10
                },
                vec_str: '(5) vec!["111", "2222", "3333", "4444", "5555", ...]',
                large_vec: '(20000) vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, ...]',
                empty_string: '""',
                string: '"A String"',
                str_slice: '"String slice"',
                wstr1: '"Превед йожэг!"',
                wstr2: '"Ḥ̪͔̦̺E͍̹̯̭͜ C̨͙̹̖̙O̡͍̪͖ͅM̢̗͙̫̬E̜͍̟̟̮S̢̢̪̘̦!"',
                cstring: '"C String"',
                cstr: '"C String"',
                osstring: '"OS String"',
                osstr: '"OS String"',
                path_buf: foo_bar,
                path: foo_bar,
                str_tuple: {
                    __0: '"A String"',
                    __1: '"String slice"',
                    __2: '"C String"',
                    __3: '"C String"',
                    __4: '"OS String"',
                    __5: '"OS String"',
                    __6: foo_bar,
                    __7: foo_bar,
                },
                class: { finally: 1, import: 2, lambda: 3, raise: 4 },
                boxed: { a: 1, b: '"b"', c: 12 },
                rc_box: { $: '(refs:1) {...}', a: 1, b: '"b"', c: 12 },
                rc_box2: { $: '(refs:2) {...}', a: 1, b: '"b"', c: 12 },
                rc_box2c: { $: '(refs:2) {...}', a: 1, b: '"b"', c: 12 },
                rc_box3: { $: '(refs:1,weak:1) {...}', a: 1, b: '"b"', c: 12 },
                rc_weak: { $: '(refs:1,weak:1) {...}', a: 1, b: '"b"', c: 12 },
                arc_box: { $: '(refs:1,weak:1) {...}', a: 1, b: '"b"', c: 12 },
                arc_weak: { $: '(refs:1,weak:1) {...}', a: 1, b: '"b"', c: 12 },
                ref_cell: 10,
                ref_cell2: '(borrowed:2) 11',
                ref_cell2_borrow1: 11,
                ref_cell3: '(borrowed:mut) 12',
                ref_cell3_borrow: 12,
            });

            let response1 = await dc.evaluateRequest({
                expression: 'vec_str', context: 'watch',
                frameId: frames.body.stackFrames[0].id
            });
            await compareVariables(response1.body.variablesReference, { '[0]': '"111"', '[4]': '"5555"' });

            let response2 = await dc.evaluateRequest({
                expression: 'string', context: 'watch',
                frameId: frames.body.stackFrames[0].id
            });
            await compareVariables(response2.body.variablesReference, { '[0]': "'A'", '[7]': "'g'" });
        });
    });
});

/////////////////////////////////////////////////////////////////////////////////////////////////

function getAdapterLogFileName(): string {
    if (process.env.ADAPTER_LOG)
        return process.env.ADAPTER_LOG;
    else if (process.env.USE_CODELLDB)
        return 'adapter2.test.log';
    else
        return 'adapter.test.log';
}

async function startDebugAdapter(title: string): Promise<number> {
    let extensionRoot = path.join(__dirname, '..', '..');

    let adapterLog = getAdapterLogFileName();

    let log = fs.createWriteStream(adapterLog, { flags: 'a' });
    await new Promise(resolve => log.write(format('---------- %s\n', title), resolve));
    log.close();

    let adapter: cp.ChildProcess;
    if (process.env.USE_CODELLDB) {
        let stderr = await openFileAsync(adapterLog, 'a');
        let codelldb = path.join(extensionRoot, 'out/adapter2/codelldb');

        let liblldb;
        if (process.platform == 'linux')
            liblldb = path.join(extensionRoot, 'out/lldb/lib/liblldb.so');
        else if (process.platform == 'darwin')
            liblldb = path.join(extensionRoot, 'out/lldb/lib/liblldb.dylib');
        else
            liblldb = path.join(extensionRoot, 'out/lldb/bin/liblldb.dll');

        let args = ["--liblldb=" + liblldb];
        adapter = cp.spawn(codelldb, args, {
            stdio: ['ignore', 'pipe', stderr],
            cwd: extensionRoot,
            env: Object.assign({ RUST_LOG: 'error,codelldb=debug' }, process.env)
        });
    } else {
        let lldb = path.join(extensionRoot, 'out/lldb/bin/lldb');
        if (process.env.LLDB_EXECUTABLE) {
            lldb = process.env.LLDB_EXECUTABLE;
        }
        let params = {
            logLevel: 0,
            logFile: adapterLog
        };
        let args = ['-b', '-Q',
            '-O', format('command script import \'%s\'', path.join(extensionRoot, 'adapter')),
            '-O', format('script adapter.run_tcp_session(0 ,\'%s\')', new Buffer(JSON.stringify(params)).toString('base64'))
        ]
        adapter = cp.spawn(lldb, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: extensionRoot,
        });
    }

    let regex = new RegExp('^Listening on port (\\d+)\\s', 'm');
    let match = await util.waitForPattern(adapter, adapter.stdout, regex);
    let port = parseInt(match[1]);
    await sleepAsync(0); // Staves off a race condition inside DebugClient.
    adapter.stdout.pipe(process.stderr);
    return port;
}

function findMarker(file: string, marker: string): number {
    let data = fs.readFileSync(file, 'utf8');
    let lines = data.split('\n');
    for (let i = 0; i < lines.length; ++i) {
        let pos = lines[i].indexOf(marker);
        if (pos >= 0) return i + 1;
    }
    throw Error('Marker not found');
}

async function launch(launchArgs: any): Promise<dp.LaunchResponse> {
    let waitForInit = dc.waitForEvent('initialized');
    await dc.initializeRequest()
    let attachResp = dc.launchRequest(launchArgs);
    await waitForInit;
    dc.configurationDoneRequest();
    return attachResp;
}

async function attach(attachArgs: any): Promise<dp.AttachResponse> {
    let waitForInit = dc.waitForEvent('initialized');
    await dc.initializeRequest()
    let attachResp = dc.attachRequest(attachArgs);
    await waitForInit;
    dc.configurationDoneRequest();
    return attachResp;
}

async function setBreakpoint(file: string, line: number, condition?: string): Promise<dp.SetBreakpointsResponse> {
    await dc.waitForEvent('initialized');
    let breakpointResp = await dc.setBreakpointsRequest({
        source: { path: file },
        breakpoints: [{ line: line, column: 0, condition: condition }],
    });
    let bp = breakpointResp.body.breakpoints[0];
    assert.ok(bp.verified);
    assert.equal(bp.line, line);
    return breakpointResp;
}

async function setFnBreakpoint(name: string, condition?: string): Promise<dp.SetFunctionBreakpointsResponse> {
    await dc.waitForEvent('initialized');
    let breakpointResp = await dc.setFunctionBreakpointsRequest({
        breakpoints: [{ name: name, condition: condition }]
    });
    let bp = breakpointResp.body.breakpoints[0];
    return breakpointResp;
}

async function verifyLocation(threadId: number, file: string, line: number) {
    let stackResp = await dc.stackTraceRequest({ threadId: threadId });
    let topFrame = stackResp.body.stackFrames[0];
    assert.equal(topFrame.line, line);
}

async function readVariables(variablesReference: number): Promise<any> {
    let response = await dc.variablesRequest({ variablesReference: variablesReference });
    let vars: any = {};
    for (let v of response.body.variables) {
        vars[v.name] = v.value;
    }
    return vars;
}

function assertDictContains(dict: any, expected: any) {
    for (let key in expected) {
        assert.equal(dict[key], expected[key], 'The value of "' + key + '" does not match the expected value.');
    }
}

async function compareVariables(varRef: number, expected: any, prefix: string = '') {
    assert.notEqual(varRef, 0, 'Expected non-zero.');
    let response = await dc.variablesRequest({ variablesReference: varRef });
    let vars: any = {};
    for (let v of response.body.variables) {
        vars[v.name] = v;
    }
    for (let key of Object.keys(expected)) {
        if (key == '$')
            continue; // Summary is checked by the caller.

        let keyPath = prefix.length > 0 ? prefix + '.' + key : key;
        let expectedValue = expected[key];
        let variable = vars[key];
        assert.notEqual(variable, undefined, 'Did not find variable "' + keyPath + '"');

        if (expectedValue == null) {
            // Just check that the value exists
        } else if (typeof expectedValue == 'string') {
            assert.equal(variable.value, expectedValue,
                format('"%s": expected: "%s", actual: "%s"', keyPath, expectedValue, variable.value));
        } else if (typeof expectedValue == 'number') {
            let numValue = parseFloat(variable.value);
            assert.equal(numValue, expectedValue,
                format('"%s": expected: %d, actual: %d', keyPath, numValue, expectedValue));
        } else if (typeof expectedValue == 'object') {
            let summary = expectedValue['$'];
            if (summary != undefined) {
                assert.equal(variable.value, summary,
                    format('Summary of "%s", expected: "%s", actual: "%s"', keyPath, summary, variable.value));
            }
            await compareVariables(variable.variablesReference, expectedValue, keyPath);
        } else {
            assert.ok(false, 'Unreachable');
        }
    }
}

async function waitForStopEvent(): Promise<dp.StoppedEvent> {
    for (; ;) {
        let event = <dp.StoppedEvent>await dc.waitForEvent('stopped');
        // On OSX, debuggee starts out in a 'stopped' state, then eventually gets resumed after
        // debugger initialization is complete.
        // This initial stopped event interferes with our tests that await stop on a breakpoint.
        // Its distinguishing feature of initial stop is that the threadId is not set, so we use
        // that fact to ignore them.
        if (event.body.threadId) {
            return event;
        }
    }
}

async function launchAndWaitForStop(launchArgs: any): Promise<dp.StoppedEvent> {
    let waitForStopAsync = waitForStopEvent();
    await launch(launchArgs);
    let stoppedEvent = await waitForStopAsync;
    return <dp.StoppedEvent>stoppedEvent;
}

async function getTopFrameId(threadId: number): Promise<number> {
    let frames = await dc.stackTraceRequest({ threadId: threadId, startFrame: 0, levels: 1 });
    return frames.body.stackFrames[0].id;
}

async function getFrameLocalsRef(frameId: number): Promise<number> {
    let scopes = await dc.scopesRequest({ frameId: frameId });
    let localsRef = scopes.body.scopes[0].variablesReference;
    return localsRef;
}

function withTimeout<T>(timeoutMillis: number, promise: Promise<T>): Promise<T> {
    let error = new Error('Timed out');
    return new Promise<T>((resolve, reject) => {
        let timer = setTimeout(() => {
            (<any>error).code = 'Timeout';
            reject(error);
        }, timeoutMillis);
        promise.then(result => {
            clearTimeout(timer);
            resolve(result);
        });
    });
}
