/**
 * Standalone browser companions for this fork.
 *
 * The Chromium archive can be installed as an unpacked extension in Chrome/Edge.
 * Firefox is a development-only, unsigned archive: a permanent Firefox add-on
 * needs a separate Mozilla-signed identity. Keep that limitation in the filename.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { extensionFiles, extensionStamp } from './write-extension-stamp.mjs';
import { stageFirefoxExtension } from './stage-firefox-extension.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const releaseDir = path.join(root, 'release');
const chromeName = 'Chat-On-Steroids-Extension.zip';
const firefoxName = 'Chat-On-Steroids-Firefox-Unsigned.zip';
const firefoxId = 'companion@brodxi.local';
const mandatory = ['manifest.json', 'build-stamp.txt', 'background.js', 'chatgpt-dom.js',
  'content.js', 'fiber.js', 'usage.js', 'popup.html', 'popup.js', 'overlay.css',
  'icons/icon16.png', 'icons/icon128.png', 'LICENSE'];

function archiveFolder(directory, destination, license) {
  const entries = {};
  for (const file of extensionFiles(directory)) {
    if (file.endsWith('.map')) continue;
    entries[file] = readFileSync(path.join(directory, ...file.split('/')));
  }
  // The build stamp cannot hash itself, but must be inside each shipping archive.
  entries['build-stamp.txt'] = readFileSync(path.join(directory, 'build-stamp.txt'));
  if (license) entries.LICENSE = readFileSync(path.join(root, 'LICENSE'));
  writeFileSync(destination, zipSync(entries, { level: 6 }));
}

function verifyArchive(filename, expectedVersion, expectedStamp, firefox) {
  const archive = unzipSync(readFileSync(path.join(releaseDir, filename)));
  for (const file of mandatory) if (!archive[file]) throw new Error(filename + ': missing ' + file);
  if (strFromU8(archive['build-stamp.txt']).trim() !== expectedStamp) throw new Error(filename + ': bad build stamp');
  const manifest = JSON.parse(strFromU8(archive['manifest.json']));
  if (manifest.version !== expectedVersion) throw new Error(filename + ': app and extension versions differ');
  if (firefox) {
    if (manifest.background?.scripts?.[0] !== 'background.js' ||
        manifest.permissions.includes('debugger') ||
        manifest.browser_specific_settings?.gecko?.id !== firefoxId ||
        manifest.browser_specific_settings.gecko.update_url !== undefined) {
      throw new Error(filename + ': invalid temporary Firefox manifest');
    }
  } else if (manifest.background?.service_worker !== 'background.js') {
    throw new Error(filename + ': invalid Chromium manifest');
  }
  console.log('Verified ' + filename + ' (' + expectedVersion + ')');
}

async function main() {
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const manifestVersion = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')).version;
  if (version !== manifestVersion) throw new Error('App and Chromium extension versions differ');
  mkdirSync(releaseDir, { recursive: true });

  const stamp = extensionStamp(extensionDir);
  writeFileSync(path.join(extensionDir, 'build-stamp.txt'), stamp + '\n');
  archiveFolder(extensionDir, path.join(releaseDir, chromeName), true);

  const firefoxDir = await stageFirefoxExtension(path.join(releaseDir, 'firefox-extension'), '');
  const manifestPath = path.join(firefoxDir, 'manifest.json');
  const firefoxManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // An unsigned development build must not claim upstream's signed Firefox identity
  // or silently receive updates published by the upstream repository.
  firefoxManifest.browser_specific_settings.gecko.id = firefoxId;
  delete firefoxManifest.browser_specific_settings.gecko.update_url;
  writeFileSync(manifestPath, JSON.stringify(firefoxManifest, null, 2) + '\n');
  archiveFolder(firefoxDir, path.join(releaseDir, firefoxName), false);

  verifyArchive(chromeName, version, stamp, false);
  verifyArchive(firefoxName, version, stamp, true);
}

await main();
