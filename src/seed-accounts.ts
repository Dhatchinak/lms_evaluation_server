import 'dotenv/config';
import { AccountModel, connectModels } from './models/schemas/index.js';
import { APPROVED_EVALUATORS, APPROVED_ADMINS } from './services/approved-users.js';
import { hashPassword } from './services/auth.service.js';
async function main() {
 await connectModels();
 let created=0,existing=0;
 for(const user of [...APPROVED_EVALUATORS,...APPROVED_ADMINS]){
  const username=user.username.toUpperCase();
  const {salt,hash}=hashPassword(user.role==='admin'?(process.env.INITIAL_ADMIN_PASSWORD||'lmsadmin'):(process.env.INITIAL_EVALUATOR_PASSWORD||'bhcstaff'));
  const result=await AccountModel.updateOne({username},{$setOnInsert:{...user,username,passwordSalt:salt,passwordHash:hash,passwordVersion:1,mustChangePassword:true,active:true}},{upsert:true});
  if(result.upsertedCount)created++;else existing++;
 }
 console.log(`Account setup: ${created} created, ${existing} existing (existing passwords preserved).`);
 console.log('Initial shared passwords are temporary. Change all passwords before public launch.');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
