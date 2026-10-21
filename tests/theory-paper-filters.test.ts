import test from 'node:test';
import assert from 'node:assert/strict';
import {isTheoryPaper} from '../src/utils/theory.js';
test('college exclusions by title and paper code',()=>{
 for(const paper_code of ['U25VLO301','U25CSPS2','U25CS3E1'])assert.equal(isTheoryPaper({paper_code,paper_title:'Theory',paper_type:'Core'}),false);
 assert.equal(isTheoryPaper({paper_code:'U25CS301',paper_title:'Environmental Studies',paper_type:'Core'}),false);
 assert.equal(isTheoryPaper({paper_code:'P25CS307',paper_title:'Digital Image Processing',paper_type:'Core VII'}),true);
});
