import assert from 'node:assert/strict';
import test from 'node:test';
import {APPROVED_EVALUATORS,APPROVED_ADMINS} from '../src/services/approved-users.js';
import {hashPassword,verifyPassword,approvedUsers} from '../src/services/auth.service.js';
test('account roster has exactly E1–E28 and two technical coordinator admins',()=>{
 assert.equal(APPROVED_EVALUATORS.length,28);assert.equal(APPROVED_ADMINS.length,2);
 assert.deepEqual(APPROVED_EVALUATORS.map(x=>x.username),Array.from({length:28},(_,i)=>`E${i+1}`));
 assert.equal(new Set([...APPROVED_EVALUATORS,...APPROVED_ADMINS].map(x=>x.username)).size,30);
 assert.equal(approvedUsers('admin').length,2);
});
test('initial passwords can be securely hashed and verified',()=>{
 for(const pw of ['bhcstaff','lmsadmin']){
 const {salt,hash}=hashPassword(pw);assert.notEqual(hash,pw);assert.ok(verifyPassword(pw,salt,hash));assert.equal(verifyPassword(pw+'bad',salt,hash),false);
 }
});
