import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { AccountModel, connectModels } from '../models/schemas/index.js';
import { APPROVED_EVALUATORS, APPROVED_ADMINS } from './approved-users.js';
const secret = () => { const value = process.env.SESSION_SECRET || ''; if (value.length < 32) throw new Error('SESSION_SECRET must have 32+ characters'); return value; };
export function hashPassword(password: string, salt = randomBytes(16).toString('hex'), requireEightCharacters = true) {
  if (!password) throw new Error('Password cannot be empty.');
  if (requireEightCharacters && password.length < 8) throw new Error('Password must contain at least 8 characters.');
  return {salt, hash:scryptSync(password,salt,64).toString('hex')};
}
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  try { const a=scryptSync(password,salt,64);const b=Buffer.from(hash,'hex');return a.length===b.length && timingSafeEqual(a,b); } catch {return false;}
}
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function issueToken(user:{username:string,role:string,displayName:string,department?:string,passwordVersion?:number}) {
 const body=encode({sub:user.username,role:user.role,name:user.displayName,department:user.department||'',pv:user.passwordVersion||1,iat:Date.now(),exp:Date.now()+8*60*60*1000});
 return `${body}.${createHmac('sha256',secret()).update(body).digest('base64url')}`;
}
export async function authenticate(token:string) {
 try {
  const [body,mac]=token.split('.');if(!body||!mac)return null;
  const actual=Buffer.from(mac,'base64url'),expected=createHmac('sha256',secret()).update(body).digest();
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
  const claims=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if(!claims.sub||claims.exp<Date.now()||claims.iat>Date.now())return null;
  await connectModels();
  const account=await AccountModel.findOne({username:claims.sub,active:true}).lean();
  if(!account||account.role!==claims.role||Number(account.passwordVersion||1)!==Number(claims.pv))return null;
  return {username:account.username,role:account.role,name:account.displayName,department:account.department||''};
 }catch{return null;}
}
export async function approvedUsers(role:'admin'|'evaluator') {
 // Dynamic administrators live in MongoDB; evaluators remain the authorized college list.
 if (role==='evaluator') return APPROVED_EVALUATORS;
 await connectModels();
 const rows = await AccountModel.find({role:'admin',active:true}).select('username displayName department role -_id').lean();
 return rows.map(row=>({username:row.username,displayName:row.displayName,department:row.department||'',role:'admin' as const}));
}
export async function createAdministrator(input:{displayName:string;department?:string;password:string}) {
 const name=input.displayName.trim().replace(/\s+/g,' ');
 if (name.length<5||name.length>100) throw Object.assign(new Error('Enter the administrator’s full name (5–100 characters).'),{status:400});
 if (!input.password) throw Object.assign(new Error('Enter an administrator password.'),{status:400});
 await connectModels();
 const existing=await AccountModel.findOne({role:'admin',displayName:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')}).lean();
 if(existing) throw Object.assign(new Error('An administrator with this name already exists.'),{status:409});
 const {salt,hash}=hashPassword(input.password, undefined, false);
 for(let i=0;i<5;i++){
  const id='ADMIN-'+randomBytes(4).toString('hex').toUpperCase();
  try {
   const created=await AccountModel.create({username:id,role:'admin',displayName:name,department:String(input.department||'').trim().slice(0,100),passwordSalt:salt,passwordHash:hash,active:true,passwordVersion:1,mustChangePassword:true});
   return {username:created.username,displayName:created.displayName,department:created.department||'',role:'admin'};
  }catch(e){if((e as {code?:number}).code!==11000)throw e;}
 }
 throw new Error('Unable to allocate a unique administrator ID.');
}
export async function login(username:string,password:string) {
 const id=username.trim().toUpperCase();
 if(!password)return null;
 await connectModels();
 const account=await AccountModel.findOne({username:id,active:true}).lean();
 if(!account||!verifyPassword(password,account.passwordSalt,account.passwordHash))return null;
 if(account.role==='evaluator'&&!APPROVED_EVALUATORS.some(u=>u.username===id))return null;
 await AccountModel.updateOne({_id:account._id},{$set:{lastLoginAt:new Date()}});
 return {token:issueToken({username:id,role:account.role,displayName:account.displayName,department:account.department,passwordVersion:account.passwordVersion}),role:account.role,name:account.displayName,staffId:id,department:account.department,mustChangePassword:account.mustChangePassword};
}
export async function listManagedAccounts(){await connectModels();return AccountModel.find({role:{$in:['evaluator','admin']}}).select('username role displayName department active mustChangePassword lastLoginAt').sort({role:1,username:1}).lean();}
export async function changePassword(username:string,newPassword:string){const {salt,hash}=hashPassword(newPassword);await connectModels();await AccountModel.updateOne({username:username.toUpperCase()},{$set:{passwordSalt:salt,passwordHash:hash,mustChangePassword:false},$inc:{passwordVersion:1}});}
export async function resetPasswordByAdmin(username:string,newPassword:string){const {salt,hash}=hashPassword(newPassword);await connectModels();const result=await AccountModel.updateOne({username:username.toUpperCase(),role:'evaluator'},{$set:{passwordSalt:salt,passwordHash:hash,mustChangePassword:true},$inc:{passwordVersion:1}});return result.matchedCount>0;}
