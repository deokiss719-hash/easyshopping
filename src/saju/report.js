'use strict';
const previous=require('./report-v10');
const {simplify}=require('./easy-language');
const VERSION='ko-easy-story-11';
function generate(chart,version=VERSION){
 if(version!==VERSION)return previous.generate(chart,version);
 const report=previous.generate(chart);
 report.version=VERSION;
 // Keep paragraph-level evidence and original chart calculations; only edit language.
 for(const section of report.sections){
  if(section.id==='basis')continue;
  for(const block of section.blocks){
   block.parts=block.parts.map(part=>({...part,text:simplify(part.text)}));
   block.text=block.parts.map(part=>part.text).join(' ');
  }
 }
 return report;
}
module.exports={...previous,generate,VERSION};
