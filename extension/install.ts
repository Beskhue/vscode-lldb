import * as zip from 'yauzl';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { promisify, format } from 'util';
import { IncomingMessage } from 'http';
import { ExtensionContext, OutputChannel } from 'vscode';

const MaxRedirects = 10;

const readFileAsync = promisify(fs.readFile);

type ProgressCallback = (downloaded: number, contentLength?: number) => void;

export async function downloadPlatformPackage(context: ExtensionContext, destPath: string, progress?: ProgressCallback) {
    let content = await readFileAsync(path.join(context.extensionPath, 'package.json'));
    let pkg = JSON.parse(content.toString());
    let pp = pkg.config.platformPackages;
    let packageName = pp.names[process.platform];
    if (packageName == undefined) {
        throw new Error('Current platform is not suported.');
    }
    let packageUrl = pp.baseUrl + packageName;
    await download(packageUrl, destPath, progress);
}

async function download(srcUrl: string, destPath: string, progress?: ProgressCallback) {
    return new Promise(async (resolve, reject) => {
        let response;
        for (let i = 0; i < MaxRedirects; ++i) {
            response = await new Promise<IncomingMessage>(resolve => https.get(srcUrl, resolve));
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                srcUrl = response.headers.location;
            } else {
                break;
            }
        }
        if (response.headers['content-type'] != 'application/octet-stream') {
            reject(new Error('HTTP response does not contain an octet stream'));
        } else {
            let stm = fs.createWriteStream(destPath);
            response.pipe(stm);
            if (progress) {
                let contentLength = response.headers['content-length'] ? Number.parseInt(response.headers['content-length']) : null;
                let downloaded = 0;
                response.on('data', (chunk) => {
                    downloaded += chunk.length;
                    progress(downloaded, contentLength);
                })
            }
            response.on('end', resolve);
            response.on('error', reject);
        }
    });
}

export async function installVsix(context: ExtensionContext, vsixPath: string) {
    let destDir = path.join(context.extensionPath, '/hren');
    await extractZip(vsixPath, (entry) => {
        if (entry.fileName.startsWith('extension/'))
            return path.join(destDir, entry.fileName.substr(10));
        else
            return null;
    });
    // let vscode = cp.spawn(process.execPath, ['--install-extension', file], {
    //     stdio: ['ignore', 'pipe', 'pipe']
    // });
    // util.logProcessOutput(vscode, output);
    // vscode.on('error', err => window.showErrorMessage(err.toString()));
    // vscode.on('exit', (exitCode, signal) => {
    //     if (exitCode != 0)
    //         window.showErrorMessage('Installation failed.');
    //     else
    //         window.showInformationMessage('Please restart VS Code to activate extension.');
    // });
}

async function extractZip(zipPath: string, callback: (entry: zip.Entry) => string | null) {
    return new Promise((resolve, reject) =>
        zip.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                reject(err);
            } else {
                zipfile.readEntry();
                zipfile.on('entry', (entry: zip.Entry) => {
                    let destPath = callback(entry);
                    if (destPath != null) {
                        ensureDirectory(path.dirname(destPath))
                            .catch(err => reject(err))
                            .then(() =>
                                zipfile.openReadStream(entry, (err, stream) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        let file = fs.createWriteStream(destPath);
                                        stream.pipe(file);
                                        stream.on('error', reject);
                                        stream.on('end', () => {
                                            let attrs = (entry.externalFileAttributes >> 16) & 0o7777;
                                            fs.chmod(destPath, attrs, (err) => {
                                                zipfile.readEntry();
                                            });
                                        });
                                    }
                                }));
                    } else {
                        zipfile.readEntry();
                    }
                });
                zipfile.on('end', () => {
                    zipfile.close();
                    resolve();
                });
                zipfile.on('error', reject);
            }
        })
    );
}

async function ensureDirectory(dir: string) {
    let exists = await new Promise(resolve => fs.exists(dir, exists => resolve(exists)));
    if (!exists) {
        await ensureDirectory(path.dirname(dir));
        await new Promise((resolve, reject) => fs.mkdir(dir, err => {
            if (err) reject(err);
            else resolve();
        }));
    }
}
