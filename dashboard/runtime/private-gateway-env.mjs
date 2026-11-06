import {parseEnv} from 'node:util';
import {readFile,writeFile,chmod} from 'node:fs/promises';

// Only this explicit credential reference is authorized for local-gateway setup.
export const GATEWAY_REFERENCE='MAGPIE_GATEWAY_KEY';
const invalid=()=>{throw new Error('Existing local gateway credential is missing or cannot be safely represented');};
export function selectGatewayEnvironment(source,reference) {
  if(reference!==GATEWAY_REFERENCE)throw new Error('Unsupported local gateway credential reference');
  let parsed;
  try {parsed=parseEnv(source);}catch {invalid();}
  if(!Object.hasOwn(parsed,reference)||!parsed[reference]||parsed[reference].includes('\0'))invalid();
  const value=parsed[reference];
  // Dotenv quoting is not JSON quoting: backslashes and quote escapes differ.
  // Verify every candidate through the same Node dotenv grammar before writing.
  for(const quote of ["'",'`','"','']){
    const output=`${reference}=${quote}${value}${quote}\n`;
    try {
      const check=parseEnv(output);
      if(Object.keys(check).length===1&&check[reference]===value)return output;
    }catch { /* Never surface parser diagnostics containing credential text. */ }
  }
  invalid();
}
export async function copyGatewayEnvironment(source,destination,reference) {
  let content;
  try {content=selectGatewayEnvironment(await readFile(source,'utf8'),reference);}catch {invalid();}
  try {await writeFile(destination,content,{mode:0o600,flag:'wx'});await chmod(destination,0o600);}
  catch {throw new Error('Private gateway credential destination could not be created');}
}
