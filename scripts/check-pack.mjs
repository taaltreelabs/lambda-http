import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const temp = mkdtempSync(join(tmpdir(), 'lambda-http-pack-'));
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp, '--cache', join(temp, 'cache')], { encoding: 'utf8' }));
  for (const file of pack.files) assert.match(file.path, /^(dist\/|README\.md$|LICENSE$|package\.json$)/);
  const packageDir = join(temp, 'node_modules', '@taaltreelabs', 'lambda-http');
  mkdirSync(packageDir, { recursive: true });
  execFileSync('tar', ['-xzf', join(temp, pack.filename), '-C', packageDir, '--strip-components=1']);
  for (const [ext, statement] of [['mjs', "import {createHttp} from '@taaltreelabs/lambda-http';"], ['cjs', "const {createHttp} = require('@taaltreelabs/lambda-http');"]]) {
    const path = join(temp, `smoke.${ext}`);
    writeFileSync(path, `${statement}\nif(createHttp({payloadVersion:'2.0'}).json({ok:true}).statusCode !== 200) throw Error('Bad response');`);
    execFileSync(process.execPath, [path], { stdio: 'inherit' });
  }
  console.log(`Verified ${pack.filename}: packed ESM and CommonJS imports work without dependencies.`);
} finally { rmSync(temp, { recursive: true, force: true }); }
