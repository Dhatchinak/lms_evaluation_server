import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { AccountModel, connectModels } from '../models/schemas/index.js';
import { APPROVED_EVALUATORS, APPROVED_ADMINS } from './approved-users.js';
const secret = () => { const value = process.env.SESSION_SECRET || ''; if (value.length < 32) throw new Error('SESSION_SECRET must have 32+ characters'); return value; };
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  if (password.length < 8) throw new Error('Password must contain at least 8 characters.');
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
export function approvedUsers(role:'admin'|'evaluator') {
 return role==='admin'?APPROVED_ADMINS:APPROVED_EVALUATORS;
}
export async function login(username:string,password:string) {
 const id=username.trim().toUpperCase();
 if(![...APPROVED_EVALUATORS,...APPROVED_ADMINS].some(u=>u.username===id)||!password)return null;
 await connectModels();
 const account=await AccountModel.findOne({username:id,active:true}).lean();
 if(!account||!verifyPassword(password,account.passwordSalt,account.passwordHash))return null;
 await AccountModel.updateOne({_id:account._id},{$set:{lastLoginAt:new Date()}});
 return {token:issueToken({username:id,role:account.role,displayName:account.displayName,department:account.department,passwordVersion:account.passwordVersion}),role:account.role,name:account.displayName,staffId:id,department:account.department,mustChangePassword:account.mustChangePassword};
}
export async function listManagedAccounts(){await connectModels();return AccountModel.find({role:{$in:['evaluator','admin']}}).select('username role displayName department active mustChangePassword lastLoginAt').sort({role:1,username:1}).lean();}
export async function changePassword(username:string,newPassword:string){const {salt,hash}=hashPassword(newPassword);await connectModels();await AccountModel.updateOne({username:username.toUpperCase()},{$set:{passwordSalt:salt,passwordHash:hash,mustChangePassword:false},$inc:{passwordVersion:1}});}
export async function resetPasswordByAdmin(username:string,newPassword:string){const {salt,hash}=hashPassword(newPassword);await connectModels();const result=await AccountModel.updateOne({username:username.toUpperCase(),role:'evaluator'},{$set:{passwordSalt:salt,passwordHash:hash,mustChangePassword:true},$inc:{passwordVersion:1}});return result.matchedCount>0;}
