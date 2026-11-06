import {executeTool} from "../../apps/controller/tools.mjs";
let data="";
for await(const chunk of process.stdin) {
  data+=chunk;
  if(data.length>600000)throw new Error("Request too large");
}
try {
  const {name,args}=JSON.parse(data);
  const result=await executeTool(name,args);
  process.stdout.write(JSON.stringify({result})+"\n");
} catch(error) {
  process.stdout.write(JSON.stringify({error:error.message})+"\n");
}
