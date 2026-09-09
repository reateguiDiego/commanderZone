import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileString } from 'sass';

const sourcePath = resolve('src/styles/themes.scss');
const outputPath = resolve('public/route-styles/themes.css');
const header = '/* Generated from src/styles/themes.scss. Edit the SCSS source, not this file. */\n';

const source = await readFile(sourcePath, 'utf8');
const css = compileString(source, {
  style: 'expanded',
  url: pathToFileURL(sourcePath),
}).css;
const output = css.startsWith('@charset')
  ? css.replace(/(^@charset [^;]+;\n)/, `$1${header}`)
  : `${header}${css}`;

let existingOutput = '';
try {
  existingOutput = await readFile(outputPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

if (existingOutput !== output) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}
