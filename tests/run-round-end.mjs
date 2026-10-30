// Run actual game rules against a synthetic map in a disposable copy when original assets are absent.
import {mkdtemp,mkdir,cp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {FLAT_MAP} from './fixtures/flat-map.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(path.join(tmpdir(),'lan-strike-round-end-'));
try{
  for(const name of ['game.mjs','ballistics.mjs','hitboxes.mjs','inventory.mjs','grenades.mjs','package.json','tests'])await cp(path.join(root,name),path.join(temporary,name),{recursive:true});
  await symlink(path.join(root,'node_modules'),path.join(temporary,'node_modules'),'dir');
  await mkdir(path.join(temporary,'public'));
  await cp(path.join(root,'public'),path.join(temporary,'public'),{recursive:true,filter:source=>!source.startsWith(path.join(root,'public/assets'))&&source!==path.join(root,'public/map-data.js')});
  await writeFile(path.join(temporary,'public/map-data.js'),'export const MAP_DATA='+JSON.stringify(FLAT_MAP)+';\n');
  console.log('Synthetic map rules tests: actual Game, movement and inventory; no original-map or multiplayer fidelity claim.');
  const run=args=>{const result=spawnSync(process.execPath,['--test',...args],{cwd:temporary,stdio:'inherit'});if(result.error)throw result.error;return result.status??1;};
  const status=run(['tests/round-end.test.mjs'])||run(['--test-name-pattern=^(ammo:|carryover:|round money:|reload:|economy:|shooting: no firing)','tests/equipment-game.test.mjs','tests/recoil-state.test.mjs']);
  process.exitCode=status;
}finally{await rm(temporary,{recursive:true,force:true});}
