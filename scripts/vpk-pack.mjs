import { execSync } from 'child_process';
import { join } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const v = pkg.version;
const userProfile = process.env.USERPROFILE || '';
const localAppData = process.env.LOCALAPPDATA || join(userProfile, 'AppData', 'Local');
const vpk = join(userProfile, '.dotnet', 'tools', 'vpk.exe');

execSync(`"${vpk}" pack --packId com.nutbrothers.bootcord --packVersion ${v} --packDir release/win-unpacked --mainExe bootcord.exe`, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DOTNET_ROOT: join(localAppData, 'dotnet') },
});
