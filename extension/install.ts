import * as zip from 'yauzl';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IncomingMessage } from 'http';
import { ExtensionContext } from 'vscode';

const MaxRedirects = 10;

export async function download(srcUrl: string, destPath: string) {
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
            response.on('end', resolve);
            response.on('error', reject);
        }
    });
}

export async function installVsix(vsixPath: string, context: ExtensionContext) {
    await extractVsix(vsixPath, context.extensionPath + '/hren');

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

async function extractVsix(zipPath: string, destDir: string) {
    return new Promise((resolve, reject) =>
        zip.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                reject(err)
            } else {
                zipfile.readEntry();
                zipfile.on('entry', (entry: zip.Entry) => {
                    if (entry.fileName.endsWith('/')) {
                        zipfile.readEntry();
                    } else {
                        let destFile = path.join(destDir, entry.fileName);
                        ensureDirectory(path.dirname(destFile))
                            .catch(err => reject(err))
                            .then(() =>
                                zipfile.openReadStream(entry, (err, stream) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        let file = fs.createWriteStream(destFile);
                                        stream.pipe(file);
                                        stream.on('error', reject);
                                        stream.on('end', () => {
                                            zipfile.readEntry()
                                        });
                                    }
                                }));
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
