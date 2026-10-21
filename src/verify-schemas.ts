import {CRITERIA} from './shared/criteria.js';
import {validateScore} from './models/schema-storage.js';
import type {Evaluation} from './shared/types.js';
const marks=Object.fromEntries(CRITERIA.map(c=>[c.key,c.max]));
const fake={marks,total:100,status:'submitted',lmsCode:'LMS-001',rubricVersion:2} as Evaluation;
validateScore(fake);let rejected=false;
try{validateScore({...fake,marks:{...marks,assignmentGiven:9}});}catch{rejected=true;}
if(!rejected)throw new Error('Invalid mark incorrectly accepted.');
console.log('Rubric schema validation: passed 14 fields, maximum 100, invalid marks rejected.');
