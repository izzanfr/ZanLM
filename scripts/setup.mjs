import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
if(!process.stdin.isTTY){console.error("Run npm run setup in an interactive terminal.");process.exit(1);}
// Hidden input. This script never reads or overwrites an existing environment file.
const hiddenOutput=new Writable({write(_chunk,_encoding,callback){callback();}});
const rl=createInterface({input:process.stdin,output:hiddenOutput,terminal:true});
try {
  process.stdout.write("Choose an access code (12–128 letters, numbers, underscores or hyphens; hidden): ");
  const code=await rl.question("");process.stdout.write("\n");
  if(!/^[A-Za-z0-9_-]{12,128}$/.test(code))throw new Error("Use 12–128 letters, numbers, underscores or hyphens.");
  process.stdout.write("Confirm access code (hidden): ");const confirm=await rl.question("");process.stdout.write("\n");
  if(code!==confirm)throw new Error("Access codes did not match. Run setup again.");
  await writeFile(new URL("../.env.local",import.meta.url),`ACCESS_CODE=${code}\nSESSION_SECRET=${randomBytes(48).toString("hex")}\nGEMINI_API_KEY=\nGEMINI_MODEL=\nGEMINI_MODEL_FALLBACK=\nGEMINI_MODEL_FALLBACK_2=\nWORKER_SECRET=${randomBytes(32).toString("hex")}\nWORKER_URL=http://127.0.0.1:8000\nMAX_UPLOAD_MB=50\nMAX_SLIDES=40\n`,{flag:"wx",mode:0o600});
  console.log("Configuration created. Run npm run dev and sign in with your chosen code.");
}catch(error){console.error(error.code==="EEXIST"?"Configuration already exists. It was not read or changed.":error.message);process.exitCode=1;}finally{rl.close();}
